//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	boardhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func duplicateRequest(t *testing.T, m movementFixture, id uuid.UUID, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/{id}/duplicates-check", boardhttp.NewHandler(m.board).DuplicatesCheck)
	req := httptest.NewRequest("POST", "/"+id.String()+"/duplicates-check", strings.NewReader(body))
	req = req.WithContext(security.ContextWithCompanyContext(req.Context(), security.CompanyContext{CompanyID: m.company, UserID: m.recruiter}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal(w.Header())
	}
	return w
}

func duplicateExec(t *testing.T, m movementFixture, sql string, args ...any) {
	t.Helper()
	if _, err := m.pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}

func TestManualDuplicatesExactMatchesMasksOrderingAndScope(t *testing.T) {
	m := manualReadFixture(t, false)
	foreign := manualReadFixture(t, false)
	foreignOrganic := setupMovement(t)
	organic := fulfillmentOther(t, m)
	const phone = "+521234561234"
	duplicateExec(t, m, `UPDATE company_candidates SET phone=$2 WHERE id=$1`, m.item.Candidate.ID, phone)
	duplicateExec(t, foreign, `UPDATE company_candidates SET phone=$2 WHERE id=$1`, foreign.item.Candidate.ID, phone)
	// Both foreign identity types match the requested phone but must stay hidden.
	// Registered after the fixtures, so it runs before their user cleanup.
	t.Cleanup(func() {
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM candidate_profiles WHERE user_id IN ($1,$2)`, organic.Candidate.ID, foreignOrganic.actor); err != nil {
			t.Error(err)
		}
	})
	for _, pair := range []struct {
		m  movementFixture
		id uuid.UUID
	}{{m, organic.Candidate.ID}, {foreignOrganic, foreignOrganic.actor}} {
		duplicateExec(t, pair.m, `INSERT INTO candidate_profiles(user_id,phone) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone`, pair.id, phone)
	}
	duplicateExec(t, m, `UPDATE process_participations SET created_at='2026-01-01T00:00:00Z' WHERE id IN ($1,$2)`, m.item.ID, organic.ID)
	duplicateExec(t, m, `UPDATE vacancy_public_projections SET title='Current title' WHERE id=$1`, m.vacancy)

	check := func(body string) []board.DuplicateMatch {
		t.Helper()
		w := duplicateRequest(t, m, m.vacancy, body)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		obj := movementKeys(t, movementObject(t, w.Body.Bytes()), "matches")
		for _, raw := range obj["matches"].([]any) {
			match := movementKeys(t, raw, "kind", "id", "full_name", "email_masked", "phone_masked", "last_vacancy", "last_added_at", "in_this_process")
			movementKeys(t, match["last_vacancy"], "id", "title")
		}
		var out board.DuplicateMatches
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out.Matches
	}
	matches := check(`{"email":null,"phone":"` + phone + `"}`)
	if len(matches) != 2 || matches[0].ID.String() > matches[1].ID.String() {
		t.Fatal(matches)
	}
	for _, match := range matches {
		if !match.InThisProcess || match.LastVacancy == nil || match.LastVacancy.ID != m.vacancy || match.LastVacancy.Title != "Current title" || match.LastAddedAt == nil || match.LastAddedAt.Format("2006-01-02") != "2026-01-01" || match.PhoneMasked == nil || *match.PhoneMasked != "+52 •••• ••12 34" {
			t.Fatal(match)
		}
		if match.ID == m.item.Candidate.ID && (match.Kind != "manual" || match.FullName != "Manual Person" || match.EmailMasked == nil || *match.EmailMasked != "m***@example.test") {
			t.Fatal(match)
		}
		if match.ID == organic.Candidate.ID && match.Kind != "organic" {
			t.Fatal(match)
		}
	}
	// Email normalization and OR semantics deduplicate each identity.
	emailMatches := check(`{"email":" MANUAL@EXAMPLE.TEST ","phone":null}`)
	if len(emailMatches) != 1 || emailMatches[0].ID != m.item.Candidate.ID {
		t.Fatal(emailMatches)
	}
	both := check(`{"email":"manual@example.test","phone":"` + phone + `"}`)
	if !reflect.DeepEqual(matches, both) {
		t.Fatal(both)
	}
	duplicateExec(t, m, `UPDATE process_participations SET created_at='2026-02-01T00:00:00Z' WHERE id=$1`, organic.ID)
	matches = check(`{"email":null,"phone":"` + phone + `"}`)
	if len(matches) != 2 || matches[0].ID != organic.Candidate.ID {
		t.Fatal(matches)
	}
	// Exact phone only, not suffix or formatting normalization.
	for _, body := range []string{`{"email":null,"phone":"+441234561234"}`, `{"email":"nobody@example.test","phone":null}`} {
		w := duplicateRequest(t, m, m.vacancy, body)
		if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"matches":[]}` {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}

func TestManualDuplicatesLatestCompanyParticipationAndAbsentContacts(t *testing.T) {
	m := manualReadFixture(t, false)
	other := uuid.New()
	duplicateExec(t, m, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, other, m.vacancy)
	duplicateExec(t, m, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) SELECT $1,company_id,status,published_at,published_by FROM vacancy_processes WHERE id=$2`, other, m.vacancy)
	duplicateExec(t, m, `INSERT INTO vacancy_public_projections(id,title,company_id,description,description_plain,work_mode,work_schedule,contract_type,professional_area,seniority,required_requirements,preferred_requirements,benefits,compensation,published_at,source_draft_version,skills,screening_questions,country_code,state_code,municipality_code,postal_code,remote_scope_kind,remote_countries) SELECT $1,'Latest role',company_id,description,description_plain,work_mode,work_schedule,contract_type,professional_area,seniority,required_requirements,preferred_requirements,benefits,compensation,published_at,source_draft_version,skills,screening_questions,country_code,state_code,municipality_code,postal_code,remote_scope_kind,remote_countries FROM vacancy_public_projections WHERE id=$2`, other, m.vacancy)
	// Move the sole participation to the other company process: the identity is
	// still eligible, but no longer in the requested process.
	duplicateExec(t, m, `UPDATE process_participations SET process_id=$2,created_at='2026-03-01T00:00:00Z' WHERE id=$1`, m.item.ID, other)
	w := duplicateRequest(t, m, m.vacancy, `{"email":"manual@example.test","phone":null}`)
	var out board.DuplicateMatches
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != 200 || len(out.Matches) != 1 {
		t.Fatal(err, w.Code, w.Body.String())
	}
	match := out.Matches[0]
	if match.InThisProcess || match.LastVacancy == nil || match.LastVacancy.ID != other || match.LastVacancy.Title != "Latest role" || match.PhoneMasked != nil || match.LastAddedAt.Format("2006-01-02") != "2026-03-01" {
		t.Fatal(match)
	}
	// A second, older participation must not replace the latest vacancy, and
	// must not produce a second match for the same identity.
	older := uuid.New()
	t.Cleanup(func() {
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM process_participations WHERE id=$1`, older); err != nil {
			t.Error(err)
		}
	})
	duplicateExec(t, m, `INSERT INTO process_participations(id,process_id,stage_id,questions_snapshot,answers_snapshot,source,created_at,company_candidate_id,company_candidate_cv_id,added_by)
	 SELECT $1,$2,stage_id,questions_snapshot,answers_snapshot,source,'2026-01-01T00:00:00Z',company_candidate_id,company_candidate_cv_id,added_by FROM process_participations WHERE id=$3`, older, m.vacancy, m.item.ID)
	w = duplicateRequest(t, m, m.vacancy, `{"email":"manual@example.test","phone":null}`)
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != 200 || len(out.Matches) != 1 {
		t.Fatal(err, w.Code, w.Body.String())
	}
	match = out.Matches[0]
	if !match.InThisProcess || match.LastVacancy.ID != other || match.LastAddedAt.Format("2006-01-02") != "2026-03-01" {
		t.Fatal(match)
	}
}

func TestManualDuplicatesReusedOrganicAndFinishedProcess(t *testing.T) {
	m := manualReadFixture(t, true)
	duplicateExec(t, m, `UPDATE vacancy_processes SET status='closed',process_status='finished',lifecycle_version=lifecycle_version+1,closed_at=now(),process_finished_at=now() WHERE id=$1`, m.vacancy)
	body, _ := json.Marshal(map[string]any{"email": " " + strings.ToUpper(m.sub+"@example.test") + " ", "phone": nil})
	w := duplicateRequest(t, m, m.vacancy, string(body))
	var out board.DuplicateMatches
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || w.Code != 200 || len(out.Matches) != 1 {
		t.Fatal(err, w.Code, w.Body.String())
	}
	match := out.Matches[0]
	if match.Kind != "organic" || match.ID != m.actor || !match.InThisProcess || match.PhoneMasked != nil || match.EmailMasked == nil || *match.EmailMasked != m.sub[:1]+"***@example.test" {
		t.Fatal(match)
	}
}

func TestManualDuplicatesAuthorizationAndErrorBodies(t *testing.T) {
	m := setupMovement(t)
	foreign := setupMovement(t)
	for _, tc := range []struct {
		name, body, code, fields string
		id                       uuid.UUID
		status                   int
	}{
		{"foreign", `{"email":null,"phone":null}`, "not_found", "", foreign.vacancy, 404},
		{"missing", `{"email":null,"phone":null}`, "not_found", "", uuid.New(), 404},
		{"required", `{"email":null,"phone":null}`, "validation_error", `[{"field":"contact","code":"required"}]`, m.vacancy, 400},
		{"invalid", `{"email":"bad","phone":"bad"}`, "validation_error", `[{"field":"email","code":"invalid"},{"field":"phone","code":"invalid"}]`, m.vacancy, 400},
		{"unknown", `{"email":null,"phone":null,"x":1}`, "invalid_request", "", m.vacancy, 400},
		{"duplicate", `{"email":null,"email":null,"phone":null}`, "invalid_request", "", m.vacancy, 400},
		{"missing_key", `{"email":null}`, "invalid_request", "", m.vacancy, 400},
		{"non_object", `[]`, "invalid_request", "", m.vacancy, 400},
		{"wrong_type", `{"email":false,"phone":null}`, "invalid_request", "", m.vacancy, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := duplicateRequest(t, m, tc.id, tc.body)
			var obj map[string]json.RawMessage
			if err := json.Unmarshal(w.Body.Bytes(), &obj); err != nil {
				t.Fatal(err)
			}
			if w.Code != tc.status || string(obj["code"]) != `"`+tc.code+`"` {
				t.Fatal(w.Code, w.Body.String())
			}
			want := 2
			if tc.fields != "" {
				want = 3
				if string(obj["fields"]) != tc.fields {
					t.Fatal(w.Body.String())
				}
			}
			if len(obj) != want {
				t.Fatal(w.Body.String())
			}
		})
	}
	// Live membership and owner-or-principal checks still run on this read.
	duplicateExec(t, m, `UPDATE company_members SET role='recruiter' WHERE company_id=$1 AND user_id=$2`, m.company, m.recruiter)
	duplicateExec(t, m, `UPDATE job_drafts SET principal_recruiter_id=$2 WHERE id=$1`, m.vacancy, m.actor)
	w := duplicateRequest(t, m, m.vacancy, `{"email":"a@example.test","phone":null}`)
	if w.Code != 404 {
		t.Fatal(w.Code, w.Body.String())
	}
}
