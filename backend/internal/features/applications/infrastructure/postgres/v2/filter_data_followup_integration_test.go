//go:build integration

package v2

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/board"
	apphttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/middleware"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
)

func TestFilterDataPopulatedSnapshotsNeverReachRequestLogsOrAuditMetadata(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	const city = "PRIVATE_CITY_SENTINEL"
	const skill = "PRIVATE_SKILL_SENTINEL"
	const answer = "PRIVATE_OPEN_ANSWER_SENTINEL"
	q, option, otherOption := uuid.NewString(), uuid.NewString(), uuid.NewString()
	fields, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Engineer","screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"},{"id":"` + q + `","type":"single_choice_informative","prompt":"Availability?","options":[{"id":"` + option + `","label":"Yes"},{"id":"` + otherOption + `","label":"No"}]}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, m.vacancy, fields.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	var candidate uuid.UUID
	if err = m.pool.QueryRow(ctx, `SELECT id FROM users WHERE cognito_sub=$1`, m.other).Scan(&candidate); err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,skills,years_of_experience,education_level) VALUES($1,ARRAY[$2]::text[],7,'master')`, candidate, skill); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := m.pool.Exec(context.Background(), `DELETE FROM candidate_profiles WHERE user_id=$1`, candidate); err != nil {
			t.Error(err)
		}
	})
	cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	form, err := (testVacancyRules{}).Screening(fields.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	reqBody, err := json.Marshal(app.Request{CVID: cv.ID, Revision: form.Revision, Answers: []app.Answer{{QuestionID: form.Questions[0].ID, Text: answer}, {QuestionID: q, OptionID: option}}})
	if err != nil {
		t.Fatal(err)
	}
	// Capture the real slog JSON handler, as runtime logging tests do. Capturing
	// the default as well catches accidental direct store/adapter logging.
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	previous := slog.Default()
	slog.SetDefault(logger)
	defer slog.SetDefault(previous)
	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(middleware.RequestObservability(logger, nil))
	bh := boardhttp.NewHandler(m.board)
	ah := apphttp.NewHandler(m.store, draftjson.Decode)
	r.Post("/jobs/{id}/applications", ah.Apply)
	r.Get("/vacancies/{id}/board", bh.Board)
	r.Get("/vacancies/{id}/participations/{pid}", bh.Detail)
	r.Post("/vacancies/{id}/participations/{pid}/moves", bh.Move)
	request := func(method, path, body, tag, key string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path+"?private="+city, strings.NewReader(body))
		cc := security.CompanyContext{CompanyID: m.company, UserID: m.recruiter}
		req = req.WithContext(security.ContextWithCompanyContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: m.other}), cc))
		if tag != "" {
			req.Header.Set("If-Match", tag)
		}
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatal(method, rec.Code, rec.Body.String())
		}
		return rec
	}
	applied := request(http.MethodPost, "/jobs/"+m.vacancy.String()+"/applications", string(reqBody), "", uuid.NewString(), 201)
	var submitted app.Submitted
	if err = json.Unmarshal(applied.Body.Bytes(), &submitted); err != nil {
		t.Fatal(err)
	}
	// G3 leaves historical §19 snapshots intact. Simulate an existing city
	// snapshot to keep the privacy assertion non-vacuous until G4 rewrites it.
	if _, err = m.pool.Exec(ctx, `UPDATE process_participations SET profile_snapshot=jsonb_set(profile_snapshot,'{city}',to_jsonb($2::text)) WHERE id=$1`, submitted.ID, city); err != nil {
		t.Fatal(err)
	}
	var profile, answers []byte
	if err = m.pool.QueryRow(ctx, `SELECT profile_snapshot,answers_snapshot FROM process_participations WHERE id=$1`, submitted.ID).Scan(&profile, &answers); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(profile, []byte(city)) || !bytes.Contains(profile, []byte(skill)) || !bytes.Contains(answers, []byte(answer)) || !bytes.Contains(answers, []byte(option)) {
		t.Fatal("privacy fixture is not populated")
	}
	request(http.MethodGet, "/vacancies/"+m.vacancy.String()+"/board", "", "", "", 200)
	path := "/vacancies/" + m.vacancy.String() + "/participations/" + submitted.ID.String()
	detail := request(http.MethodGet, path, "", "", "", 200)
	if !bytes.Contains(detail.Body.Bytes(), []byte(city)) || !bytes.Contains(detail.Body.Bytes(), []byte(answer)) {
		t.Fatal("private data never reached the authorized response")
	}
	tag := movementObject(t, detail.Body.Bytes())["etag"].(string)
	moveBody := `{"to_stage_id":"` + pc.Defaults(m.vacancy).Stages[1].ID + `"}`
	request(http.MethodPost, path+"/moves", moveBody, tag, "", 200)
	request(http.MethodPost, path+"/moves", moveBody, tag, "", 412)
	// Non-vacuous: five real completion records, including a populated detail
	// response and a failed write. Neither response bodies nor query data belong
	// in the request log allowlist.
	lines := bytes.Split(bytes.TrimSpace(logs.Bytes()), []byte("\n"))
	completions := 0
	for _, line := range lines {
		rec := movementObject(t, line)
		if rec["msg"] == "http request completed" {
			completions++
			movementKeys(t, rec, "time", "level", "msg", "request_id", "method", "path", "status", "duration", "code_class")
		}
	}
	if completions != 5 {
		t.Fatal("request logging capture is vacuous", completions)
	}
	var metadata []byte
	if err = m.pool.QueryRow(ctx, `SELECT jsonb_agg(metadata ORDER BY id) FROM audit_events WHERE entity_id=$1 OR metadata->>'vacancy_id'=$1::text`, m.vacancy).Scan(&metadata); err != nil {
		t.Fatal(err)
	}
	var events []json.RawMessage
	if err = json.Unmarshal(metadata, &events); err != nil || len(events) < 3 {
		t.Fatal("audit capture is vacuous", len(events), err)
	}
	for _, surface := range []struct {
		name string
		raw  []byte
	}{{"request logs", logs.Bytes()}, {"audit metadata", metadata}} {
		for _, forbidden := range []string{city, skill, answer, q, option, `"profile"`, `"profile_snapshot"`, `"answers"`, `"answers_snapshot"`, `"screening_answers"`, `"skills"`, `"city"`, `"years_of_experience"`, `"education_level"`} {
			if bytes.Contains(surface.raw, []byte(forbidden)) {
				t.Fatalf("private profile/screening data leaked to %s (%s)", surface.name, forbidden)
			}
		}
	}
}
