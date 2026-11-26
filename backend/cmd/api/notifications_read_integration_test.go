//go:build integration

// Notifications member read API (notifications-v1 N4: GET B, GET B/unread-count with
// B = /v2/me/company/notifications) through the production router, the real auth
// middleware and the real owner/recruiter/stakeholder gate.
//
// Isolation: like the notifications package tests, every test creates a disposable
// draft_test_mig_* database from the loopback draft_test DSN in DRAFT_TEST_DATABASE_URL
// (never DATABASE_URL), migrates it and drops it at cleanup.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

const notifReadPath = "/v2/me/company/notifications"

// notifReadDB creates, migrates and later drops a disposable database.
func notifReadDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv(draftFlowDSNEnv)
	if dsn == "" {
		t.Skipf("%s not set; skipping isolated notifications read test", draftFlowDSNEnv)
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse %s: %v", draftFlowDSNEnv, err)
	}
	if cfg.ConnConfig.Database != draftFlowDBName || !draftFlowIsLoopback(cfg.ConnConfig.Host) {
		t.Fatal("notifications read tests require loopback + draft_test as the bootstrap database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	admin, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	name := "draft_test_mig_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	cfg = cfg.Copy()
	cfg.ConnConfig.Database = name
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+quoted); err != nil {
		t.Fatalf("create disposable database (CREATEDB required): %v", err)
	}
	var pool *pgxpool.Pool
	var sqlDB *sql.DB
	t.Cleanup(func() {
		if sqlDB != nil {
			_ = sqlDB.Close()
		}
		if pool != nil {
			pool.Close()
		}
		stopCtx, stop := context.WithTimeout(context.Background(), 30*time.Second)
		defer stop()
		if _, err := admin.Exec(stopCtx, "DROP DATABASE "+quoted); err != nil {
			t.Errorf("drop disposable database %s: %v", name, err)
		}
	})
	if pool, err = pgxpool.NewWithConfig(ctx, cfg); err != nil {
		t.Fatal(err)
	}
	sqlDB = stdlib.OpenDBFromPool(pool)
	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpContext(ctx, sqlDB, "."); err != nil {
		t.Fatalf("migrate disposable database: %v", err)
	}
	return pool
}

type notifUser struct {
	id   uuid.UUID
	sub  string
	name string
}

// notifWorld: one active company with an owner, a recruiter (team of both jobs), a
// colleague recruiter, a stakeholder; a second company with its own recruiter; a
// candidate account; job A with four organic participations and job B.
type notifWorld struct {
	pool                                     *pgxpool.Pool
	server                                   *httptest.Server
	signer                                   *draftFlowSigner
	company, other                           uuid.UUID
	owner, recruiter, colleague, stakeholder notifUser
	outsider, candidate                      notifUser
	jobA, jobB, otherJob                     uuid.UUID
	parts                                    []uuid.UUID
	candidates                               []notifUser
	assignment                               map[[2]uuid.UUID]uuid.UUID // (job, user) → assignment
	scheduled                                int
}

var notifT0 = time.Date(2026, 11, 26, 15, 0, 0, 0, time.UTC)

func newNotifWorld(t *testing.T) *notifWorld {
	t.Helper()
	pool := notifReadDB(t)
	w := &notifWorld{pool: pool, signer: newDraftFlowSigner(t), company: uuid.New(), other: uuid.New(), assignment: map[[2]uuid.UUID]uuid.UUID{}}
	w.owner = w.user(t, "Olga Owner", "recruiter")
	w.recruiter = w.user(t, "Rita Recruiter", "recruiter")
	w.colleague = w.user(t, "Carmen Colleague", "recruiter")
	w.stakeholder = w.user(t, "Sara Stake", "recruiter")
	w.outsider = w.user(t, "Oscar Outsider", "recruiter")
	w.candidate = w.user(t, "Cecilia Candidate", "candidate")
	for _, c := range []uuid.UUID{w.company, w.other} {
		w.exec(t, `INSERT INTO companies(id,name,rfc,industry_id,status) VALUES($1,'Notif Read',$2,'technology','active')`, c, uuid.NewString())
	}
	for u, role := range map[uuid.UUID]string{w.owner.id: "owner", w.recruiter.id: "recruiter", w.colleague.id: "recruiter", w.stakeholder.id: "stakeholder"} {
		w.exec(t, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,$4)`, uuid.New(), u, w.company, role)
	}
	w.exec(t, `INSERT INTO company_members(id,user_id,company_id,role) VALUES($1,$2,$3,'recruiter')`, uuid.New(), w.outsider.id, w.other)
	w.jobA = w.job(t, w.company, "Analista de nómina")
	w.jobB = w.job(t, w.company, "Ejecutivo de ventas")
	w.otherJob = w.job(t, w.other, "Puesto ajeno")
	for _, job := range []uuid.UUID{w.jobA, w.jobB} {
		w.assign(t, job, w.recruiter.id)
		w.assign(t, job, w.colleague.id)
	}
	for _, name := range []string{"Ana López", "Luis Pérez", "Carla Díaz", "Diego Ruiz"} {
		c := w.user(t, name, "candidate")
		w.candidates = append(w.candidates, c)
		w.parts = append(w.parts, w.participation(t, w.jobA, c.id))
	}
	w.server = newNotifServer(t, pool, w.signer)
	return w
}

func newNotifServer(t *testing.T, pool *pgxpool.Pool, signer *draftFlowSigner) *httptest.Server {
	t.Helper()
	queries := db.New(pool)
	users := identitypostgres.NewUserRepository(queries)
	members := companiespostgres.NewCompanyMemberRepository(pool, auditpostgres.NewAuditEventRepository())
	companies := companiespostgres.NewCompanyRepository(pool, auditpostgres.NewAuditEventRepository())
	router := newRouter(routerDeps{
		requireAuth:           identityhttp.RequireAuth(signer.verifier),
		requireCandidate:      identityhttp.RequireCandidateRole(users),
		requireRecruiter:      identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.RecruiterRole),
		requireOwner:          identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.OwnerRole),
		requireDocumentReader: identityhttp.RequireDocumentReader(users, members, companies),
		notificationsHandler:  newNotificationsHandler(pool),
		queries:               queries,
		pool:                  pool,
		readinessTimeout:      2 * time.Second,
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return server
}

func (w *notifWorld) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := w.pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
}

func (w *notifWorld) user(t *testing.T, name, kind string) notifUser {
	t.Helper()
	u := notifUser{id: uuid.New(), sub: "notif-" + uuid.NewString(), name: name}
	w.exec(t, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,$4,$5)`, u.id, u.sub, uuid.NewString()+"@example.test", name, kind)
	return u
}

func (w *notifWorld) job(t *testing.T, company uuid.UUID, title string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	fields, _ := json.Marshal(map[string]any{"fields": map[string]any{"title": title}})
	w.exec(t, `INSERT INTO job_drafts(id,company_id,created_by,fields) VALUES($1,$2,$3,$4)`, id, company, w.owner.id, fields)
	w.exec(t, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, id, company, w.owner.id)
	w.exec(t, `INSERT INTO vacancy_teams(draft_id,company_id,mode,updated_at) VALUES($1,$2,'shared',now())`, id, company)
	return id
}

func (w *notifWorld) assign(t *testing.T, job, user uuid.UUID) {
	t.Helper()
	id := uuid.New()
	w.exec(t, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause) VALUES($1,$2,$3,$4,now(),'added')`, id, job, w.company, user)
	w.assignment[[2]uuid.UUID{job, user}] = id
}

func (w *notifWorld) unassign(t *testing.T, job, user uuid.UUID) {
	t.Helper()
	w.exec(t, `UPDATE vacancy_assignments SET ended_at=now(), end_cause='removed' WHERE id=$1`, w.assignment[[2]uuid.UUID{job, user}])
}

func (w *notifWorld) participation(t *testing.T, job, candidate uuid.UUID) uuid.UUID {
	t.Helper()
	id, cv := uuid.New(), uuid.New()
	w.exec(t, `INSERT INTO candidate_cv_versions(id,candidate_id,storage_key,size,content_type) VALUES($1,$2,$3,6,'application/pdf')`, cv, candidate, strings.Repeat(strings.ReplaceAll(cv.String(), "-", ""), 2))
	w.exec(t, `INSERT INTO process_participations(id,process_id,candidate_id,stage_id,cv_version_id,questions_snapshot,answers_snapshot,source) VALUES($1,$2,$3,$4,$5,'[]','[]','organic')`,
		id, job, candidate, uuid.New(), cv)
	return id
}

// notifRow is one notifications row written as the fan-out / scheduler would.
type notifRow struct {
	recipient  uuid.UUID
	candidate  bool       // recipient_kind candidate (company NULL)
	company    *uuid.UUID // default: the world company
	typ        string
	group      string // default n:<id>
	job        uuid.UUID
	part       *uuid.UUID
	actor      *uuid.UUID
	payload    string
	at         time.Time
	read       bool
	resolved   bool
	commitment string // scheduled types; default a unique date
}

var notifScheduled = map[string]bool{"delivery_due_soon": true, "delivery_overdue": true, "assignment_deadline_due_soon": true, "assignment_deadline_overdue": true}

func (w *notifWorld) notify(t *testing.T, r notifRow) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if r.group == "" {
		r.group = "n:" + id.String()
	}
	if r.payload == "" {
		r.payload = "{}"
	}
	kind, reason := "member", "team"
	company := &w.company
	if r.company != nil {
		company = r.company
	}
	if r.candidate {
		kind, reason, company = "candidate", "candidate", nil
	}
	var source *uuid.UUID
	var commitment *string
	if notifScheduled[r.typ] {
		if r.commitment == "" {
			w.scheduled++
			c := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, w.scheduled).Format(time.DateOnly)
			r.commitment = c
		}
		commitment = &r.commitment
	} else {
		event := uuid.Must(uuid.NewV7())
		w.exec(t, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,job_id,payload,occurred_at,processed_at) VALUES($1,$2,$3,'VacancyApplicationSubmitted',$4,'{}',$5,$5)`,
			event, uuid.New(), w.company, r.job, r.at)
		source = &event
	}
	var readAt, resolvedAt *time.Time
	if r.read {
		readAt = &r.at
	}
	if r.resolved {
		resolvedAt = &r.at
	}
	w.exec(t, `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,participation_id,actor_user_id,source_event_id,commitment_date,payload,created_at,read_at,resolved_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::jsonb,$14,$15,$16)`,
		id, r.recipient, kind, reason, company, r.typ, r.group, r.job, r.part, r.actor, source, commitment, r.payload, r.at, readAt, resolvedAt)
	return id
}

type notifResponse struct {
	status int
	header http.Header
	body   []byte
}

func (w *notifWorld) get(t *testing.T, u notifUser, path string) notifResponse {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, w.server.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if u.sub != "" {
		req.Header.Set("Authorization", "Bearer "+w.signer.validToken(t, u.sub))
	}
	resp, err := w.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return notifResponse{status: resp.StatusCode, header: resp.Header.Clone(), body: raw}
}

// notifPage is the wire shape of GET B, decoded strictly (unknown keys fail).
type notifPage struct {
	Attention           *[]notifItem `json:"attention"`
	AttentionTotal      *int         `json:"attention_total"`
	Items               []notifItem  `json:"items"`
	NextCursor          *string      `json:"next_cursor"`
	UnreadCount         int          `json:"unread_count"`
	UnreadNotifications int          `json:"unread_notifications"`
}

type notifPerson struct {
	UserID string  `json:"user_id"`
	Name   *string `json:"name"`
}

type notifItem struct {
	GroupKey    string `json:"group_key"`
	Type        string `json:"type"`
	Kind        string `json:"kind"`
	Urgency     string `json:"urgency"`
	Count       int    `json:"count"`
	UnreadCount int    `json:"unread_count"`
	Read        bool   `json:"read"`
	Resolved    bool   `json:"resolved"`
	LatestAt    string `json:"latest_at"`
	FirstAt     string `json:"first_at"`
	Job         struct {
		ID    string  `json:"id"`
		Title *string `json:"title"`
	} `json:"job"`
	Latest struct {
		ID        string          `json:"id"`
		CreatedAt string          `json:"created_at"`
		Actor     *notifPerson    `json:"actor"`
		Payload   json.RawMessage `json:"payload"`
	} `json:"latest"`
	Sample []struct {
		ParticipationID string  `json:"participation_id"`
		Name            *string `json:"name"`
	} `json:"sample"`
	Link     *map[string]string `json:"link"`
	FromUser *notifPerson       `json:"from_user,omitempty"`
	ToUser   *notifPerson       `json:"to_user,omitempty"`
}

func (w *notifWorld) page(t *testing.T, u notifUser, query string) notifPage {
	t.Helper()
	r := w.get(t, u, notifReadPath+query)
	if r.status != http.StatusOK {
		t.Fatalf("GET %s = %d; body=%s", query, r.status, r.body)
	}
	if got := r.header.Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	var p notifPage
	dec := json.NewDecoder(strings.NewReader(string(r.body)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&p); err != nil {
		t.Fatalf("decode %s: %v", r.body, err)
	}
	return p
}

func notifKeys(items []notifItem) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.GroupKey
	}
	return out
}

func notifJSONEqual(t *testing.T, got []byte, want string) {
	t.Helper()
	var g, wv any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatalf("decode got: %v", err)
	}
	if err := json.Unmarshal([]byte(want), &wv); err != nil {
		t.Fatalf("decode want: %v", err)
	}
	if !reflect.DeepEqual(g, wv) {
		gr, _ := json.MarshalIndent(g, "", "  ")
		wr, _ := json.MarshalIndent(wv, "", "  ")
		t.Fatalf("body mismatch\ngot:  %s\nwant: %s", gr, wr)
	}
}

func ts(d time.Duration) time.Time { return notifT0.Add(d) }

func ptr[T any](v T) *T { return &v }

func TestNotificationsRead_GroupedListShapesAndUnreadCount(t *testing.T) {
	w := newNotifWorld(t)
	appKey := fmt.Sprintf("applications:%s:2026-11-26", w.jobA)
	var appIDs []uuid.UUID
	for i, p := range w.parts {
		appIDs = append(appIDs, w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA,
			part: ptr(p), actor: ptr(w.candidates[i].id), at: ts(time.Duration(i) * time.Minute), read: i == 0}))
	}
	invitation := uuid.NewString()
	psychKey := fmt.Sprintf("psychometrics:%s:2026-11-26", w.jobA)
	psych := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "psychometric_completed", group: psychKey, job: w.jobA, part: ptr(w.parts[0]),
		actor: ptr(w.candidates[0].id), payload: `{"invitation_id":"` + invitation + `"}`, at: ts(10 * time.Minute)})
	reassigned := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_reassigned", job: w.jobB, actor: ptr(w.owner.id),
		payload: `{"from_user_id":"` + w.colleague.id.String() + `","reason":"workload"}`, at: ts(-time.Hour), read: true})
	overdue := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_overdue", job: w.jobA, commitment: "2026-11-25",
		payload: `{"commitment_date":"2026-11-25"}`, at: ts(-2 * time.Hour)})
	dueSoon := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_due_soon", job: w.jobB, commitment: "2026-11-27",
		payload: `{"commitment_date":"2026-11-27"}`, at: ts(-3 * time.Hour), resolved: true})
	unassigned := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_unassigned", job: w.jobB, actor: ptr(w.owner.id),
		payload: `{"to_user_id":"` + w.colleague.id.String() + `","reason":"workload"}`, at: ts(-4 * time.Hour)})

	r := w.get(t, w.recruiter, notifReadPath)
	if r.status != http.StatusOK || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("status=%d cache=%q body=%s", r.status, r.header.Get("Cache-Control"), r.body)
	}
	t.Logf("GET %s → %s", notifReadPath, r.body)
	jobA, jobB := w.jobA.String(), w.jobB.String()
	notifJSONEqual(t, r.body, `{
  "attention": [{
    "group_key": "n:`+overdue.String()+`", "type": "delivery_overdue", "kind": "mandatory", "urgency": "overdue",
    "count": 1, "unread_count": 1, "read": false, "resolved": false,
    "latest_at": "2026-11-26T13:00:00Z", "first_at": "2026-11-26T13:00:00Z",
    "job": {"id": "`+jobA+`", "title": "Analista de nómina"},
    "latest": {"id": "`+overdue.String()+`", "created_at": "2026-11-26T13:00:00Z", "actor": null, "payload": {"commitment_date": "2026-11-25"}},
    "sample": [], "link": {"kind": "vacancy_delivery", "job_id": "`+jobA+`"}
  }],
  "attention_total": 1,
  "items": [
    {
      "group_key": "`+psychKey+`", "type": "psychometric_completed", "kind": "operational", "urgency": "normal",
      "count": 1, "unread_count": 1, "read": false, "resolved": false,
      "latest_at": "2026-11-26T15:10:00Z", "first_at": "2026-11-26T15:10:00Z",
      "job": {"id": "`+jobA+`", "title": "Analista de nómina"},
      "latest": {"id": "`+psych.String()+`", "created_at": "2026-11-26T15:10:00Z", "actor": {"user_id": "`+w.candidates[0].id.String()+`", "name": "Ana López"}, "payload": {"invitation_id": "`+invitation+`"}},
      "sample": [{"participation_id": "`+w.parts[0].String()+`", "name": "Ana López"}],
      "link": {"kind": "participation", "job_id": "`+jobA+`", "participation_id": "`+w.parts[0].String()+`"}
    },
    {
      "group_key": "`+appKey+`", "type": "application_received", "kind": "operational", "urgency": "normal",
      "count": 4, "unread_count": 3, "read": false, "resolved": false,
      "latest_at": "2026-11-26T15:03:00Z", "first_at": "2026-11-26T15:00:00Z",
      "job": {"id": "`+jobA+`", "title": "Analista de nómina"},
      "latest": {"id": "`+appIDs[3].String()+`", "created_at": "2026-11-26T15:03:00Z", "actor": {"user_id": "`+w.candidates[3].id.String()+`", "name": "Diego Ruiz"}, "payload": {}},
      "sample": [
        {"participation_id": "`+w.parts[3].String()+`", "name": "Diego Ruiz"},
        {"participation_id": "`+w.parts[2].String()+`", "name": "Carla Díaz"},
        {"participation_id": "`+w.parts[1].String()+`", "name": "Luis Pérez"}
      ],
      "link": {"kind": "vacancy_candidates", "job_id": "`+jobA+`"}
    },
    {
      "group_key": "n:`+reassigned.String()+`", "type": "vacancy_reassigned", "kind": "mandatory", "urgency": "normal",
      "count": 1, "unread_count": 0, "read": true, "resolved": false,
      "latest_at": "2026-11-26T14:00:00Z", "first_at": "2026-11-26T14:00:00Z",
      "job": {"id": "`+jobB+`", "title": "Ejecutivo de ventas"},
      "latest": {"id": "`+reassigned.String()+`", "created_at": "2026-11-26T14:00:00Z", "actor": {"user_id": "`+w.owner.id.String()+`", "name": "Olga Owner"}, "payload": {"from_user_id": "`+w.colleague.id.String()+`", "reason": "workload"}},
      "sample": [], "link": {"kind": "vacancy", "job_id": "`+jobB+`"},
      "from_user": {"user_id": "`+w.colleague.id.String()+`", "name": "Carmen Colleague"}
    },
    {
      "group_key": "n:`+dueSoon.String()+`", "type": "delivery_due_soon", "kind": "operational", "urgency": "due_soon",
      "count": 1, "unread_count": 0, "read": true, "resolved": true,
      "latest_at": "2026-11-26T12:00:00Z", "first_at": "2026-11-26T12:00:00Z",
      "job": {"id": "`+jobB+`", "title": "Ejecutivo de ventas"},
      "latest": {"id": "`+dueSoon.String()+`", "created_at": "2026-11-26T12:00:00Z", "actor": null, "payload": {"commitment_date": "2026-11-27"}},
      "sample": [], "link": {"kind": "vacancy_delivery", "job_id": "`+jobB+`"}
    },
    {
      "group_key": "n:`+unassigned.String()+`", "type": "vacancy_unassigned", "kind": "mandatory", "urgency": "normal",
      "count": 1, "unread_count": 1, "read": false, "resolved": false,
      "latest_at": "2026-11-26T11:00:00Z", "first_at": "2026-11-26T11:00:00Z",
      "job": {"id": "`+jobB+`", "title": "Ejecutivo de ventas"},
      "latest": {"id": "`+unassigned.String()+`", "created_at": "2026-11-26T11:00:00Z", "actor": {"user_id": "`+w.owner.id.String()+`", "name": "Olga Owner"}, "payload": {"to_user_id": "`+w.colleague.id.String()+`", "reason": "workload"}},
      "sample": [], "link": {"kind": "vacancy", "job_id": "`+jobB+`"},
      "to_user": {"user_id": "`+w.colleague.id.String()+`", "name": "Carmen Colleague"}
    }
  ],
  "next_cursor": null,
  "unread_count": 4,
  "unread_notifications": 6
}`)

	c := w.get(t, w.recruiter, notifReadPath+"/unread-count")
	t.Logf("GET %s/unread-count → %s", notifReadPath, c.body)
	if c.status != http.StatusOK || !strings.Contains(c.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("unread-count status=%d cache=%q body=%s", c.status, c.header.Get("Cache-Control"), c.body)
	}
	notifJSONEqual(t, c.body, `{"unread_count": 4, "unread_notifications": 6}`)

	// Reads are not audited (D23) and never mark anything read.
	var audits, unread int
	if err := w.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM audit_events), (SELECT count(*) FROM notifications WHERE read_at IS NULL AND resolved_at IS NULL)`).Scan(&audits, &unread); err != nil {
		t.Fatal(err)
	}
	if audits != 0 || unread != 6 {
		t.Fatalf("audits=%d unread rows=%d, want 0 and 6", audits, unread)
	}
}

func TestNotificationsRead_FiltersAndValidationErrors(t *testing.T) {
	w := newNotifWorld(t)
	appKey := fmt.Sprintf("applications:%s:2026-11-26", w.jobA)
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[0]), at: ts(0)})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[1]), at: ts(time.Minute), read: true})
	overdue := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_overdue", job: w.jobA, at: ts(-time.Hour)})
	assignedB := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobB, at: ts(-2 * time.Hour), read: true})
	teamB := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_team_added", job: w.jobB, payload: `{"function":"member"}`, at: ts(-3 * time.Hour)})
	overdueKey, assignedKey, teamKey := "n:"+overdue.String(), "n:"+assignedB.String(), "n:"+teamB.String()

	cases := []struct {
		query     string
		attention []string
		total     int
		items     []string
	}{
		{"", []string{overdueKey}, 1, []string{appKey, assignedKey, teamKey}},
		{"?state=all", []string{overdueKey}, 1, []string{appKey, assignedKey, teamKey}},
		{"?state=unread", []string{overdueKey}, 1, []string{appKey, teamKey}},
		{"?types=application_received", []string{}, 0, []string{appKey}},
		{"?types=delivery_overdue", []string{overdueKey}, 1, []string{}},
		{"?types=vacancy_assigned,vacancy_team_added", []string{}, 0, []string{assignedKey, teamKey}},
		{"?job_ids=" + w.jobB.String(), []string{}, 0, []string{assignedKey, teamKey}},
		{"?job_ids=" + w.jobA.String() + "," + w.jobB.String() + "&state=unread", []string{overdueKey}, 1, []string{appKey, teamKey}},
		{"?job_ids=" + uuid.NewString(), []string{}, 0, []string{}},
		// A member asking for a candidate type gets an empty result, not an error.
		{"?types=candidate_status_changed", []string{}, 0, []string{}},
	}
	for _, tc := range cases {
		p := w.page(t, w.recruiter, tc.query)
		if p.Attention == nil || p.AttentionTotal == nil {
			t.Fatalf("%q: first page must carry attention", tc.query)
		}
		if got := notifKeys(*p.Attention); !reflect.DeepEqual(got, tc.attention) || *p.AttentionTotal != tc.total {
			t.Errorf("%q: attention=%v total=%d, want %v %d", tc.query, got, *p.AttentionTotal, tc.attention, tc.total)
		}
		if got := notifKeys(p.Items); !reflect.DeepEqual(got, tc.items) {
			t.Errorf("%q: items=%v, want %v", tc.query, got, tc.items)
		}
		// The counters are the caller's whole scope, never filtered.
		if p.UnreadCount != 3 || p.UnreadNotifications != 3 {
			t.Errorf("%q: unread=%d/%d, want 3/3", tc.query, p.UnreadCount, p.UnreadNotifications)
		}
	}

	ids := make([]string, 21)
	for i := range ids {
		ids[i] = uuid.NewString()
	}
	all := "application_received,delivery_due_soon,delivery_overdue,assignment_deadline_due_soon,assignment_deadline_overdue,vacancy_assigned,vacancy_reassigned,vacancy_unassigned,vacancy_team_added,psychometric_completed,psychometric_pending,candidate_status_changed,candidate_message_received,candidate_test_pending"
	first := w.page(t, w.recruiter, "?limit=1")
	if first.NextCursor == nil {
		t.Fatal("limit=1 over 3 groups must return a cursor")
	}
	errs := []struct{ query, want string }{
		{"?state=read", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"state","code":"invalid"}]}`},
		{"?types=bogus", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"types","code":"invalid"}]}`},
		{"?types=" + all + ",vacancy_assigned", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"types","code":"too_many"}]}`},
		{"?job_ids=not-a-uuid", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"job_ids","code":"invalid"}]}`},
		{"?job_ids=" + strings.Join(ids, ","), `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"job_ids","code":"too_many"}]}`},
		{"?limit=0", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"limit","code":"invalid"}]}`},
		{"?limit=51", `{"error":"invalid filter","code":"invalid_filter","fields":[{"field":"limit","code":"invalid"}]}`},
		{"?cursor=garbage", `{"error":"invalid cursor","code":"invalid_cursor"}`},
		{"?limit=1&state=unread&cursor=" + url.QueryEscape(*first.NextCursor), `{"error":"invalid cursor","code":"invalid_cursor"}`},
		{"?limit=1&types=application_received&cursor=" + url.QueryEscape(*first.NextCursor), `{"error":"invalid cursor","code":"invalid_cursor"}`},
	}
	for _, tc := range errs {
		r := w.get(t, w.recruiter, notifReadPath+tc.query)
		if r.status != http.StatusBadRequest {
			t.Errorf("%q: status=%d body=%s", tc.query, r.status, r.body)
			continue
		}
		notifJSONEqual(t, r.body, tc.want)
	}
	// The same cursor with the same filters (any limit) continues the list.
	next := w.page(t, w.recruiter, "?limit=5&cursor="+url.QueryEscape(*first.NextCursor))
	if next.Attention != nil || next.AttentionTotal != nil {
		t.Fatal("attention must be null with a cursor")
	}
	if got := notifKeys(next.Items); !reflect.DeepEqual(got, []string{assignedKey, teamKey}) {
		t.Fatalf("next items = %v", got)
	}
}

func TestNotificationsRead_CursorPaginationWithAttentionOverflow(t *testing.T) {
	w := newNotifWorld(t)
	var deadlines []string // newest first
	for i := 0; i < 22; i++ {
		id := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "delivery_overdue", job: w.jobA, at: ts(-time.Duration(i) * time.Minute)})
		deadlines = append(deadlines, "n:"+id.String())
	}
	appGroup := func(day int, at time.Time) string {
		key := fmt.Sprintf("applications:%s:2026-11-%02d", w.jobA, day)
		w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: key, job: w.jobA, part: ptr(w.parts[0]), at: at.Add(-30 * time.Second)})
		w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: key, job: w.jobA, part: ptr(w.parts[1]), at: at})
		return key
	}
	var apps []string
	for i := 0; i < 6; i++ { // t0-1m, -4m, … -16m
		apps = append(apps, appGroup(10+i, ts(-time.Duration(i*3+1)*time.Minute)))
	}
	late := appGroup(20, ts(-30*time.Minute))
	// Overflow deadlines (t0-20m, t0-21m) appear in items in their normal order.
	want := append(append(append([]string{}, apps...), deadlines[20], deadlines[21]), late)

	first := w.page(t, w.recruiter, "?limit=3")
	if first.Attention == nil || len(*first.Attention) != 20 || *first.AttentionTotal != 22 {
		t.Fatalf("attention len/total = %v/%v", first.Attention, first.AttentionTotal)
	}
	if got := notifKeys(*first.Attention); !reflect.DeepEqual(got, deadlines[:20]) {
		t.Fatalf("attention = %v, want the 20 newest", got)
	}
	// A group seen on page 1 receives a new row: it moves above the cursor and is
	// never returned twice.
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: apps[0], job: w.jobA, part: ptr(w.parts[2]), at: ts(time.Minute)})

	seen := notifKeys(first.Items)
	cursor := first.NextCursor
	pages := 1
	for cursor != nil {
		p := w.page(t, w.recruiter, "?limit=3&cursor="+url.QueryEscape(*cursor))
		if p.Attention != nil || p.AttentionTotal != nil {
			t.Fatalf("page %d: attention must be null with a cursor", pages+1)
		}
		seen = append(seen, notifKeys(p.Items)...)
		cursor = p.NextCursor
		pages++
	}
	if !reflect.DeepEqual(seen, want) || pages != 3 {
		t.Fatalf("pages=%d seen=%v\nwant=%v", pages, seen, want)
	}

	// Filters apply to attention and overflow alike.
	only := w.page(t, w.recruiter, "?types=delivery_overdue")
	if len(*only.Attention) != 20 || *only.AttentionTotal != 22 || !reflect.DeepEqual(notifKeys(only.Items), deadlines[20:]) {
		t.Fatalf("types=delivery_overdue: attention=%d total=%d items=%v", len(*only.Attention), *only.AttentionTotal, notifKeys(only.Items))
	}
	other := w.page(t, w.recruiter, "?job_ids="+w.jobB.String())
	if len(*other.Attention) != 0 || *other.AttentionTotal != 0 || len(other.Items) != 0 {
		t.Fatalf("job B: attention=%d total=%d items=%d", len(*other.Attention), *other.AttentionTotal, len(other.Items))
	}
	// state does not narrow attention; a read deadline leaves it and joins items.
	w.exec(t, `UPDATE notifications SET read_at=now() WHERE id=$1`, uuid.MustParse(strings.TrimPrefix(deadlines[0], "n:")))
	after := w.page(t, w.recruiter, "?state=unread&limit=50")
	if got := notifKeys(*after.Attention); *after.AttentionTotal != 21 || !reflect.DeepEqual(got, deadlines[1:21]) {
		t.Fatalf("after read: total=%d attention=%v", *after.AttentionTotal, got)
	}
	for _, k := range notifKeys(after.Items) {
		if k == deadlines[0] || k == deadlines[20] {
			t.Fatalf("state=unread items include %s", k)
		}
	}
	if !reflect.DeepEqual(notifKeys(after.Items)[len(after.Items)-2:], []string{deadlines[21], late}) {
		t.Fatalf("state=unread tail = %v", notifKeys(after.Items))
	}
}

func TestNotificationsRead_ScopeIsolation(t *testing.T) {
	w := newNotifWorld(t)
	mine := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_assigned", job: w.jobA, at: ts(0)})
	// Another user of the same company.
	colleagues := w.notify(t, notifRow{recipient: w.colleague.id, typ: "application_received", group: fmt.Sprintf("applications:%s:2026-11-26", w.jobA), job: w.jobA, part: ptr(w.parts[0]), at: ts(time.Minute)})
	// The same user, rows of another company (an earlier membership).
	w.notify(t, notifRow{recipient: w.recruiter.id, company: &w.other, typ: "vacancy_assigned", job: w.otherJob, at: ts(2 * time.Minute)})
	w.notify(t, notifRow{recipient: w.recruiter.id, company: &w.other, typ: "delivery_overdue", job: w.otherJob, at: ts(2 * time.Minute)})
	// Candidate rows are never visible on the member routes.
	w.notify(t, notifRow{recipient: w.recruiter.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.parts[0]), payload: `{"status":"in_process"}`, at: ts(3 * time.Minute)})
	w.notify(t, notifRow{recipient: w.candidate.id, candidate: true, typ: "candidate_status_changed", job: w.jobA, part: ptr(w.parts[0]), payload: `{"status":"in_process"}`, at: ts(3 * time.Minute)})

	p := w.page(t, w.recruiter, "?limit=50")
	if got := notifKeys(p.Items); !reflect.DeepEqual(got, []string{"n:" + mine.String()}) || len(*p.Attention) != 0 || *p.AttentionTotal != 0 {
		t.Fatalf("recruiter sees items=%v attention=%d", got, len(*p.Attention))
	}
	if p.UnreadCount != 1 || p.UnreadNotifications != 1 {
		t.Fatalf("recruiter unread = %d/%d", p.UnreadCount, p.UnreadNotifications)
	}
	c := w.get(t, w.recruiter, notifReadPath+"/unread-count")
	notifJSONEqual(t, c.body, `{"unread_count":1,"unread_notifications":1}`)

	cp := w.page(t, w.colleague, "")
	if len(cp.Items) != 1 || cp.Items[0].Latest.ID != colleagues.String() {
		t.Fatalf("colleague items = %v", notifKeys(cp.Items))
	}
	// The outsider (member of the other company) does not see the recruiter's rows there.
	op := w.page(t, w.outsider, "")
	if len(op.Items) != 0 || len(*op.Attention) != 0 || op.UnreadCount != 0 {
		t.Fatalf("outsider items=%v", notifKeys(op.Items))
	}
	// The stakeholder passes the gate and gets an empty result.
	sp := w.page(t, w.stakeholder, "")
	if len(sp.Items) != 0 || len(*sp.Attention) != 0 || sp.UnreadCount != 0 || sp.UnreadNotifications != 0 {
		t.Fatalf("stakeholder page = %+v", sp)
	}

	for _, path := range []string{notifReadPath, notifReadPath + "/unread-count"} {
		r := w.get(t, notifUser{}, path)
		if r.status != http.StatusUnauthorized || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
			t.Fatalf("%s anonymous: %d %q", path, r.status, r.header.Get("Cache-Control"))
		}
		r = w.get(t, w.candidate, path)
		if r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"forbidden"`) {
			t.Fatalf("%s candidate: %d %s", path, r.status, r.body)
		}
	}
	w.exec(t, `UPDATE companies SET deleted_at=now() WHERE id=$1`, w.company)
	if r := w.get(t, w.recruiter, notifReadPath); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"company_inactive"`) {
		t.Fatalf("deleted company: %d %s", r.status, r.body)
	}
}

func TestNotificationsRead_CandidateNamesGatedByCurrentVacancyAccess(t *testing.T) {
	w := newNotifWorld(t)
	appKey := fmt.Sprintf("applications:%s:2026-11-26", w.jobA)
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[0]), actor: ptr(w.candidates[0].id), at: ts(0)})
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[1]), actor: ptr(w.candidates[1].id), at: ts(time.Minute)})
	pendingKey := fmt.Sprintf("psychometrics_pending:%s:2026-11-26", w.jobA)
	w.notify(t, notifRow{recipient: w.recruiter.id, typ: "psychometric_pending", group: pendingKey, job: w.jobA, part: ptr(w.parts[2]), actor: ptr(w.owner.id), at: ts(-time.Minute)})
	unassigned := w.notify(t, notifRow{recipient: w.recruiter.id, typ: "vacancy_unassigned", job: w.jobA, actor: ptr(w.owner.id),
		payload: `{"to_user_id":"` + w.colleague.id.String() + `","reason":"performance"}`, at: ts(-time.Hour)})
	// The owner can open every vacancy of the company without an assignment.
	w.notify(t, notifRow{recipient: w.owner.id, typ: "application_received", group: appKey, job: w.jobA, part: ptr(w.parts[0]), actor: ptr(w.candidates[0].id), at: ts(0)})

	byKey := func(p notifPage) map[string]notifItem {
		out := map[string]notifItem{}
		for _, it := range p.Items {
			out[it.GroupKey] = it
		}
		return out
	}
	names := func(it notifItem) []any {
		var out []any
		for _, s := range it.Sample {
			if s.Name == nil {
				out = append(out, nil)
			} else {
				out = append(out, *s.Name)
			}
		}
		return out
	}

	// Names, titles and colleagues are resolved at read time.
	w.exec(t, `UPDATE users SET full_name='Ana María López' WHERE id=$1`, w.candidates[0].id)
	w.exec(t, `INSERT INTO company_candidate_corrections(company_id,user_id,corrections) VALUES($1,$2,'{"full_name":"Luis P. Corregido"}')`, w.company, w.candidates[1].id)
	w.exec(t, `UPDATE users SET full_name='Carmen C. Renamed' WHERE id=$1`, w.colleague.id)
	w.exec(t, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, w.jobA, []byte(`{"fields":{"title":"Analista de nómina Sr"}}`))

	before := byKey(w.page(t, w.recruiter, ""))
	app, pending, gone := before[appKey], before[pendingKey], before["n:"+unassigned.String()]
	if !reflect.DeepEqual(names(app), []any{"Luis P. Corregido", "Ana María López"}) || *app.Latest.Actor.Name != "Luis P. Corregido" {
		t.Fatalf("with access: sample=%v actor=%v", names(app), app.Latest.Actor)
	}
	if !reflect.DeepEqual(names(pending), []any{"Carla Díaz"}) || *app.Job.Title != "Analista de nómina Sr" {
		t.Fatalf("with access: pending=%v title=%v", names(pending), app.Job.Title)
	}
	if gone.Link == nil || (*gone.Link)["kind"] != "vacancy" || *gone.ToUser.Name != "Carmen C. Renamed" {
		t.Fatalf("with access: unassigned link=%v to_user=%v", gone.Link, gone.ToUser)
	}

	// The recruiter leaves the team of job A: the items stay, candidate names do not.
	w.unassign(t, w.jobA, w.recruiter.id)
	after := byKey(w.page(t, w.recruiter, ""))
	app, pending, gone = after[appKey], after[pendingKey], after["n:"+unassigned.String()]
	if len(after) != 3 || app.Count != 2 || !reflect.DeepEqual(names(app), []any{nil, nil}) || app.Latest.Actor == nil || app.Latest.Actor.Name != nil {
		t.Fatalf("after leaving: items=%d sample=%v actor=%+v", len(after), names(app), app.Latest.Actor)
	}
	if app.Sample[0].ParticipationID != w.parts[1].String() || *app.Job.Title != "Analista de nómina Sr" {
		t.Fatalf("after leaving: sample ids / title changed: %+v %v", app.Sample, app.Job.Title)
	}
	if !reflect.DeepEqual(names(pending), []any{nil}) || pending.Latest.Actor == nil || *pending.Latest.Actor.Name != "Olga Owner" {
		t.Fatalf("after leaving: pending=%v actor=%+v", names(pending), pending.Latest.Actor)
	}
	if gone.Link != nil || gone.ToUser == nil || *gone.ToUser.Name != "Carmen C. Renamed" || *gone.Latest.Actor.Name != "Olga Owner" {
		t.Fatalf("after leaving: unassigned link=%v to_user=%+v", gone.Link, gone.ToUser)
	}
	raw := w.get(t, w.recruiter, notifReadPath).body
	for _, name := range []string{"Ana María López", "Luis P. Corregido", "Carla Díaz"} {
		if strings.Contains(string(raw), name) {
			t.Fatalf("candidate name %q exposed after leaving the team: %s", name, raw)
		}
	}

	owner := byKey(w.page(t, w.owner, ""))
	if !reflect.DeepEqual(names(owner[appKey]), []any{"Ana María López"}) {
		t.Fatalf("owner sample = %v", names(owner[appKey]))
	}
}
