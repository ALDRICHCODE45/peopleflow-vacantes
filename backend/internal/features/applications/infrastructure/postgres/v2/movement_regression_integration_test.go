//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Exercise the actual HTTP adapter over the real store, with a trusted fixture
// company context. Authentication middleware is covered by cmd/api router tests.
func movementRequest(t *testing.T, m movementFixture, method string, vacancy, pid uuid.UUID, suffix, tag, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := boardhttp.NewHandler(m.board)
	r := chi.NewRouter()
	r.Get("/{id}/board", h.Board)
	r.Get("/{id}/participations/{pid}", h.Detail)
	r.Get("/{id}/participations/{pid}/history", h.History)
	r.Get("/{id}/participations/{pid}/cv", h.File)
	r.Post("/{id}/participations/{pid}/moves", h.Move)
	r.Post("/{id}/participations/{pid}/discard", h.Discard)
	r.Post("/{id}/participations/{pid}/recover", h.Recover)
	r.Post("/{id}/participations/{pid}/substate", h.SetSubstate)
	path := "/" + vacancy.String() + "/board"
	if pid != uuid.Nil {
		path = "/" + vacancy.String() + "/participations/" + pid.String() + suffix
	}
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req = req.WithContext(security.ContextWithCompanyContext(req.Context(), security.CompanyContext{CompanyID: m.company, UserID: m.recruiter}))
	if tag != "" {
		req.Header.Set("If-Match", tag)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("missing no-store", rec.Header())
	}
	return rec
}

func movementObject(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func movementKeys(t *testing.T, value any, want ...string) map[string]any {
	t.Helper()
	obj, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected object, got %T", value)
	}
	keys := make([]string, 0, len(obj))
	for key := range obj {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	sort.Strings(want)
	if !reflect.DeepEqual(keys, want) {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
	return obj
}
func movementItemKeys(t *testing.T, obj map[string]any, extra ...string) {
	t.Helper()
	movementKeys(t, obj, append([]string{"id", "stage_id", "version", "etag", "candidate", "applied_at", "source", "cv", "moved_at", "discard", "substate_id"}, extra...)...)
	movementKeys(t, obj["candidate"], "id", "full_name")
	movementKeys(t, obj["cv"], "id", "name")
}

func TestMovementRealCrossVacancyIsolation(t *testing.T) {
	a, b := setupMovement(t), setupMovement(t)
	beforeA, beforeB := a.snapshot(t), b.snapshot(t)
	for _, pair := range []struct {
		name         string
		own, foreign movementFixture
	}{{"A path B participation", a, b}, {"B path A participation", b, a}} {
		t.Run(pair.name, func(t *testing.T) {
			for _, route := range []struct{ method, suffix string }{{"POST", "/moves"}, {"GET", "/history"}, {"GET", ""}, {"GET", "/cv"}} {
				t.Run(route.method+route.suffix, func(t *testing.T) {
					// A valid foreign item tag must not bypass the vacancy predicate.
					rec := movementRequest(t, pair.own, route.method, pair.own.vacancy, pair.foreign.item.ID, route.suffix, pair.foreign.item.ETag, `{"to_stage_id":"`+pair.own.item.StageID+`"}`)
					obj := movementKeys(t, movementObject(t, rec.Body.Bytes()), "error", "code")
					if rec.Code != http.StatusNotFound || obj["code"] != "not_found" || rec.Header().Get("ETag") != "" {
						t.Fatal(rec.Code, rec.Body.String())
					}
				})
			}
			// Also forbid an owner from addressing the other company's correct path.
			rec := movementRequest(t, pair.own, "GET", pair.foreign.vacancy, pair.foreign.item.ID, "/cv", "", "")
			if rec.Code != 404 || movementObject(t, rec.Body.Bytes())["code"] != "not_found" {
				t.Fatal(rec.Code, rec.Body.String())
			}
		})
	}
	if beforeA != a.snapshot(t) || beforeB != b.snapshot(t) {
		t.Fatal("cross-vacancy requests wrote effects")
	}
}

func TestMovementExactWireProjection(t *testing.T) {
	m := setupMovement(t)
	rec := movementRequest(t, m, "GET", m.vacancy, uuid.Nil, "", "", "")
	if rec.Code != 200 || rec.Header().Get("ETag") != "" {
		t.Fatal(rec.Code, rec.Body.String())
	}
	obj := movementKeys(t, movementObject(t, rec.Body.Bytes()), "stages", "exit", "coverage", "participations", "substates")
	for _, stage := range obj["stages"].([]any) {
		movementKeys(t, stage, "id", "kind", "name", "count")
	}
	exit := movementKeys(t, obj["exit"], "id", "kind", "name", "count")
	if exit["kind"] != "discarded" {
		t.Fatal(exit)
	}
	movementKeys(t, obj["coverage"], "covered", "required", "full_coverage_reached_at")
	items := obj["participations"].([]any)
	if len(items) != 1 {
		t.Fatal(items)
	}
	item := items[0].(map[string]any)
	movementItemKeys(t, item)
	// Expected identity and CV are from intake fixtures/library, not the board DTO.
	cvs, err := m.library.List(context.Background(), m.sub)
	if err != nil || len(cvs) != 1 {
		t.Fatal(cvs, err)
	}
	if item["candidate"].(map[string]any)["id"] != m.actor.String() || item["candidate"].(map[string]any)["full_name"] != "Candidate" || item["source"] != "organic" || item["cv"].(map[string]any)["id"] != cvs[0].ID.String() || item["cv"].(map[string]any)["name"] != "Resume" {
		t.Fatal(item)
	}
	if item["applied_at"] != item["moved_at"] || item["stage_id"] != pipelineconfig.Defaults(m.vacancy).Stages[0].ID || item["version"] != "1" || item["etag"] != board.ETag(m.item.ID, 1) {
		t.Fatal(item)
	}
	target := pipelineconfig.Defaults(m.vacancy).Stages[1].ID
	rec = movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/moves", m.item.ETag, `{"to_stage_id":"`+target+`"}`)
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	moved := movementObject(t, rec.Body.Bytes())
	movementItemKeys(t, moved, "coverage")
	movementKeys(t, moved["coverage"], "covered", "required", "full_coverage_reached_at")
	if moved["etag"] != rec.Header().Get("ETag") || moved["etag"] != board.ETag(m.item.ID, 2) || moved["version"] != "2" || moved["stage_id"] != target || !reflect.DeepEqual(moved["candidate"], item["candidate"]) || !reflect.DeepEqual(moved["cv"], item["cv"]) || moved["source"] != "organic" {
		t.Fatal(moved, rec.Header())
	}
	at, err := time.Parse(time.RFC3339Nano, moved["moved_at"].(string))
	if err != nil || at.Before(m.item.AppliedAt) {
		t.Fatal("invalid moved_at", err)
	}
	rec = movementRequest(t, m, "GET", m.vacancy, m.item.ID, "/history", "", "")
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	history := movementKeys(t, movementObject(t, rec.Body.Bytes()), "items")["items"].([]any)
	if len(history) != 2 {
		t.Fatal(history)
	}
	for i, value := range history {
		entry := movementKeys(t, value, "kind", "from_stage_id", "to_stage_id", "hire", "departure", "actor", "at")
		actor := movementKeys(t, entry["actor"], "kind", "id", "full_name")
		if entry["hire"] != false || entry["departure"] != false {
			t.Fatal(entry)
		}
		if i == 0 {
			if entry["kind"] != "intake" || entry["from_stage_id"] != nil || entry["to_stage_id"] != item["stage_id"] || actor["kind"] != "candidate" || actor["id"] != m.actor.String() || actor["full_name"] != "Candidate" {
				t.Fatal(entry)
			}
		} else if entry["kind"] != "move" || entry["from_stage_id"] != item["stage_id"] || entry["to_stage_id"] != target || entry["at"] != moved["moved_at"] || actor["kind"] != "recruiter" || actor["id"] != m.recruiter.String() || actor["full_name"] != "Recruiter" {
			t.Fatal(entry)
		}
	}
}

// Complete the synthetic P2b fixture for writes guarded by publication readiness.
// The stored date is deliberately unchanged in delivery PUTs (date-window rule).
func readyMovementConfiguration(t *testing.T, m movementFixture) {
	t.Helper()
	ctx := context.Background()
	requester := uuid.New()
	if _, err := m.pool.Exec(ctx, `INSERT INTO job_draft_requesters(id,company_id,kind,name,name_key,normalization_version) VALUES($1,$2,'internal_area','Engineering','ENGINEERING',1)`, requester, m.company); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM job_draft_requesters WHERE id=$1`, requester); err != nil {
			t.Error(err)
		}
	})
	d, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Engineer","location":"CDMX","work_mode":"remote","work_schedule":"full_time","contract_type":"indefinite","professional_area":"technology_systems","requester":{"kind":"internal_area","id":"` + requester.String() + `"},"description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Role"}]}]}},"screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, m.vacancy, d.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO job_draft_management_configs(draft_id,version,request_date,hiring_headcount) VALUES($1,1,'2020-01-01',1)`,
		`INSERT INTO job_draft_delivery_configs(draft_id,version,cutoff_stage_id,target_quantity,commitment_date) VALUES($1,1,$2,1,'2020-01-02')`,
	} {
		args := []any{m.vacancy}
		if strings.Contains(q, "$2") {
			args = append(args, pipelineconfig.Defaults(m.vacancy).Stages[3].ID)
		}
		if _, err = m.pool.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
}
func movementDeliveryBody(m movementFixture) []byte {
	return []byte(`{"cutoffStageId":"` + pipelineconfig.Defaults(m.vacancy).Stages[2].ID + `","targetQuantity":2,"commitmentDate":"2020-01-02"}`)
}

func TestMovementOccupantsDoNotLockSubstatesOrDelivery(t *testing.T) {
	m := setupMovement(t)
	readyMovementConfiguration(t, m)
	ctx := context.Background()
	for _, tc := range []struct {
		name    string
		get     func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
		put     func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (drafts.Result, error)
		body    []byte
		version string
	}{
		{"substates", m.drafts.GetSubstates, m.drafts.PutSubstates, []byte(`{"substates":[{"name":"Interview"}]}`), "1"},
		{"delivery", m.drafts.GetDelivery, m.drafts.PutDelivery, movementDeliveryBody(m), "2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			previous, err := tc.get(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal(err)
			}
			saved, err := tc.put(ctx, m.company, m.recruiter, m.vacancy, previous.ETag, true, tc.body)
			if err != nil || saved.ETag == previous.ETag || movementObject(t, saved.Body)["version"] != tc.version {
				t.Fatal(saved, err)
			}
			obj := movementObject(t, saved.Body)
			if tc.name == "substates" {
				values := obj["substates"].([]any)
				if len(values) != 1 || values[0].(map[string]any)["name"] != "Interview" {
					t.Fatal(obj)
				}
			} else if obj["cutoffStageId"] != pipelineconfig.Defaults(m.vacancy).Stages[2].ID || obj["targetQuantity"] != float64(2) || obj["commitmentDate"] != "2020-01-02" {
				t.Fatal(obj)
			}
			reread, err := tc.get(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || !reflect.DeepEqual(saved, reread) {
				t.Fatal("save was not persisted", err)
			}
			// Renaming/configuring these resources cannot move or version an occupant.
			detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil || !reflect.DeepEqual(detail.Item, m.item) {
				t.Fatal(detail, err)
			}
		})
	}
	// Independent configuration writes append only their own audit events.
	history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil || len(history.Items) != 1 {
		t.Fatal(history, err)
	}
	var audits int
	if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type IN ('JobDraftSubstatesConfigured','JobDraftDeliveryConfigured')`, m.vacancy).Scan(&audits); err != nil || audits != 2 {
		t.Fatal(audits, err)
	}
}

func TestMovementReorderedBuiltinsUseCurrentOrder(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	// A second, still-unpublished vacancy has no participations. Keep the original
	// fixture intact so cleanup and retained-CV assertions remain independent.
	id := uuid.New()
	if _, err := m.pool.Exec(ctx, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, id, m.vacancy); err != nil {
		t.Fatal(err)
	}
	original := m.vacancy
	m.vacancy = id
	t.Cleanup(func() {
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM audit_events WHERE entity_id=$1`, id); err != nil {
			t.Error(err)
		}
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM job_draft_idempotency WHERE company_id=$1`, m.company); err != nil {
			t.Error(err)
		}
	})
	readyMovementConfiguration(t, m)
	// Use a future business date from the API's calendar, not wall-clock guesses.
	delivery, err := m.drafts.GetDelivery(ctx, m.company, m.recruiter, id)
	if err != nil {
		t.Fatal(err)
	}
	calendar := movementObject(t, delivery.Body)["calendar"].(map[string]any)
	nonbusiness := map[string]bool{}
	for _, day := range calendar["nonBusinessDates"].([]any) {
		nonbusiness[day.(string)] = true
	}
	date, err := time.Parse(time.DateOnly, calendar["today"].(string))
	if err != nil {
		t.Fatal(err)
	}
	for nonbusiness[date.Format(time.DateOnly)] {
		date = date.AddDate(0, 0, 1)
	}
	if _, err = m.drafts.PutDelivery(ctx, m.company, m.recruiter, id, delivery.ETag, true, []byte(`{"cutoffStageId":"`+pipelineconfig.Defaults(id).Stages[3].ID+`","targetQuantity":1,"commitmentDate":"`+date.Format(time.DateOnly)+`"}`)); err != nil {
		t.Fatal(err)
	}
	empty, err := m.drafts.GetPipeline(ctx, m.company, m.recruiter, id)
	if err != nil || movementObject(t, empty.Body)["structure_locked"] != false {
		t.Fatal("new vacancy must have no occupants", err)
	}
	c := pipelineconfig.Defaults(id)
	oldNext := c.Stages[1].ID
	c.Stages[1], c.Stages[2], c.Stages[3] = c.Stages[3], c.Stages[1], c.Stages[2]
	if _, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, id, pipelineconfig.ETag(id, 0), true, movementPipelineBody(t, c)); err != nil {
		t.Fatal(err)
	}
	tag, err := draftversion.FormatETagV2(id.String(), 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.drafts.Publish(ctx, m.company, m.recruiter, id, uuid.NewString(), true, tag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	created, err := m.store.Apply(ctx, m.sub, id, uuid.New(), m.request(m.item.CV.ID))
	if err != nil {
		t.Fatal(err)
	}
	var submitted app.Submitted
	if err = json.Unmarshal(created.Body, &submitted); err != nil {
		t.Fatal(err)
	}
	detail, err := m.board.Detail(ctx, m.company, m.recruiter, id, submitted.ID)
	if err != nil {
		t.Fatal(err)
	}
	before := m.snapshot(t)
	if _, err = m.move(t, detail.Item, oldNext, false); !errors.Is(err, board.ErrStageSkip) || before != m.snapshot(t) {
		t.Fatal("old next must be an atomic skip rejection", err)
	}
	moved, err := m.move(t, detail.Item, c.Stages[1].ID, false)
	if err != nil || moved.StageID != c.Stages[1].ID || moved.Version != "2" {
		t.Fatal(moved, err)
	}
	if _, err = m.move(t, moved.Item, oldNext, false); err != nil {
		t.Fatal("new next rejected", err)
	}
	// Original participation was never moved.
	other, err := m.board.Detail(ctx, m.company, m.recruiter, original, m.item.ID)
	if err != nil || other.Version != "1" {
		t.Fatal(other, err)
	}
}
