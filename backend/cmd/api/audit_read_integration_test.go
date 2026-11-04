//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/google/uuid"
)

// Audit screen API (audit-log-v1 §8). Everything goes through the production
// router, auth, owner gate, stores and database. SQL only seeds rows the
// emitters would write and reads the rows the export writes.

const auditEventsPath = "/v2/me/company/audit-events"

var auditMX = func() *time.Location {
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		panic(err)
	}
	return loc
}()

// --- fixtures ---------------------------------------------------------------

type auditSeed struct {
	id         uuid.UUID
	at         time.Time
	actor      *uuid.UUID // nil => system event
	eventType  string
	entityType string
	entity     uuid.UUID
	metadata   string // JSON text; "" => {}
	vacancy    *uuid.UUID
	ip         string
	ua         string
	source     string
}

// seedAudit inserts one row for the company, as an emitter would have, and
// returns its id. Company cleanup removes it.
func seedAudit(t *testing.T, h *draftFlowHarness, company uuid.UUID, s auditSeed) uuid.UUID {
	t.Helper()
	if s.id == uuid.Nil {
		s.id = uuid.Must(uuid.NewV7())
	}
	if s.at.IsZero() {
		s.at = time.Now()
	}
	if s.entityType == "" {
		s.entityType = "company"
	}
	if s.entity == uuid.Nil {
		s.entity = company
	}
	if s.metadata == "" {
		s.metadata = "{}"
	}
	actorType := "user"
	if s.actor == nil {
		actorType = "system"
	}
	var ip, ua, source any
	if s.ip != "" {
		ip = s.ip
	}
	if s.ua != "" {
		ua = s.ua
	}
	if s.source != "" {
		source = s.source
	}
	if _, err := h.pool.Exec(context.Background(),
		`INSERT INTO audit_events (id, occurred_at, actor_id, actor_type, event_type, entity_type, entity_id, metadata, company_id, vacancy_id, ip, user_agent, ip_source)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::inet,$12,$13)`,
		s.id, s.at, s.actor, actorType, s.eventType, s.entityType, s.entity, s.metadata, company, s.vacancy, ip, ua, source); err != nil {
		t.Fatalf("seed audit row: %v", err)
	}
	return s.id
}

func seedVacancy(t *testing.T, h *draftFlowHarness, company, owner uuid.UUID, title string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	fields, _ := json.Marshal(map[string]any{"fields": map[string]any{"title": title}})
	if _, err := h.pool.Exec(context.Background(),
		`INSERT INTO job_drafts (id, company_id, created_by, fields) VALUES ($1,$2,$3,$4)`,
		id, company, owner, fields); err != nil {
		t.Fatalf("seed vacancy: %v", err)
	}
	return id
}

func setUserName(t *testing.T, h *draftFlowHarness, user uuid.UUID, name, email string) {
	t.Helper()
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET full_name=$2, email=$3 WHERE id=$1`, user, name, email); err != nil {
		t.Fatal(err)
	}
}

func auditCandidateActor(t *testing.T, h *draftFlowHarness) draftFlowActor {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	sub := "audit-read-candidate-" + id.String()
	if _, err := h.pool.Exec(context.Background(),
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type) VALUES ($1,$2,$3,'Candidata','candidate')`,
		id, sub, sub+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := h.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	return h.actor(t, id, sub)
}

type auditScreen struct {
	h         *draftFlowHarness
	company   *draftFlowCompany
	owner     draftFlowActor
	recruiter draftFlowActor
	// emails are unique per screen: users.email is unique among live users.
	ownerEmail, recruiterEmail string
}

func uniqueEmail(prefix string) string { return prefix + "-" + uuid.NewString() + "@example.test" }

func newAuditScreen(t *testing.T) *auditScreen {
	t.Helper()
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	ownerEmail, recruiterEmail := uniqueEmail("olga"), uniqueEmail("rosa")
	setUserName(t, h, ownerID, "Olga Dueña", ownerEmail)
	setUserName(t, h, recruiterID, "Rosa Reclutadora", recruiterEmail)
	return &auditScreen{h: h, company: company, owner: h.actor(t, ownerID, ownerSub), recruiter: h.actor(t, recruiterID, recruiterSub), ownerEmail: ownerEmail, recruiterEmail: recruiterEmail}
}

func (s *auditScreen) get(t *testing.T, path string) draftFlowResponse {
	t.Helper()
	return s.h.do(t, "GET", auditEventsPath+path, "", s.owner.token, nil)
}

func (s *auditScreen) list(t *testing.T, query string) map[string]any {
	t.Helper()
	r := s.get(t, "?"+query)
	draftFlowAssertNoStore(t, r)
	if r.status != 200 {
		t.Fatalf("list %q: %d %s", query, r.status, r.body)
	}
	return draftFlowObject(t, r.body)
}

func (s *auditScreen) export(t *testing.T, body string) draftFlowResponse {
	t.Helper()
	return s.h.do(t, "POST", auditEventsPath+"/export", body, s.owner.token, map[string]string{"Content-Type": "application/json"})
}

func itemsOf(t *testing.T, page map[string]any) []map[string]any {
	t.Helper()
	raw, ok := page["items"].([]any)
	if !ok {
		t.Fatalf("items is not an array: %v", page)
	}
	out := make([]map[string]any, len(raw))
	for i, item := range raw {
		out[i] = item.(map[string]any)
	}
	return out
}

func idsOf(items []map[string]any) []string {
	out := make([]string, len(items))
	for i, item := range items {
		out[i] = item["id"].(string)
	}
	return out
}

func exactKeys(t *testing.T, value any, keys ...string) map[string]any {
	t.Helper()
	obj, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("not an object: %v", value)
	}
	got := make([]string, 0, len(obj))
	for k := range obj {
		got = append(got, k)
	}
	sort.Strings(got)
	want := append([]string(nil), keys...)
	sort.Strings(want)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("keys = %v, want %v (%v)", got, want, obj)
	}
	return obj
}

// --- gates -------------------------------------------------------------------

func TestAuditRead_OwnerOnlyAndNoStore(t *testing.T) {
	s := newAuditScreen(t)
	candidate := auditCandidateActor(t, s.h)
	routes := []struct{ method, path, body string }{
		{"GET", auditEventsPath, ""},
		{"GET", auditEventsPath + "/types", ""},
		{"GET", auditEventsPath + "/actors", ""},
		{"GET", auditEventsPath + "/vacancies", ""},
		{"POST", auditEventsPath + "/export", `{"from":"2026-01-01","to":"2026-01-31"}`},
	}
	before := auditCompanyCount(t, s.h.pool, s.company.companyID)
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			headers := map[string]string{"Content-Type": "application/json"}
			anonymous := s.h.do(t, route.method, route.path, route.body, "", headers)
			draftFlowAssertError(t, anonymous, 401, "unauthenticated")
			recruiter := s.h.do(t, route.method, route.path, route.body, s.recruiter.token, headers)
			draftFlowAssertError(t, recruiter, 403, "forbidden")
			cand := s.h.do(t, route.method, route.path, route.body, candidate.token, headers)
			if cand.status != 403 {
				t.Fatalf("candidate: %d %s", cand.status, cand.body)
			}
			draftFlowAssertNoStore(t, cand)
			owner := s.h.do(t, route.method, route.path, route.body, s.owner.token, headers)
			draftFlowAssertNoStore(t, owner)
			if owner.status != 200 {
				t.Fatalf("owner: %d %s", owner.status, owner.body)
			}
		})
	}
	// The owner's exports wrote exactly one row; the rejected callers wrote none.
	if n := len(auditRowsOf(t, s.h.pool, s.company.companyID, "AuditLogExported")); n != 1 {
		t.Fatalf("AuditLogExported rows = %d, want 1 (the owner's)", n)
	}
	if got := auditCompanyCount(t, s.h.pool, s.company.companyID); got != before+1 {
		t.Fatalf("rows = %d, want %d: viewing is not audited", got, before+1)
	}
}

// --- list shape, order, isolation ---------------------------------------------

func TestAuditRead_ListShapeActorsVacanciesAndMetadata(t *testing.T) {
	s := newAuditScreen(t)
	company := s.company.companyID
	foreign := newAuditScreen(t)
	vacancy := seedVacancy(t, s.h, company, s.owner.userID, "Ejecutivo de ventas")
	gone := uuid.Must(uuid.NewV7())
	deletedUser := uuid.Must(uuid.NewV7())
	formerID, _ := s.company.addUser(t, "recruiter")
	formerEmail := uniqueEmail("fabian")
	setUserName(t, s.h, formerID, "Fabián Ex", formerEmail)
	if _, err := s.h.pool.Exec(context.Background(), `DELETE FROM company_members WHERE user_id=$1`, formerID); err != nil {
		t.Fatal(err)
	}
	base := time.Date(2025, 3, 10, 17, 3, 12, 441_000_000, time.UTC)

	system := seedAudit(t, s.h, company, auditSeed{at: base, eventType: "CompanyUpdated"})
	withVacancy := seedAudit(t, s.h, company, auditSeed{at: base.Add(time.Second), actor: &s.owner.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: vacancy, vacancy: &vacancy,
		metadata: `{"version":3}`, ip: "201.141.12.7", ua: "Mozilla/5.0 Test", source: "bff"})
	deletedVacancy := seedAudit(t, s.h, company, auditSeed{at: base.Add(2 * time.Second), actor: &s.recruiter.userID, eventType: "ParticipationViewed", entityType: "process_participation", vacancy: &gone, source: "peer", ip: "2001:db8::1"})
	former := seedAudit(t, s.h, company, auditSeed{at: base.Add(3 * time.Second), actor: &formerID, eventType: "SessionEnded", entityType: "user", entity: formerID})
	deleted := seedAudit(t, s.h, company, auditSeed{at: base.Add(4 * time.Second), actor: &deletedUser, eventType: "SessionStarted", entityType: "user", entity: deletedUser})
	jsonNull := seedAudit(t, s.h, company, auditSeed{at: base.Add(5 * time.Second), actor: &s.owner.userID, eventType: "CompanyUpdated", metadata: "null"})
	seedAudit(t, s.h, company, auditSeed{at: base.Add(6 * time.Second), actor: &s.owner.userID, eventType: "LegacyUnknownType"})
	seedAudit(t, foreign.h, foreign.company.companyID, auditSeed{at: base.Add(7 * time.Second), actor: &foreign.owner.userID, eventType: "CompanyUpdated"})

	page := s.list(t, "")
	exactKeys(t, page, "items", "total", "next_cursor")
	items := itemsOf(t, page)
	if page["total"] != float64(6) || page["next_cursor"] != nil || len(items) != 6 {
		t.Fatalf("total=%v next=%v items=%d (foreign and out-of-catalog rows must not appear)", page["total"], page["next_cursor"], len(items))
	}
	want := []uuid.UUID{jsonNull, deleted, former, deletedVacancy, withVacancy, system}
	for i, id := range want {
		if items[i]["id"] != id.String() {
			t.Fatalf("order: got %v", idsOf(items))
		}
	}
	for _, item := range items {
		exactKeys(t, item, "id", "occurred_at", "event_type", "category", "actor", "entity", "vacancy", "metadata", "ip", "ip_source", "user_agent")
		exactKeys(t, item["entity"], "type", "id", "label")
	}

	// system event: closed {type:"system"}, category from the catalog, no network data.
	sys := items[5]
	if !reflect.DeepEqual(sys["actor"], map[string]any{"type": "system"}) || sys["category"] != "company" || sys["event_type"] != "CompanyUpdated" ||
		sys["occurred_at"] != "2025-03-10T17:03:12.441Z" || sys["vacancy"] != nil || sys["ip"] != nil || sys["ip_source"] != nil || sys["user_agent"] != nil ||
		!reflect.DeepEqual(sys["metadata"], map[string]any{}) {
		t.Fatalf("system item: %v", sys)
	}
	// user + vacancy + network data.
	first := items[4]
	exactKeys(t, first["actor"], "type", "user_id", "name", "email", "is_current_member")
	if !reflect.DeepEqual(first["actor"], map[string]any{"type": "user", "user_id": s.owner.userID.String(), "name": "Olga Dueña", "email": s.ownerEmail, "is_current_member": true}) ||
		!reflect.DeepEqual(first["vacancy"], map[string]any{"id": vacancy.String(), "title": "Ejecutivo de ventas"}) ||
		!reflect.DeepEqual(first["metadata"], map[string]any{"version": float64(3)}) ||
		first["ip"] != "201.141.12.7" || first["ip_source"] != "bff" || first["user_agent"] != "Mozilla/5.0 Test" || first["category"] != "vacancy" {
		t.Fatalf("user item: %v", first)
	}
	exactKeys(t, first["vacancy"], "id", "title")
	// deleted vacancy: the vacancy object stays, its title is null.
	if !reflect.DeepEqual(items[3]["vacancy"], map[string]any{"id": gone.String(), "title": nil}) || items[3]["ip"] != "2001:db8::1" || items[3]["ip_source"] != "peer" {
		t.Fatalf("deleted vacancy item: %v", items[3])
	}
	// former member keeps name and email; is_current_member is false.
	if !reflect.DeepEqual(items[2]["actor"], map[string]any{"type": "user", "user_id": formerID.String(), "name": "Fabián Ex", "email": formerEmail, "is_current_member": false}) {
		t.Fatalf("former member: %v", items[2]["actor"])
	}
	// deleted user: name and email null.
	if !reflect.DeepEqual(items[1]["actor"], map[string]any{"type": "user", "user_id": deletedUser.String(), "name": nil, "email": nil, "is_current_member": false}) {
		t.Fatalf("deleted user: %v", items[1]["actor"])
	}
	// JSON null metadata is served as an empty object (the closed shape).
	if !reflect.DeepEqual(items[0]["metadata"], map[string]any{}) {
		t.Fatalf("null metadata: %v", items[0]["metadata"])
	}
}

func TestAuditRead_EmptyListIsAnEmptyArray(t *testing.T) {
	s := newAuditScreen(t)
	page := s.list(t, "")
	exactKeys(t, page, "items", "total", "next_cursor")
	if items, ok := page["items"].([]any); !ok || len(items) != 0 || page["total"] != float64(0) || page["next_cursor"] != nil {
		t.Fatalf("%v", page)
	}
}

// --- filters ------------------------------------------------------------------

func TestAuditRead_Filters(t *testing.T) {
	s := newAuditScreen(t)
	company := s.company.companyID
	vacancyA := seedVacancy(t, s.h, company, s.owner.userID, "A")
	vacancyB := seedVacancy(t, s.h, company, s.owner.userID, "B")
	// Mexico City is UTC-6 in March (no DST since 2022): the boundaries of 2025-03-10 are
	// 2025-03-10T06:00:00Z (inclusive) and 2025-03-11T06:00:00Z (exclusive).
	at := func(s string) time.Time {
		ts, err := time.Parse(time.RFC3339, s)
		if err != nil {
			t.Fatal(err)
		}
		return ts
	}
	rows := map[string]uuid.UUID{
		"before":     seedAudit(t, s.h, company, auditSeed{at: at("2025-03-10T05:59:59Z"), actor: &s.owner.userID, eventType: "SessionStarted", entityType: "user", entity: s.owner.userID}),
		"dayStart":   seedAudit(t, s.h, company, auditSeed{at: at("2025-03-10T06:00:00Z"), actor: &s.owner.userID, eventType: "SessionEnded", entityType: "user", entity: s.owner.userID}),
		"dayEnd":     seedAudit(t, s.h, company, auditSeed{at: at("2025-03-11T05:59:59Z"), actor: &s.recruiter.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: vacancyA, vacancy: &vacancyA}),
		"after":      seedAudit(t, s.h, company, auditSeed{at: at("2025-03-11T06:00:00Z"), actor: &s.recruiter.userID, eventType: "VacancyResumed", entityType: "job_draft", entity: vacancyB, vacancy: &vacancyB}),
		"pipeline":   seedAudit(t, s.h, company, auditSeed{at: at("2025-03-10T12:00:00Z"), actor: &s.recruiter.userID, eventType: "ParticipationMoved", entityType: "process_participation", vacancy: &vacancyB}),
		"systemRow":  seedAudit(t, s.h, company, auditSeed{at: at("2025-03-10T13:00:00Z"), eventType: "CompanyUpdated"}),
		"sessionEnd": seedAudit(t, s.h, company, auditSeed{at: at("2025-03-10T14:00:00Z"), actor: &s.recruiter.userID, eventType: "SessionEnded", entityType: "user", entity: s.recruiter.userID}),
	}
	ids := func(names ...string) []string {
		// newest first, as the list is ordered
		all := []struct {
			name string
			at   time.Time
		}{}
		for _, n := range names {
			var ts time.Time
			if err := s.h.pool.QueryRow(context.Background(), `SELECT occurred_at FROM audit_events WHERE id=$1`, rows[n]).Scan(&ts); err != nil {
				t.Fatal(err)
			}
			all = append(all, struct {
				name string
				at   time.Time
			}{n, ts})
		}
		sort.Slice(all, func(i, j int) bool { return all[i].at.After(all[j].at) })
		out := make([]string, len(all))
		for i, a := range all {
			out[i] = rows[a.name].String()
		}
		return out
	}
	for _, tc := range []struct {
		name, query string
		want        []string
	}{
		{"no filter", "", ids("before", "dayStart", "dayEnd", "after", "pipeline", "systemRow", "sessionEnd")},
		{"actor", "actor_id=" + s.recruiter.userID.String(), ids("dayEnd", "after", "pipeline", "sessionEnd")},
		{"one type", "event_type=SessionEnded", ids("dayStart", "sessionEnd")},
		{"types are ORed", "event_type=SessionEnded&event_type=VacancyPaused", ids("dayStart", "dayEnd", "sessionEnd")},
		{"repeated equal type", "event_type=SessionEnded&event_type=SessionEnded", ids("dayStart", "sessionEnd")},
		{"category", "category=session", ids("before", "dayStart", "sessionEnd")},
		{"category AND type", "category=session&event_type=SessionEnded&event_type=VacancyPaused", ids("dayStart", "sessionEnd")},
		{"category AND type, empty", "category=team&event_type=SessionEnded", ids()},
		{"vacancy", "vacancy_id=" + vacancyB.String(), ids("after", "pipeline")},
		{"from only", "from=2025-03-11", ids("after")},
		{"to only", "to=2025-03-10", ids("before", "dayStart", "dayEnd", "pipeline", "systemRow", "sessionEnd")},
		{"whole inclusive day", "from=2025-03-10&to=2025-03-10", ids("dayStart", "dayEnd", "pipeline", "systemRow", "sessionEnd")},
		{"several filters", "actor_id=" + s.recruiter.userID.String() + "&category=pipeline&from=2025-03-10&to=2025-03-10", ids("pipeline")},
		{"unknown actor", "actor_id=" + uuid.NewString(), ids()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			page := s.list(t, tc.query)
			got := idsOf(itemsOf(t, page))
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("got  %v\nwant %v", got, tc.want)
			}
			if page["total"] != float64(len(tc.want)) {
				t.Fatalf("total = %v, want %d", page["total"], len(tc.want))
			}
		})
	}
}

// --- pagination -----------------------------------------------------------------

func TestAuditRead_PaginationAndCursor(t *testing.T) {
	s := newAuditScreen(t)
	foreign := newAuditScreen(t)
	company := s.company.companyID
	base := time.Date(2025, 3, 10, 12, 0, 0, 0, time.UTC)
	// Seven rows, two pairs sharing one timestamp: the id breaks the tie.
	want := []string{}
	for i := 0; i < 7; i++ {
		id := seedAudit(t, s.h, company, auditSeed{at: base.Add(time.Duration(i/2) * time.Minute), actor: &s.owner.userID, eventType: "SessionEnded", entityType: "user", entity: s.owner.userID})
		want = append(want, id.String())
	}
	var ordered []string
	rows, err := s.h.pool.Query(context.Background(), `SELECT id FROM audit_events WHERE company_id=$1 ORDER BY occurred_at DESC, id DESC`, company)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ordered = append(ordered, id.String())
	}
	rows.Close()
	if len(ordered) != len(want) {
		t.Fatalf("fixture: %d rows", len(ordered))
	}

	var got []string
	query := "event_type=SessionEnded&limit=3"
	cursors := []string{}
	for page := 0; page < 5; page++ {
		res := s.list(t, query)
		items := itemsOf(t, res)
		got = append(got, idsOf(items)...)
		if res["total"] != float64(7) {
			t.Fatalf("total must not shrink with the page: %v", res["total"])
		}
		next, _ := res["next_cursor"].(string)
		if next == "" {
			if page != 2 || len(items) != 1 {
				t.Fatalf("last page: page=%d items=%d", page, len(items))
			}
			break
		}
		if len(items) != 3 {
			t.Fatalf("page %d has %d items", page, len(items))
		}
		cursors = append(cursors, next)
		query = "event_type=SessionEnded&limit=3&cursor=" + url.QueryEscape(next)
	}
	if !reflect.DeepEqual(got, ordered) {
		t.Fatalf("pages\n got  %v\n want %v", got, ordered)
	}
	if len(cursors) != 2 {
		t.Fatalf("cursors = %d", len(cursors))
	}
	// A page of exactly `limit` rows left has no next cursor.
	if last := s.list(t, "event_type=SessionEnded&limit=7"); last["next_cursor"] != nil || len(itemsOf(t, last)) != 7 {
		t.Fatalf("exact fit: %v", last["next_cursor"])
	}
	// The limit may change between pages; it is not part of the filter hash.
	if res := s.list(t, "event_type=SessionEnded&limit=2&cursor="+url.QueryEscape(cursors[0])); len(itemsOf(t, res)) != 2 {
		t.Fatal("limit change with a cursor")
	}

	// Bad, foreign and filter-mismatched cursors: 400 invalid_cursor.
	foreignCursor := cursors[0]
	for name, tc := range map[string]struct {
		actor draftFlowActor
		query string
	}{
		"other filters":      {s.owner, "event_type=SessionStarted&cursor=" + url.QueryEscape(foreignCursor)},
		"no filters":         {s.owner, "cursor=" + url.QueryEscape(foreignCursor)},
		"garbage":            {s.owner, "cursor=%21%21%21"},
		"empty":              {s.owner, "cursor="},
		"another company":    {foreign.owner, "event_type=SessionEnded&limit=3&cursor=" + url.QueryEscape(foreignCursor)},
		"truncated":          {s.owner, "event_type=SessionEnded&limit=3&cursor=" + url.QueryEscape(foreignCursor[:len(foreignCursor)-3])},
		"oversized":          {s.owner, "cursor=" + strings.Repeat("A", 5000)},
		"limit does not fix": {s.owner, "event_type=SessionStarted&limit=3&cursor=" + url.QueryEscape(foreignCursor)},
	} {
		t.Run(name, func(t *testing.T) {
			r := s.h.do(t, "GET", auditEventsPath+"?"+tc.query, "", tc.actor.token, nil)
			draftFlowAssertError(t, r, 400, "invalid_cursor")
			if string(r.body) != `{"error":"invalid cursor","code":"invalid_cursor"}`+"\n" {
				t.Fatalf("%s", r.body)
			}
		})
	}
}

// --- strict parser ------------------------------------------------------------------

func TestAuditRead_InvalidFilterEnvelope(t *testing.T) {
	s := newAuditScreen(t)
	for _, tc := range []struct {
		name, query, fields string
	}{
		{"unknown", "foo=bar", `[{"field":"foo","code":"unknown"}]`},
		{"duplicate", "category=session&category=team", `[{"field":"category","code":"duplicate"}]`},
		{"duplicate from", "from=2026-01-01&from=2026-01-02", `[{"field":"from","code":"duplicate"}]`},
		{"invalid uuid", "actor_id=SECRET", `[{"field":"actor_id","code":"invalid"}]`},
		{"invalid vacancy", "vacancy_id=SECRET", `[{"field":"vacancy_id","code":"invalid"}]`},
		{"type outside the catalog", "event_type=SECRET", `[{"field":"event_type","code":"invalid"}]`},
		{"category outside the list", "category=SECRET", `[{"field":"category","code":"invalid"}]`},
		{"bad date", "from=SECRET", `[{"field":"from","code":"invalid"}]`},
		{"range", "from=2026-02-02&to=2026-02-01", `[{"field":"to","code":"range"}]`},
		{"limit 0", "limit=0", `[{"field":"limit","code":"invalid"}]`},
		{"limit 101", "limit=101", `[{"field":"limit","code":"invalid"}]`},
		{"limit text", "limit=SECRET", `[{"field":"limit","code":"invalid"}]`},
		{"several, sorted by field", "to=SECRET&actor_id=SECRET&zzz=1", `[{"field":"actor_id","code":"invalid"},{"field":"to","code":"invalid"},{"field":"zzz","code":"unknown"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := s.get(t, "?"+tc.query)
			want := `{"error":"invalid filter","code":"invalid_filter","fields":` + tc.fields + `}` + "\n"
			if r.status != 422 || string(r.body) != want {
				t.Fatalf("%d %s\nwant %s", r.status, r.body, want)
			}
			draftFlowAssertNoStore(t, r)
			if strings.Contains(string(r.body), "SECRET") {
				t.Fatal("the rejected value was echoed")
			}
		})
	}
	// Limit 100 is accepted.
	s.list(t, "limit=100")
}

// --- entity labels --------------------------------------------------------------------

func TestAuditRead_EntityLabelsAreResolvedAtReadTime(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			auditCleanupCompany(t, f)
			company := f.company.companyID
			ownerView := &auditScreen{h: f.h, company: f.company, owner: f.owner, recruiter: f.recruiter}
			setUserName(t, f.h, f.recruiter.userID, "Rosa Reclutadora", uniqueEmail("rosa"))

			var candidateName string
			table := map[string]string{"manual": "company_candidates", "organic": "users"}[kind]
			if err := f.h.pool.QueryRow(context.Background(), `SELECT full_name FROM `+table+` WHERE id=$1`, f.id).Scan(&candidateName); err != nil {
				t.Fatal(err)
			}
			vacancy := f.vacancy(t)
			var vacancyTitle string
			if err := f.h.pool.QueryRow(context.Background(), `SELECT convert_from(fields,'UTF8')::jsonb->'fields'->>'title' FROM job_drafts WHERE id=$1`, vacancy).Scan(&vacancyTitle); err != nil {
				t.Fatal(err)
			}
			var companyName string
			if err := f.h.pool.QueryRow(context.Background(), `SELECT name FROM companies WHERE id=$1`, company).Scan(&companyName); err != nil {
				t.Fatal(err)
			}

			// Emitted by the real routes: the pool detail and the CV download.
			if r := f.detail(t); r.status != 200 {
				t.Fatalf("detail %d", r.status)
			}
			if r := f.h.do(t, "GET", f.pathCV, "", f.recruiter.token, nil); r.status != 200 {
				t.Fatalf("cv %d", r.status)
			}
			label := func(eventType string) any {
				items := itemsOf(t, ownerView.list(t, "event_type="+eventType))
				if len(items) == 0 {
					t.Fatalf("no %s row", eventType)
				}
				entity := exactKeys(t, items[0]["entity"], "type", "id", "label")
				return entity["label"]
			}
			if got := label("CompanyCandidateViewed"); got != candidateName {
				t.Fatalf("company_candidate label = %v, want %q", got, candidateName)
			}
			if got := label("CompanyCandidateCVDownloaded"); got != candidateName {
				t.Fatalf("cv download label = %v, want %q", got, candidateName)
			}

			// Seeded rows of every other entity type.
			missing := uuid.Must(uuid.NewV7())
			seed := func(eventType, entityType string, entity uuid.UUID, metadata string) {
				seedAudit(t, f.h, company, auditSeed{actor: &f.owner.userID, eventType: eventType, entityType: entityType, entity: entity, metadata: metadata})
			}
			seed("ParticipationViewed", "process_participation", f.pid, "")
			seed("VacancyPaused", "job_draft", vacancy, "")
			seed("VacancyTeamCreated", "vacancy", vacancy, "")
			seed("VacancyDeliveryFulfilled", "vacancy_process", vacancy, "")
			seed("CompanyUpdated", "company", company, "")
			seed("CompanyMemberRoleChanged", "company_member", uuid.Must(uuid.NewV7()), fmt.Sprintf(`{"member_user_id":%q}`, f.recruiter.userID))
			seed("CompanyMemberAdded", "company_member", uuid.Must(uuid.NewV7()), fmt.Sprintf(`{"member_user_id":%q}`, missing))
			seed("CompanyMemberOffboarded", "company_member", uuid.Must(uuid.NewV7()), "")
			seed("CompanyCandidateEdited", "company_candidate", missing, "")
			seed("VacancyClosed", "job_draft", missing, "")
			seed("SessionEnded", "user", f.owner.userID, "")
			seed("VacancyReopened", "vacancy", missing, "")
			seed("VacancyResumed", "vacancy_process", missing, "")
			seed("ParticipationMoved", "process_participation", missing, "")

			for _, tc := range []struct {
				eventType string
				want      any
			}{
				{"ParticipationViewed", candidateName},
				{"VacancyPaused", vacancyTitle},
				{"VacancyTeamCreated", vacancyTitle},
				{"VacancyDeliveryFulfilled", vacancyTitle},
				{"CompanyUpdated", companyName},
				{"CompanyMemberRoleChanged", "Rosa Reclutadora"},
				{"CompanyMemberAdded", nil},      // member user gone
				{"CompanyMemberOffboarded", nil}, // no member_user_id in the metadata
				{"CompanyCandidateEdited", nil},  // candidate gone
				{"VacancyClosed", nil},           // vacancy gone
				{"SessionEnded", nil},            // type without a label
				{"VacancyReopened", nil},         // vacancy gone
				{"VacancyResumed", nil},          // vacancy_process gone
				{"ParticipationMoved", nil},      // participation gone
			} {
				if got := label(tc.eventType); got != tc.want {
					t.Errorf("%s label = %v, want %v", tc.eventType, got, tc.want)
				}
			}

			// Resolved at read time: renaming changes the label of the same row.
			if kind == "manual" {
				if _, err := f.h.pool.Exec(context.Background(), `UPDATE company_candidates SET full_name='Nombre Nuevo' WHERE id=$1`, f.id); err != nil {
					t.Fatal(err)
				}
				if got := label("CompanyCandidateViewed"); got != "Nombre Nuevo" {
					t.Fatalf("label after rename = %v", got)
				}
			}
		})
	}
}

// An organic candidate's corrected name is the visible one.
func TestAuditRead_OrganicLabelUsesTheCompanyCorrection(t *testing.T) {
	f := newCandidateCVFixture(t, "organic")
	auditCleanupCompany(t, f)
	screen := &auditScreen{h: f.h, company: f.company, owner: f.owner, recruiter: f.recruiter}
	f.exec(t, `INSERT INTO company_candidate_corrections(company_id,user_id,corrections,updated_by) VALUES($1,$2,'{"full_name":"Nombre Corregido"}'::jsonb,$3)`, f.company.companyID, f.id, f.owner.userID)
	f.detail(t)
	items := itemsOf(t, screen.list(t, "event_type=CompanyCandidateViewed"))
	if len(items) != 1 || items[0]["entity"].(map[string]any)["label"] != "Nombre Corregido" {
		t.Fatalf("%v", items)
	}
}

// --- catalogs ----------------------------------------------------------------------

func TestAuditRead_Types(t *testing.T) {
	s := newAuditScreen(t)
	r := s.get(t, "/types")
	draftFlowAssertNoStore(t, r)
	want := []map[string]any{}
	for _, spec := range auditentities.Catalog() {
		want = append(want, map[string]any{"event_type": spec.Type, "category": string(spec.Category)})
	}
	body := draftFlowObject(t, r.body)
	exactKeys(t, body, "items")
	got := itemsOf(t, body)
	if r.status != 200 || len(got) != len(want) || len(got) != 63 {
		t.Fatalf("%d items, status %d", len(got), r.status)
	}
	for i := range want {
		exactKeys(t, got[i], "event_type", "category")
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Fatalf("item %d: %v want %v", i, got[i], want[i])
		}
	}
}

func TestAuditRead_Actors(t *testing.T) {
	s := newAuditScreen(t)
	foreign := newAuditScreen(t)
	company := s.company.companyID
	emails := map[string]string{}
	other := func(role, name string) uuid.UUID {
		id, _ := s.company.addUser(t, role)
		emails[name] = uniqueEmail("actor")
		setUserName(t, s.h, id, name, emails[name])
		return id
	}
	zoe := other("recruiter", "Zoe Zapata")
	beto := other("recruiter", "beto minúscula")
	former := other("recruiter", "Ana Ex")
	silent := other("recruiter", "Sin Eventos")
	if _, err := s.h.pool.Exec(context.Background(), `DELETE FROM company_members WHERE user_id=$1`, former); err != nil {
		t.Fatal(err)
	}
	deletedUser := uuid.Must(uuid.NewV7())
	for _, actor := range []*uuid.UUID{&zoe, &beto, &former, &deletedUser, &s.owner.userID, &zoe} {
		seedAudit(t, s.h, company, auditSeed{actor: actor, eventType: "SessionStarted", entityType: "user", entity: *actor})
	}
	seedAudit(t, s.h, company, auditSeed{eventType: "CompanyUpdated"}) // system: no actor option
	seedAudit(t, foreign.h, foreign.company.companyID, auditSeed{actor: &foreign.owner.userID, eventType: "SessionStarted", entityType: "user", entity: foreign.owner.userID})
	seedAudit(t, s.h, company, auditSeed{actor: &silent, eventType: "LegacyUnknownType"}) // outside the catalog

	r := s.get(t, "/actors")
	draftFlowAssertNoStore(t, r)
	body := draftFlowObject(t, r.body)
	exactKeys(t, body, "items")
	got := itemsOf(t, body)
	member := func(id uuid.UUID, name, email string, current bool) map[string]any {
		return map[string]any{"user_id": id.String(), "name": name, "email": email, "is_current_member": current}
	}
	want := []map[string]any{
		member(former, "Ana Ex", emails["Ana Ex"], false),
		member(beto, "beto minúscula", emails["beto minúscula"], true),
		member(s.owner.userID, "Olga Dueña", s.ownerEmail, true),
		member(zoe, "Zoe Zapata", emails["Zoe Zapata"], true),
		{"user_id": deletedUser.String(), "name": nil, "email": nil, "is_current_member": false},
	}
	if r.status != 200 || len(got) != len(want) {
		t.Fatalf("%d %v", r.status, got)
	}
	for i := range want {
		exactKeys(t, got[i], "user_id", "name", "email", "is_current_member")
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Fatalf("actor %d: %v want %v", i, got[i], want[i])
		}
	}
}

func TestAuditRead_Vacancies(t *testing.T) {
	s := newAuditScreen(t)
	foreign := newAuditScreen(t)
	company := s.company.companyID
	zeta := seedVacancy(t, s.h, company, s.owner.userID, "Zeta")
	alfa := seedVacancy(t, s.h, company, s.owner.userID, "alfa")
	unused := seedVacancy(t, s.h, company, s.owner.userID, "Sin eventos")
	gone := uuid.Must(uuid.NewV7())
	foreignVacancy := seedVacancy(t, foreign.h, foreign.company.companyID, foreign.owner.userID, "De otra empresa")
	for _, v := range []uuid.UUID{zeta, alfa, alfa, gone, zeta} {
		v := v
		seedAudit(t, s.h, company, auditSeed{actor: &s.owner.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: v, vacancy: &v})
	}
	seedAudit(t, s.h, company, auditSeed{actor: &s.owner.userID, eventType: "SessionStarted", entityType: "user", entity: s.owner.userID}) // no vacancy
	seedAudit(t, foreign.h, foreign.company.companyID, auditSeed{actor: &foreign.owner.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: foreignVacancy, vacancy: &foreignVacancy})
	_ = unused

	r := s.get(t, "/vacancies")
	draftFlowAssertNoStore(t, r)
	body := draftFlowObject(t, r.body)
	exactKeys(t, body, "items")
	got := itemsOf(t, body)
	want := []map[string]any{
		{"vacancy_id": alfa.String(), "title": "alfa"},
		{"vacancy_id": zeta.String(), "title": "Zeta"},
		{"vacancy_id": gone.String(), "title": nil}, // deleted: title null, ordered last
	}
	if r.status != 200 || len(got) != len(want) {
		t.Fatalf("%d %v", r.status, got)
	}
	for i := range want {
		exactKeys(t, got[i], "vacancy_id", "title")
		if !reflect.DeepEqual(got[i], want[i]) {
			t.Fatalf("vacancy %d: %v want %v", i, got[i], want[i])
		}
	}
}

// --- export ---------------------------------------------------------------------------

var auditCSVHeader = []string{"occurred_at", "occurred_at_mx", "event_type", "category", "actor_user_id", "actor_name", "actor_email", "entity_type", "entity_id", "entity_label", "vacancy_id", "vacancy_title", "ip", "user_agent", "metadata"}

func parseCSV(t *testing.T, body []byte) [][]string {
	t.Helper()
	if !bytes.HasPrefix(body, []byte("\xEF\xBB\xBF")) {
		t.Fatalf("no UTF-8 BOM: %q", body[:min(len(body), 8)])
	}
	rows, err := csv.NewReader(bytes.NewReader(body[3:])).ReadAll()
	if err != nil {
		t.Fatalf("csv: %v\n%s", err, body)
	}
	return rows
}

func exportedRows(t *testing.T, s *auditScreen) []auditRow {
	t.Helper()
	return auditRowsOf(t, s.h.pool, s.company.companyID, "AuditLogExported")
}

func TestAuditRead_ExportValidation(t *testing.T) {
	s := newAuditScreen(t)
	for _, tc := range []struct {
		name, body, fields string
	}{
		{"both missing", `{}`, `[{"field":"from","code":"required"},{"field":"to","code":"required"}]`},
		{"from missing", `{"to":"2026-01-31"}`, `[{"field":"from","code":"required"}]`},
		{"to missing", `{"from":"2026-01-31"}`, `[{"field":"to","code":"required"}]`},
		{"null is missing", `{"from":null,"to":null}`, `[{"field":"from","code":"required"},{"field":"to","code":"required"}]`},
		{"malformed from", `{"from":"31/01/2026","to":"2026-01-31"}`, `[{"field":"from","code":"invalid"}]`},
		{"malformed to", `{"from":"2026-01-01","to":"2026-02-30"}`, `[{"field":"to","code":"invalid"}]`},
		{"from after to", `{"from":"2026-02-02","to":"2026-02-01"}`, `[{"field":"to","code":"range"}]`},
		{"367 days", `{"from":"2025-01-01","to":"2026-01-02"}`, `[{"field":"to","code":"range"}]`},
		{"unknown field", `{"from":"2026-01-01","to":"2026-01-31","limit":5}`, `[{"field":"limit","code":"unknown"}]`},
		{"duplicate field", `{"from":"2026-01-01","from":"2026-01-01","to":"2026-01-31"}`, `[{"field":"from","code":"duplicate"}]`},
		{"type outside the catalog", `{"from":"2026-01-01","to":"2026-01-31","event_types":["SECRET"]}`, `[{"field":"event_types","code":"invalid"}]`},
		{"types must be an array", `{"from":"2026-01-01","to":"2026-01-31","event_types":"SessionEnded"}`, `[{"field":"event_types","code":"invalid"}]`},
		{"bad category", `{"from":"2026-01-01","to":"2026-01-31","category":"SECRET"}`, `[{"field":"category","code":"invalid"}]`},
		{"bad actor", `{"from":"2026-01-01","to":"2026-01-31","actor_id":"SECRET"}`, `[{"field":"actor_id","code":"invalid"}]`},
		{"bad vacancy", `{"from":"2026-01-01","to":"2026-01-31","vacancy_id":7}`, `[{"field":"vacancy_id","code":"invalid"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := s.export(t, tc.body)
			want := `{"error":"invalid filter","code":"invalid_filter","fields":` + tc.fields + `}` + "\n"
			if r.status != 422 || string(r.body) != want {
				t.Fatalf("%d %s\nwant %s", r.status, r.body, want)
			}
			draftFlowAssertNoStore(t, r)
			if strings.Contains(string(r.body), "SECRET") {
				t.Fatal("the rejected value was echoed")
			}
		})
	}
	for name, body := range map[string]string{"empty": ``, "array": `[]`, "string": `"x"`, "truncated": `{"from":`, "two values": `{} {}`} {
		t.Run("body "+name, func(t *testing.T) {
			r := s.export(t, body)
			draftFlowAssertError(t, r, 400, "invalid_request")
		})
	}
	// 1 Jan–31 Dec of a leap year (366 days, both ends inclusive) passes.
	if r := s.export(t, `{"from":"2024-01-01","to":"2024-12-31"}`); r.status != 200 {
		t.Fatalf("366 days: %d %s", r.status, r.body)
	}
	// Every rejection wrote nothing: one row for the one accepted export.
	if n := len(exportedRows(t, s)); n != 1 {
		t.Fatalf("AuditLogExported rows = %d, want 1", n)
	}
}

func TestAuditRead_ExportTooLargeExportsNothing(t *testing.T) {
	s := newAuditScreen(t)
	company := s.company.companyID
	s.h.audit.WithExportLimit(3)
	base := time.Date(2025, 3, 10, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 4; i++ {
		seedAudit(t, s.h, company, auditSeed{at: base.Add(time.Duration(i) * time.Minute), actor: &s.owner.userID, eventType: "SessionEnded", entityType: "user", entity: s.owner.userID})
	}
	before := auditCompanyCount(t, s.h.pool, company)
	r := s.export(t, `{"from":"2025-03-10","to":"2025-03-10"}`)
	draftFlowAssertNoStore(t, r)
	if r.status != 422 || string(r.body) != `{"error":"audit export too large","code":"audit_export_too_large","row_count":4,"limit":3}`+"\n" {
		t.Fatalf("%d %s", r.status, r.body)
	}
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") || r.header.Get("Content-Disposition") != "" {
		t.Fatalf("headers: %v", r.header)
	}
	exactKeys(t, draftFlowObject(t, r.body), "error", "code", "row_count", "limit")
	if got := auditCompanyCount(t, s.h.pool, company); got != before {
		t.Fatalf("a refused export wrote %d rows", got-before)
	}
	// Exactly at the limit is allowed; the filters narrow the count.
	if r := s.export(t, `{"from":"2025-03-10","to":"2025-03-10","event_types":["SessionEnded"],"actor_id":"`+uuid.NewString()+`"}`); r.status != 200 {
		t.Fatalf("narrowed: %d %s", r.status, r.body)
	}
	s.h.audit.WithExportLimit(4)
	r = s.export(t, `{"from":"2025-03-10","to":"2025-03-10"}`)
	if r.status != 200 || len(parseCSV(t, r.body)) != 5 {
		t.Fatalf("at the limit: %d", r.status)
	}
}

func TestAuditRead_ExportCSV(t *testing.T) {
	s := newAuditScreen(t)
	foreign := newAuditScreen(t)
	company := s.company.companyID
	vacancy := seedVacancy(t, s.h, company, s.owner.userID, "=Ventas")
	injectedEmail := "-" + uniqueEmail("rosa")
	setUserName(t, s.h, s.recruiter.userID, "+Rosa", injectedEmail)
	// 2025-03-10 17:03:12.441Z is 11:03:12 in Mexico City.
	older := time.Date(2025, 3, 10, 17, 3, 12, 441_000_000, time.UTC)
	newer := older.Add(time.Hour)
	outside := time.Date(2025, 3, 11, 12, 0, 0, 0, time.UTC)
	seedAudit(t, s.h, company, auditSeed{at: older, actor: &s.recruiter.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: vacancy, vacancy: &vacancy,
		metadata: `{"version":3}`, ip: "201.141.12.7", ua: "@Mozilla, \"quoted\"\nline", source: "bff"})
	seedAudit(t, s.h, company, auditSeed{at: newer, eventType: "CompanyUpdated"})
	seedAudit(t, s.h, company, auditSeed{at: outside, actor: &s.owner.userID, eventType: "SessionEnded", entityType: "user", entity: s.owner.userID})
	seedAudit(t, foreign.h, foreign.company.companyID, auditSeed{at: older, actor: &foreign.owner.userID, eventType: "SessionEnded", entityType: "user", entity: foreign.owner.userID})

	body := `{"actor_id":null,"event_types":[],"category":null,"vacancy_id":null,"from":"2025-03-10","to":"2025-03-10"}`
	today := func() string { return time.Now().In(auditMX).Format("2006-01-02") }
	dayBefore := today()
	r := s.export(t, body)
	dayAfter := today()
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	if got := r.header.Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("Content-Type = %q", got)
	}
	if got := r.header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	disposition := r.header.Get("Content-Disposition")
	if disposition != `attachment; filename="auditoria-`+dayBefore+`.csv"` && disposition != `attachment; filename="auditoria-`+dayAfter+`.csv"` {
		t.Fatalf("Content-Disposition = %q", disposition)
	}
	rows := parseCSV(t, r.body)
	if !reflect.DeepEqual(rows[0], auditCSVHeader) {
		t.Fatalf("header = %v", rows[0])
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want header + 2 (other days and other companies excluded): %v", len(rows), rows)
	}
	// Newest first, like the list; the injection guard prefixes ' to = + - @ .
	if !reflect.DeepEqual(rows[1], []string{"2025-03-10T18:03:12.441Z", "2025-03-10T12:03:12.441-06:00", "CompanyUpdated", "company", "", "", "", "company", company.String(), companyNameOf(t, s), "", "", "", "", "{}"}) {
		t.Fatalf("system row: %q", rows[1])
	}
	if !reflect.DeepEqual(rows[2], []string{"2025-03-10T17:03:12.441Z", "2025-03-10T11:03:12.441-06:00", "VacancyPaused", "vacancy", s.recruiter.userID.String(), "'+Rosa", "'" + injectedEmail, "job_draft", vacancy.String(), "'=Ventas", vacancy.String(), "'=Ventas", "201.141.12.7", "'@Mozilla, \"quoted\"\nline", `{"version":3}`}) {
		t.Fatalf("user row: %q", rows[2])
	}

	// The export is audited: entity company, filters and row_count, by the owner.
	audit := exportedRows(t, s)
	if len(audit) != 1 {
		t.Fatalf("AuditLogExported rows = %d", len(audit))
	}
	row := audit[0]
	if row.ActorType != "user" || row.ActorID == nil || *row.ActorID != s.owner.userID || row.EntityType != "company" || row.EntityID != company ||
		row.CompanyID == nil || *row.CompanyID != company || row.VacancyID != nil || row.IPSource == nil || *row.IPSource != "peer" {
		t.Fatalf("audit row: %+v", row)
	}
	exactKeys(t, row.Metadata, "filters", "row_count")
	if row.Metadata["row_count"] != float64(len(rows)-1) || !reflect.DeepEqual(row.Metadata["filters"], map[string]any{"from": "2025-03-10", "to": "2025-03-10"}) {
		t.Fatalf("metadata: %v", row.Metadata)
	}
	// The export's own row is not in the file it records.
	for _, line := range rows[1:] {
		if line[2] == "AuditLogExported" {
			t.Fatal("the file contains its own audit row")
		}
	}
}

func companyNameOf(t *testing.T, s *auditScreen) string {
	t.Helper()
	var name string
	if err := s.h.pool.QueryRow(context.Background(), `SELECT name FROM companies WHERE id=$1`, s.company.companyID).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

func TestAuditRead_ExportAppliesTheListFiltersAndAuditsThem(t *testing.T) {
	s := newAuditScreen(t)
	company := s.company.companyID
	vacancy := seedVacancy(t, s.h, company, s.owner.userID, "Vacante")
	at := time.Date(2025, 3, 10, 15, 0, 0, 0, time.UTC)
	keep := seedAudit(t, s.h, company, auditSeed{at: at, actor: &s.recruiter.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: vacancy, vacancy: &vacancy})
	seedAudit(t, s.h, company, auditSeed{at: at.Add(time.Minute), actor: &s.recruiter.userID, eventType: "VacancyResumed", entityType: "job_draft", entity: vacancy, vacancy: &vacancy})
	seedAudit(t, s.h, company, auditSeed{at: at.Add(2 * time.Minute), actor: &s.owner.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: vacancy, vacancy: &vacancy})
	seedAudit(t, s.h, company, auditSeed{at: at.Add(3 * time.Minute), actor: &s.recruiter.userID, eventType: "VacancyPaused", entityType: "job_draft", entity: uuid.Must(uuid.NewV7())})
	_ = keep

	filters := fmt.Sprintf(`{"actor_id":%q,"event_types":["VacancyPaused","VacancyPaused"],"category":"vacancy","vacancy_id":%q,"from":"2025-03-10","to":"2025-03-10"}`, s.recruiter.userID, vacancy)
	r := s.export(t, filters)
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	rows := parseCSV(t, r.body)
	if len(rows) != 2 || rows[1][2] != "VacancyPaused" || rows[1][4] != s.recruiter.userID.String() {
		t.Fatalf("%q", rows)
	}
	audit := exportedRows(t, s)
	if len(audit) != 1 {
		t.Fatalf("AuditLogExported rows = %d", len(audit))
	}
	if !reflect.DeepEqual(audit[0].Metadata["filters"], map[string]any{
		"actor_id": s.recruiter.userID.String(), "event_types": []any{"VacancyPaused"}, "category": "vacancy", "vacancy_id": vacancy.String(), "from": "2025-03-10", "to": "2025-03-10",
	}) || audit[0].Metadata["row_count"] != float64(1) {
		t.Fatalf("metadata: %v", audit[0].Metadata)
	}
	if audit[0].VacancyID != nil {
		t.Fatal("the export row is a company event: no vacancy_id column")
	}

	// An empty result is a valid file: header only, row_count 0, still audited.
	empty := s.export(t, `{"from":"2020-01-01","to":"2020-01-02"}`)
	if got := parseCSV(t, empty.body); empty.status != 200 || len(got) != 1 {
		t.Fatalf("empty: %d %v", empty.status, got)
	}
	if audit := exportedRows(t, s); len(audit) != 2 || audit[1].Metadata["row_count"] != float64(0) {
		t.Fatalf("%v", audit)
	}
}

// The AuditLogExported row is committed before the first byte: when the
// response headers reach the client, the row is already visible.
func TestAuditRead_ExportRecordIsCommittedBeforeStreaming(t *testing.T) {
	s := newAuditScreen(t)
	company := s.company.companyID
	for i := 0; i < 20; i++ {
		seedAudit(t, s.h, company, auditSeed{at: time.Date(2025, 3, 10, 12, 0, i, 0, time.UTC), actor: &s.owner.userID, eventType: "SessionEnded", entityType: "user", entity: s.owner.userID})
	}
	req, err := http.NewRequest("POST", s.h.server.URL+auditEventsPath+"/export", strings.NewReader(`{"from":"2025-03-10","to":"2025-03-10"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+s.owner.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.h.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if n := len(exportedRows(t, s)); n != 1 {
		t.Fatalf("rows visible when the headers arrive = %d, want 1", n)
	}
	rest, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if got := parseCSV(t, rest); len(got) != 21 {
		t.Fatalf("rows = %d", len(got))
	}
}

// Viewing the screen is never audited.
func TestAuditRead_ViewingIsNotAudited(t *testing.T) {
	s := newAuditScreen(t)
	seedAudit(t, s.h, s.company.companyID, auditSeed{eventType: "CompanyUpdated"})
	before := auditCompanyCount(t, s.h.pool, s.company.companyID)
	for _, path := range []string{"", "/types", "/actors", "/vacancies", "?category=company&limit=1"} {
		if r := s.get(t, path); r.status != 200 {
			t.Fatalf("%s: %d %s", path, r.status, r.body)
		}
	}
	if got := auditCompanyCount(t, s.h.pool, s.company.companyID); got != before {
		t.Fatalf("viewing wrote %d rows", got-before)
	}
}
