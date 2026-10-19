//go:build integration

package v2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	publicjobs "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	publicstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/publicjobs"
	"github.com/google/uuid"
)

func TestFilterDataApplySnapshotNormalizationAndReplay(t *testing.T) {
	for _, tc := range []struct {
		name     string
		profile  bool
		city     string
		wantCity any
	}{
		{"missing profile", false, "", nil}, {"empty city", true, "", nil},
		{"whitespace city", true, " \t\n\u00a0", nil}, {"normalized city", true, " San\u00a0  Luis\nPotosí ", "San Luis Potosí"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t)
			ctx := context.Background()
			if tc.profile {
				if _, err := f.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,city,skills,years_of_experience,education_level) VALUES($1,$2,ARRAY['Go','SQL','Go'],5,'master')`, f.actor, tc.city); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					if _, err := f.pool.Exec(ctx, `DELETE FROM candidate_profiles WHERE user_id=$1`, f.actor); err != nil {
						t.Error("profile fixture cleanup failed")
					}
				})
			}
			cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
			if err != nil {
				t.Fatal(err)
			}
			req, key := f.request(cv.ID), uuid.New()
			bad := req
			bad.Revision = "stale"
			if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), bad); !errors.Is(err, app.ErrQuestionnaireChanged) {
				t.Fatal(err)
			}
			bad = req
			bad.CVID = uuid.New()
			if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), bad); !errors.Is(err, app.ErrCVUnavailable) {
				t.Fatal(err)
			}
			bad = req
			bad.Answers = nil
			var invalid *app.InvalidAnswers
			if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), bad); !errors.As(err, &invalid) {
				t.Fatal(err)
			}
			failing := NewStore(f.pool, rejectAudit{}, testVacancyRules{}, f.store.delivery)
			if _, err = failing.Apply(ctx, f.sub, f.vacancy, uuid.New(), req); err == nil {
				t.Fatal("audit failure ignored")
			}
			var count int
			if err = f.pool.QueryRow(ctx, `SELECT count(*) FROM process_participations WHERE process_id=$1 AND profile_snapshot IS NOT NULL`, f.vacancy).Scan(&count); err != nil || count != 0 {
				t.Fatal("rejection wrote snapshot", count, err)
			}
			result, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
			if err != nil {
				t.Fatal(err)
			}
			read := func() []byte {
				t.Helper()
				var raw []byte
				if err := f.pool.QueryRow(ctx, `SELECT profile_snapshot FROM process_participations WHERE process_id=$1`, f.vacancy).Scan(&raw); err != nil {
					t.Fatal(err)
				}
				return raw
			}
			before := read()
			obj := movementObject(t, before)
			want := map[string]any{"city": tc.wantCity, "skills": []any{}, "years_of_experience": nil, "education_level": nil}
			if tc.profile {
				want["skills"] = []any{"Go", "SQL", "Go"}
				want["years_of_experience"] = float64(5)
				want["education_level"] = "master"
			}
			if !reflect.DeepEqual(obj, want) {
				t.Fatal("snapshot does not match normalized allowlist")
			}
			if _, err = f.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,city,skills,years_of_experience,education_level) VALUES($1,'Changed',ARRAY['Rust'],1,'phd') ON CONFLICT(user_id) DO UPDATE SET city=EXCLUDED.city,skills=EXCLUDED.skills,years_of_experience=EXCLUDED.years_of_experience,education_level=EXCLUDED.education_level`, f.actor); err != nil {
				t.Fatal(err)
			}
			if !tc.profile {
				t.Cleanup(func() {
					if _, err := f.pool.Exec(ctx, `DELETE FROM candidate_profiles WHERE user_id=$1`, f.actor); err != nil {
						t.Error("profile fixture cleanup failed")
					}
				})
			}
			if !bytes.Equal(before, read()) {
				t.Fatal("profile edit changed snapshot")
			}
			replay, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
			if err != nil || !replay.Replayed || !bytes.Equal(result.Body, replay.Body) || !bytes.Equal(before, read()) {
				t.Fatal("replay changed response or snapshot", err)
			}
			if _, err = f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), req); !errors.Is(err, app.ErrAlreadyApplied) {
				t.Fatal(err)
			}
			changed := req
			changed.Revision = "different"
			if _, err = f.store.Apply(ctx, f.sub, f.vacancy, key, changed); !errors.Is(err, app.ErrIdempotencyConflict) {
				t.Fatal(err)
			}
			if !bytes.Equal(before, read()) {
				t.Fatal("rejection overwrote existing snapshot")
			}
			f.assertSingleEffects(t)
		})
	}
}

func TestFilterDataBoardDetailLegacyCurrentQuestionnaireAndPrivacy(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	q1, q2, q3, open, oldOption, keepOption, newOption := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	questions := []app.Question{
		{ID: q1, Type: "single_choice", Prompt: "Removed question?", Options: []app.Option{{ID: oldOption, Label: "Removed"}}},
		{ID: open, Type: "open", Prompt: "Private?"},
		{ID: q2, Type: "single_choice", Prompt: "Changed option?", Options: []app.Option{{ID: keepOption, Label: "Old"}}},
	}
	answers := []app.Answer{{QuestionID: q2, OptionID: keepOption}, {QuestionID: open, Text: "PRIVATE OPEN ANSWER"}, {QuestionID: q1, OptionID: oldOption}}
	qs, _ := json.Marshal(questions)
	as, _ := json.Marshal(answers)
	if _, err := m.pool.Exec(ctx, `UPDATE process_participations SET questions_snapshot=$2,answers_snapshot=$3,profile_snapshot=NULL WHERE id=$1`, m.item.ID, qs, as); err != nil {
		t.Fatal(err)
	}
	fields, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Engineer","screening_questions":[{"id":"` + q3 + `","type":"single_choice_informative","prompt":"New?","options":[{"id":"` + newOption + `","label":"New"},{"id":"` + oldOption + `","label":"Other"}]},{"id":"` + q2 + `","type":"single_choice_evaluated","prompt":"Current?","options":[{"id":"` + newOption + `","label":"Current"},{"id":"` + oldOption + `","label":"Other"}],"correct_option_id":"` + newOption + `"},{"id":"` + open + `","type":"open","prompt":"Private?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, m.vacancy, fields.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	rec := movementRequest(t, m, "GET", m.vacancy, uuid.Nil, "", "", "")
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	root := movementKeys(t, movementObject(t, rec.Body.Bytes()), "stages", "exit", "coverage", "participations", "substates", "delivery", "retired_stages", "screening_filters")
	item := root["participations"].([]any)[0].(map[string]any)
	movementItemKeys(t, item)
	profile := movementKeys(t, item["profile"], "city", "skills", "years_of_experience", "education_level")
	if profile["city"] != nil || profile["years_of_experience"] != nil || profile["education_level"] != nil || len(profile["skills"].([]any)) != 0 {
		t.Fatal("legacy profile must be no-data")
	}
	gotAnswers := item["screening_answers"].([]any)
	wantAnswers := []any{map[string]any{"question_id": q2, "option_id": keepOption}, map[string]any{"question_id": q1, "option_id": oldOption}}
	if !reflect.DeepEqual(gotAnswers, wantAnswers) {
		t.Fatal("answers lost snapshot order or removed identities")
	}
	filters := root["screening_filters"].([]any)
	if len(filters) != 2 {
		t.Fatal("current choices only")
	}
	for i, q := range []string{q3, q2} {
		filter := movementKeys(t, filters[i], "question_id", "prompt", "options")
		option := movementKeys(t, filter["options"].([]any)[0], "id", "label")
		if filter["question_id"] != q || option["id"] != newOption {
			t.Fatal("filters not current or questionnaire order")
		}
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("PRIVATE OPEN ANSWER")) {
		t.Fatal("open answer leaked to board")
	}
	detail := movementRequest(t, m, "GET", m.vacancy, m.item.ID, "", "", "")
	if detail.Code != 200 {
		t.Fatal(detail.Code)
	}
	d := movementObject(t, detail.Body.Bytes())
	movementItemKeys(t, d, "screening", "comment", "candidate_message")
	if !reflect.DeepEqual(d["profile"], profile) || !reflect.DeepEqual(d["screening_answers"], gotAnswers) {
		t.Fatal("detail projection differs")
	}
	page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	assertNoFilterData(t, raw)
	// A profile snapshot is not part of the candidate application response either.
	var otherID uuid.UUID
	if err = m.pool.QueryRow(ctx, `SELECT id FROM users WHERE cognito_sub=$1`, m.other).Scan(&otherID); err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,city,skills,years_of_experience,education_level) VALUES($1,'  San  Luis ',ARRAY['Go','SQL'],0,'bachelor')`, otherID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := m.pool.Exec(ctx, `DELETE FROM candidate_profiles WHERE user_id=$1`, otherID); err != nil {
			t.Error("profile fixture cleanup failed")
		}
	})
	cv, err := m.library.Upload(ctx, m.other, "Other", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	form, err := (testVacancyRules{}).Screening(fields.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	req := app.Request{CVID: cv.ID, Revision: form.Revision, Answers: []app.Answer{{QuestionID: q3, OptionID: newOption, HasOption: true}, {QuestionID: q2, OptionID: newOption, HasOption: true}, {QuestionID: open, Text: "private", HasText: true}}}
	key := uuid.New()
	applied, err := m.store.Apply(ctx, m.other, m.vacancy, key, req)
	if err != nil {
		t.Fatal(err)
	}
	assertNoFilterData(t, applied.Body)
	var submitted app.Submitted
	if err = json.Unmarshal(applied.Body, &submitted); err != nil {
		t.Fatal(err)
	}
	readProfile := func() map[string]any {
		t.Helper()
		r := movementRequest(t, m, "GET", m.vacancy, submitted.ID, "", "", "")
		if r.Code != 200 {
			t.Fatal(r.Code)
		}
		return movementKeys(t, movementObject(t, r.Body.Bytes())["profile"], "city", "skills", "years_of_experience", "education_level")
	}
	expected := map[string]any{"city": "San Luis", "skills": []any{"Go", "SQL"}, "years_of_experience": float64(0), "education_level": "bachelor"}
	if !reflect.DeepEqual(readProfile(), expected) {
		t.Fatal("detail lost applied profile")
	}
	if _, err = m.pool.Exec(ctx, `UPDATE candidate_profiles SET city='Changed',skills=ARRAY['Rust'],years_of_experience=7,education_level='phd' WHERE user_id=$1`, otherID); err != nil {
		t.Fatal(err)
	}
	replay, err := m.store.Apply(ctx, m.other, m.vacancy, key, req)
	if err != nil || !replay.Replayed || !bytes.Equal(replay.Body, applied.Body) || !reflect.DeepEqual(readProfile(), expected) {
		t.Fatal("replay refreshed profile", err)
	}
	positiveBoard := movementRequest(t, m, "GET", m.vacancy, uuid.Nil, "", "", "")
	if positiveBoard.Code != 200 {
		t.Fatal(positiveBoard.Code)
	}
	found := false
	for _, raw := range movementObject(t, positiveBoard.Body.Bytes())["participations"].([]any) {
		i := raw.(map[string]any)
		if i["id"] == submitted.ID.String() {
			found = true
			if !reflect.DeepEqual(i["profile"], expected) {
				t.Fatal("board lost applied profile")
			}
		}
	}
	if !found {
		t.Fatal("applied candidate not on board")
	}
	view, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, submitted.ID)
	if err != nil {
		t.Fatal(err)
	}
	mutation := movementRequest(t, m, "POST", m.vacancy, submitted.ID, "/moves", view.ETag, `{"to_stage_id":"`+pipelineconfig.Defaults(m.vacancy).Stages[1].ID+`"}`)
	if mutation.Code != 200 {
		t.Fatal(mutation.Code)
	}
	assertNoFilterData(t, mutation.Body.Bytes())
	history := movementRequest(t, m, "GET", m.vacancy, submitted.ID, "/history", "", "")
	if history.Code != 200 {
		t.Fatal(history.Code)
	}
	assertNoFilterData(t, history.Body.Bytes())
	reader := publicstore.NewStore(db.New(m.pool))
	publicDetail, err := reader.Get(ctx, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(publicDetail)
	if err != nil {
		t.Fatal(err)
	}
	assertNoFilterData(t, raw)
	rows, err := reader.Search(ctx, publicjobs.Query{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	assertNoFilterData(t, raw)
	publicForm, err := reader.Screening(ctx, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(publicForm)
	if err != nil {
		t.Fatal(err)
	}
	assertNoFilterData(t, raw)
	emptyFields, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Engineer","screening_questions":[]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, m.vacancy, emptyFields.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	empty, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	raw, err = json.Marshal(empty.ScreeningFilters)
	if err != nil || string(raw) != "[]" {
		t.Fatal("no questionnaire must yield []", err)
	}
}

func assertNoFilterData(t *testing.T, raw []byte) {
	t.Helper()
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	var walk func(any)
	walk = func(v any) {
		switch x := v.(type) {
		case map[string]any:
			for k, v := range x {
				if k == "profile" || k == "profile_snapshot" || k == "screening_answers" || k == "screening_filters" {
					t.Fatalf("private filter data leaked: %s", k)
				}
				walk(v)
			}
		case []any:
			for _, v := range x {
				walk(v)
			}
		}
	}
	walk(value)
}
