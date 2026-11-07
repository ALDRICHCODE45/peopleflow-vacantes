//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	handler "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// applyHTTP drives the real apply handler over the real store.
func applyHTTP(t *testing.T, f fixture, sub, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/v2/jobs/{id}/applications", handler.NewHandler(f.store, draftjson.Decode).Apply)
	req := httptest.NewRequest("POST", "/v2/jobs/"+f.vacancy.String()+"/applications", strings.NewReader(body))
	req.Header.Set("Idempotency-Key", uuid.NewString())
	req = req.WithContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: sub}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func applyBody(f fixture, cv uuid.UUID, channel string) string {
	answers, _ := json.Marshal([]map[string]string{{"question_id": f.form.Questions[0].ID, "text": "Because"}})
	body := `{"cv_id":"` + cv.String() + `","questionnaire_revision":"` + f.form.Revision + `","answers":` + string(answers)
	if channel != "" {
		body += `,"channel":` + channel
	}
	return body + `}`
}

func originChannel(t *testing.T, f fixture, sub string) string {
	t.Helper()
	var channel string
	if err := f.pool.QueryRow(context.Background(), `SELECT p.origin_channel FROM process_participations p JOIN users u ON u.id=p.candidate_id WHERE p.process_id=$1 AND u.cognito_sub=$2`, f.vacancy, sub).Scan(&channel); err != nil {
		t.Fatal(err)
	}
	return channel
}

func TestApplyOriginChannelOverHTTP(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	cv, err := f.library.Upload(ctx, f.sub, "Resume", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	other, err := f.library.Upload(ctx, f.other, "Resume", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	// Rejected channels write nothing: no participation, history, audit or replay row.
	before := f.effects(t)
	for _, raw := range []string{`"newsletter"`, `"manual"`, `"unknown"`, `null`, `7`} {
		w := applyHTTP(t, f, f.sub, applyBody(f, cv.ID, raw))
		want := `{"error":"validation failed","code":"validation_error","fields":[{"field":"channel","code":"invalid"}]}`
		if w.Code != 400 || strings.TrimSpace(w.Body.String()) != want {
			t.Fatalf("%s: %d %s", raw, w.Code, w.Body.String())
		}
	}
	if got := f.effects(t); got != before {
		t.Fatal("rejected channel changed state", got)
	}
	// Existing behavior: an apply without channel still succeeds, recorded as portal.
	w := applyHTTP(t, f, f.sub, applyBody(f, cv.ID, ""))
	var created map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || w.Code != 201 || len(created) != 4 || created["status"] != "submitted" || created["vacancy_id"] != f.vacancy.String() {
		t.Fatal(w.Code, w.Body.String())
	}
	if got := originChannel(t, f, f.sub); got != "portal" {
		t.Fatal(got)
	}
	f.assertSingleEffects(t)
	var source, metadata string
	if err := f.pool.QueryRow(ctx, `SELECT p.source,a.metadata::text FROM process_participations p JOIN audit_events a ON a.entity_id=p.id AND a.event_type='VacancyApplicationSubmitted' WHERE p.id=$1`, created["id"]).Scan(&source, &metadata); err != nil {
		t.Fatal(err)
	}
	var meta map[string]string
	if err := json.Unmarshal([]byte(metadata), &meta); err != nil || source != "organic" || len(meta) != 3 || meta["source"] != "organic" {
		t.Fatal(source, metadata, err)
	}
	w = applyHTTP(t, f, f.other, applyBody(f, other.ID, `"careers_site"`))
	if w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	if got := originChannel(t, f, f.other); got != "careers_site" {
		t.Fatal(got)
	}
}

func TestApplyExplicitPortalChannel(t *testing.T) {
	f := setup(t)
	cv, err := f.library.Upload(context.Background(), f.sub, "Resume", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	if w := applyHTTP(t, f, f.sub, applyBody(f, cv.ID, `"portal"`)); w.Code != 201 {
		t.Fatal(w.Code, w.Body.String())
	}
	if got := originChannel(t, f, f.sub); got != "portal" {
		t.Fatal(got)
	}
}

func TestManualIntakeOriginChannelAndLegacyInsertDefault(t *testing.T) {
	f := setupManualIntake(t)
	result, err := f.create(f.input(pipelineconfig.Defaults(f.vacancy).Stages[0].ID))
	if err != nil {
		t.Fatal(err)
	}
	item := intakeItem(t, result)
	var channel string
	if err := f.pool.QueryRow(context.Background(), `SELECT origin_channel FROM process_participations WHERE id=$1 AND source='manual'`, item.ID).Scan(&channel); err != nil || channel != "manual" {
		t.Fatal(channel, err)
	}
	// The harness applied through the store without a channel: portal.
	var organic uuid.UUID
	var harness string
	if err := f.pool.QueryRow(context.Background(), `SELECT id,origin_channel FROM process_participations WHERE process_id=$1 AND source='organic'`, f.vacancy).Scan(&organic, &harness); err != nil || harness != "portal" {
		t.Fatal(harness, err)
	}
	// A raw insert that omits the column gets the historical rule (D9), never a
	// guessed portal. Re-insert the same row without its channel, then roll back.
	tx, err := f.pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	for _, q := range []string{
		`CREATE TEMP TABLE legacy_row ON COMMIT DROP AS SELECT * FROM process_participations WHERE id=$1`,
		`DELETE FROM participation_stage_history WHERE participation_id=$1`,
		`DELETE FROM process_participations WHERE id=$1`,
	} {
		if _, err := tx.Exec(context.Background(), q, organic); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(context.Background(), `ALTER TABLE legacy_row DROP COLUMN origin_channel`); err != nil {
		t.Fatal(err)
	}
	var columns string
	if err := tx.QueryRow(context.Background(), `SELECT string_agg(quote_ident(attname),',') FROM pg_attribute WHERE attrelid='legacy_row'::regclass AND attnum>0 AND NOT attisdropped`).Scan(&columns); err != nil {
		t.Fatal(err)
	}
	var legacy string
	if err := tx.QueryRow(context.Background(), `INSERT INTO process_participations(`+columns+`) SELECT `+columns+` FROM legacy_row RETURNING origin_channel`).Scan(&legacy); err != nil || legacy != "unknown" {
		t.Fatal(legacy, err)
	}
	if err := tx.Rollback(context.Background()); err != nil {
		t.Fatal(err)
	}
}
