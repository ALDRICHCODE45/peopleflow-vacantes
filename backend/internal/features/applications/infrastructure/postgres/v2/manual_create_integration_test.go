//go:build integration

package v2

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

type intakeInspector struct {
	calls int
	err   error
}

func (i *intakeInspector) Inspect(string, []byte) (string, error) {
	i.calls++
	return "application/pdf", i.err
}

type intakeFiles struct {
	local         *storage.Local
	puts, deletes int
}

func (s *intakeFiles) Put(b []byte) (string, error) {
	s.puts++
	return s.local.Put(context.Background(), b)
}
func (s *intakeFiles) Delete(k string) error {
	s.deletes++
	return s.local.Delete(context.Background(), k)
}

type intakeFixture struct {
	movementFixture
	files   *intakeFiles
	inspect *intakeInspector
}

func setupManualIntake(t *testing.T) intakeFixture {
	t.Helper()
	if testing.Short() {
		t.Skip("isolated database integration")
	}
	m := setupMovement(t)
	ctx := context.Background()
	tag, err := m.pool.Exec(ctx, `INSERT INTO geo_countries(code,name_es,name_en) VALUES('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`)
	if err != nil {
		t.Fatal(err)
	}
	inserted := tag.RowsAffected() == 1
	local, err := storage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	// Only rows owned by this fixture's company are removed; the shared harness
	// subsequently removes its original organic participation and identities.
	t.Cleanup(func() {
		for _, q := range []string{
			`DELETE FROM audit_events WHERE entity_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1 AND p.source='manual')`,
			`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT p.id FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE vp.company_id=$1 AND p.source='manual')`,
			`DELETE FROM process_participations WHERE source='manual' AND process_id IN (SELECT id FROM vacancy_processes WHERE company_id=$1)`,
			`DELETE FROM company_candidate_cvs WHERE company_id=$1`,
			`DELETE FROM company_candidate_languages WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1)`,
			`DELETE FROM company_candidates WHERE company_id=$1`,
			`DELETE FROM job_draft_idempotency WHERE company_id=$1 AND operation='manual-intake'`,
		} {
			if _, err := m.pool.Exec(ctx, q, m.company); err != nil {
				t.Error(err)
			}
		}
		if inserted {
			if _, err := m.pool.Exec(ctx, `DELETE FROM geo_countries WHERE code='US'`); err != nil {
				t.Error(err)
			}
		}
	})
	return intakeFixture{m, &intakeFiles{local: local}, &intakeInspector{}}
}
func (f intakeFixture) input(stage string) board.ManualInput {
	data, _ := json.Marshal(map[string]any{"stage_id": stage, "existing": nil, "confirmed_distinct": false, "candidate": map[string]any{"full_name": "Manual Candidate", "education_level": "bachelor", "email": "intake@example.test", "phone": nil, "residence": map[string]any{"country": "US"}, "skills": []string{"Go"}, "languages": []map[string]string{{"language": "English", "level": "C1"}}}})
	return board.ManualInput{Data: data, CV: []byte("%PDF-1 manual intake"), FileName: "resume.pdf", IdempotencyKey: uuid.New()}
}
func intakeChange(t *testing.T, in board.ManualInput, key string, value any) board.ManualInput {
	t.Helper()
	var data map[string]any
	if err := json.Unmarshal(in.Data, &data); err != nil {
		t.Fatal(err)
	}
	data[key] = value
	var err error
	in.Data, err = json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	return in
}
func (f intakeFixture) create(in board.ManualInput) (board.ManualCreated, error) {
	return f.board.CreateManual(context.Background(), f.company, f.recruiter, f.vacancy, in, f.inspect, f.files)
}
func intakeItem(t *testing.T, result board.ManualCreated) board.ManualCreatedBody {
	t.Helper()
	var item board.ManualCreatedBody
	if err := json.Unmarshal(result.Body, &item); err != nil {
		t.Fatal(err)
	}
	if result.ETag != item.ETag || item.Source != "manual" || item.AddedBy == nil || item.Version != "1" || item.ScreeningAnswers == nil {
		t.Fatal(string(result.Body))
	}
	return item
}
func assertManualGETItem(t *testing.T, f intakeFixture, process uuid.UUID, result board.ManualCreated) {
	t.Helper()
	created := intakeItem(t, result)
	get, err := f.board.Board(context.Background(), f.company, f.recruiter, process)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range get.Participations {
		if item.ID != created.ID {
			continue
		}
		want, err := json.Marshal(board.ManualCreatedBody{Item: item, Coverage: get.Coverage, Delivery: get.Delivery})
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(result.Body, want) {
			t.Fatalf("201 differs from GET board item plus coverage/delivery\ngot: %s\nwant: %s", result.Body, want)
		}
		return
	}
	t.Fatal("created participation missing from GET board")
}

func (f intakeFixture) effects(t *testing.T) string {
	t.Helper()
	var out string
	err := f.pool.QueryRow(context.Background(), `SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM company_candidates c WHERE company_id=$1),
 (SELECT jsonb_agg(to_jsonb(l) ORDER BY company_candidate_id,language) FROM company_candidate_languages l WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1)),
 (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM company_candidate_cvs c WHERE company_id=$1),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id IN(SELECT id FROM vacancy_processes WHERE company_id=$1)),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM participation_stage_history h WHERE participation_id IN(SELECT id FROM process_participations WHERE process_id IN(SELECT id FROM vacancy_processes WHERE company_id=$1))),
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM job_draft_idempotency i WHERE company_id=$1),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE actor_id=$2),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM vacancy_processes p WHERE company_id=$1))::text`, f.company, f.recruiter).Scan(&out)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func (f intakeFixture) unchanged(t *testing.T, before string, puts int) {
	t.Helper()
	if after := f.effects(t); after != before {
		t.Fatal("rejection changed rows/audit/idempotency/delivery", after)
	}
	if f.files.puts != puts {
		t.Fatal("rejection called Put")
	}
}

func TestManualCreateFirstStageReplayAndConflict(t *testing.T) {
	f := setupManualIntake(t)
	in := f.input(pipelineconfig.Defaults(f.vacancy).Stages[0].ID)
	result, err := f.create(in)
	if err != nil {
		t.Fatal(err)
	}
	item := intakeItem(t, result)
	if item.Candidate.Kind != "manual" || item.AddedBy.ID != f.recruiter || item.Coverage.Covered != 0 || f.inspect.calls != 1 || f.files.puts != 1 {
		t.Fatal(item)
	}
	assertManualGETItem(t, f, f.vacancy, result)
	history, err := f.board.History(context.Background(), f.company, f.recruiter, f.vacancy, item.ID)
	if err != nil || len(history.Items) != 1 || history.Items[0].Kind != "intake" || history.Items[0].FromStageID != nil || history.Items[0].Actor.ID != f.recruiter {
		t.Fatal(history, err)
	}
	var languages, audits int
	if err := f.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM company_candidate_languages WHERE company_candidate_id=$1),(SELECT count(*) FROM audit_events WHERE entity_id=$2 AND event_type='VacancyCandidateAddedManually')`, item.Candidate.ID, item.ID).Scan(&languages, &audits); err != nil || languages != 1 || audits != 1 {
		t.Fatal(languages, audits, err)
	}
	duplicateExec(t, f.movementFixture, `UPDATE vacancy_processes SET status='closed',process_status='finished',lifecycle_version=lifecycle_version+1,closed_at=now(),process_finished_at=now() WHERE id=$1`, f.vacancy)
	before := f.effects(t)
	// Replay precedes new field/stage/state/inspector checks and keeps original bytes.
	f.inspect.err = board.ErrManualCVContentMismatch
	replay, err := f.create(in)
	if err != nil || !replay.Replayed || replay.ETag != result.ETag || !bytes.Equal(replay.Body, result.Body) {
		t.Fatal(replay, err)
	}
	f.unchanged(t, before, 1)
	in.CV = []byte("different")
	if _, err = f.create(in); !errors.Is(err, board.ErrManualIdempotencyConflict) {
		t.Fatal(err)
	}
	f.unchanged(t, before, 1)
	if f.inspect.calls != 1 {
		t.Fatal("replay/conflict inspected CV")
	}
}

func TestManualCreateAtDeliveryCutoff(t *testing.T) {
	for _, position := range []int{1, 2} {
		t.Run([]string{"at cutoff", "after cutoff"}[position-1], func(t *testing.T) {
			f := setupManualIntake(t)
			fulfillmentConfig(t, f.movementFixture, 1, 1)
			in := f.input(pipelineconfig.Defaults(f.vacancy).Stages[position].ID)
			result, err := f.create(in)
			if err != nil {
				t.Fatal(err)
			}
			item := intakeItem(t, result)
			if item.Delivery.Delivered != 1 || item.Delivery.State != "fulfilled" {
				t.Fatal(item.Delivery)
			}
			assertOneFulfillment(t, f.movementFixture)
		})
	}
}

func TestManualCreateDuplicatesAndConfirmedDistinct(t *testing.T) {
	f := setupManualIntake(t)
	in := f.input(pipelineconfig.Defaults(f.vacancy).Stages[0].ID)
	first, err := f.create(in)
	if err != nil {
		t.Fatal(err)
	}
	item := intakeItem(t, first)
	in.IdempotencyKey = uuid.New()
	before := f.effects(t)
	_, err = f.create(in)
	var duplicates *board.PossibleDuplicates
	if !errors.As(err, &duplicates) || len(duplicates.Matches) != 1 || duplicates.Matches[0].ID != item.Candidate.ID || !duplicates.Matches[0].InThisProcess {
		t.Fatal(err)
	}
	f.unchanged(t, before, 1)
	if f.inspect.calls != 1 {
		t.Fatal("duplicate warning inspected CV")
	}
	in = intakeChange(t, in, "confirmed_distinct", true)
	second, err := f.create(in)
	if err != nil {
		t.Fatal(err)
	}
	if intakeItem(t, second).Candidate.ID == item.Candidate.ID {
		t.Fatal("distinct identity merged")
	}
}

func intakeOtherDraft(t *testing.T, f intakeFixture, published bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	duplicateExec(t, f.movementFixture, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, id, f.vacancy)
	if published {
		duplicateExec(t, f.movementFixture, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) SELECT $1,company_id,status,published_at,published_by FROM vacancy_processes WHERE id=$2`, id, f.vacancy)
		duplicateExec(t, f.movementFixture, `INSERT INTO job_draft_delivery_configs(draft_id,version,cutoff_stage_id,target_quantity,commitment_date) VALUES($1,1,$2,999,'2020-01-02')`, id, pipelineconfig.Defaults(id).Stages[4].ID)
	}
	return id
}
func TestManualCreateExistingReuseAndAlreadyInProcess(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := setupManualIntake(t)
			identity := f.actor
			if kind == "organic" {
				ctx := context.Background()
				if _, err := f.pool.Exec(ctx, `INSERT INTO candidate_profiles(user_id,years_of_experience) VALUES($1,7.9)`, identity); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _, _ = f.pool.Exec(ctx, `DELETE FROM candidate_profiles WHERE user_id=$1`, identity) })
				if _, err := f.pool.Exec(ctx, `INSERT INTO candidate_educations(user_id,position,level,status) VALUES($1,0,'bachelor','completed'),($1,1,'master','completed'),($1,2,'phd','in_progress'),($1,3,'specialty','completed')`, identity); err != nil {
					t.Fatal(err)
				}
			}
			if kind == "manual" {
				result, err := f.create(f.input(pipelineconfig.Defaults(f.vacancy).Stages[0].ID))
				if err != nil {
					t.Fatal(err)
				}
				identity = intakeItem(t, result).Candidate.ID
			}
			other := intakeOtherDraft(t, f, true)
			in := f.input(pipelineconfig.Defaults(other).Stages[0].ID)
			in = intakeChange(t, in, "candidate", nil)
			in = intakeChange(t, in, "existing", map[string]any{"kind": kind, "id": identity})
			var libraryBefore string
			if err := f.pool.QueryRow(context.Background(), `SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id),'[]'::jsonb)::text FROM candidate_cv_library l WHERE candidate_id=$1`, identity).Scan(&libraryBefore); err != nil {
				t.Fatal(err)
			}
			result, err := f.board.CreateManual(context.Background(), f.company, f.recruiter, other, in, f.inspect, f.files)
			if err != nil {
				t.Fatal(err)
			}
			item := intakeItem(t, result)
			assertManualGETItem(t, f, other, result)
			if kind == "organic" {
				var raw []byte
				if err := f.pool.QueryRow(context.Background(), `SELECT profile_snapshot FROM process_participations WHERE id=$1`, item.ID).Scan(&raw); err != nil {
					t.Fatal(err)
				}
				snapshot := movementKeys(t, movementObject(t, raw), "location", "skills", "years_of_experience", "education_level")
				if snapshot["years_of_experience"] != float64(7) || snapshot["education_level"] != "master" {
					t.Fatal(snapshot)
				}
			}
			if item.Candidate.ID != identity || item.Candidate.Kind != kind {
				t.Fatal(item)
			}
			var owner uuid.UUID
			var cc *uuid.UUID
			if err := f.pool.QueryRow(context.Background(), `SELECT company_id,company_candidate_id FROM company_candidate_cvs WHERE id=$1`, item.CV.ID).Scan(&owner, &cc); err != nil || owner != f.company || (kind == "organic" && cc != nil) || (kind == "manual" && (cc == nil || *cc != identity)) {
				t.Fatal(owner, cc, err)
			}
			var libraryAfter string
			if err := f.pool.QueryRow(context.Background(), `SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY id),'[]'::jsonb)::text FROM candidate_cv_library l WHERE candidate_id=$1`, identity).Scan(&libraryAfter); err != nil || libraryAfter != libraryBefore {
				t.Fatal("candidate library changed", err)
			}
			in.IdempotencyKey = uuid.New()
			before := f.effects(t)
			puts := f.files.puts
			_, err = f.board.CreateManual(context.Background(), f.company, f.recruiter, other, in, f.inspect, f.files)
			var already *board.CandidateAlreadyInProcess
			if !errors.As(err, &already) || already.ParticipationID != item.ID {
				t.Fatal(err)
			}
			f.unchanged(t, before, puts)
		})
	}
}

func TestManualCreateRejectionsHaveNoEffects(t *testing.T) {
	for _, scenario := range []string{"finished", "never published", "placement", "exit", "unknown stage", "invalid fields", "cross company manual", "cross company organic", "foreign vacancy", "cv mismatch", "cv unsupported", "cv too large"} {
		t.Run(scenario, func(t *testing.T) {
			f := setupManualIntake(t)
			config := pipelineconfig.Defaults(f.vacancy)
			in := f.input(config.Stages[0].ID)
			process := f.vacancy
			var expected error
			field, code := "", ""
			switch scenario {
			case "finished":
				duplicateExec(t, f.movementFixture, `UPDATE vacancy_processes SET status='closed',process_status='finished',lifecycle_version=lifecycle_version+1,closed_at=now(),process_finished_at=now() WHERE id=$1`, f.vacancy)
			case "never published":
				process = intakeOtherDraft(t, f, false)
				expected = board.ErrNotPublished
			case "placement":
				in = intakeChange(t, in, "stage_id", config.Stages[len(config.Stages)-1].ID)
				field, code = "stage_id", "not_allowed"
			case "exit":
				in = intakeChange(t, in, "stage_id", config.Exit.ID)
				field, code = "stage_id", "not_allowed"
			case "unknown stage":
				in = intakeChange(t, in, "stage_id", uuid.New())
				field, code = "stage_id", "invalid"
			case "invalid fields":
				in = intakeChange(t, in, "candidate", map[string]any{})
				field, code = "candidate.full_name", "required"
			case "cross company manual", "cross company organic":
				foreign := setupManualIntake(t)
				kind := "organic"
				identity := foreign.actor
				if scenario == "cross company manual" {
					kind = "manual"
					result, err := foreign.create(foreign.input(pipelineconfig.Defaults(foreign.vacancy).Stages[0].ID))
					if err != nil {
						t.Fatal(err)
					}
					identity = intakeItem(t, result).Candidate.ID
				}
				in = intakeChange(t, in, "candidate", nil)
				in = intakeChange(t, in, "existing", map[string]any{"kind": kind, "id": identity})
				field, code = "existing", "invalid"
			case "foreign vacancy":
				foreign := setupManualIntake(t)
				process = foreign.vacancy
				expected = board.ErrNotFound
			case "cv mismatch":
				expected = board.ErrManualCVContentMismatch
				f.inspect.err = expected
			case "cv unsupported":
				expected = board.ErrManualCVUnsupportedType
				f.inspect.err = expected
			case "cv too large":
				expected = board.ErrManualCVTooLarge
				f.inspect.err = expected
			}
			before := f.effects(t)
			_, err := f.board.CreateManual(context.Background(), f.company, f.recruiter, process, in, f.inspect, f.files)
			if err == nil {
				t.Fatal("accepted rejection")
			}
			if scenario == "finished" {
				var finished *board.ProcessFinished
				if !errors.As(err, &finished) {
					t.Fatal(err)
				}
			}
			if expected != nil && !errors.Is(err, expected) {
				t.Fatal(err)
			}
			if field != "" {
				var validation *board.ManualValidationError
				if !errors.As(err, &validation) {
					t.Fatal(err)
				}
				found := false
				for _, v := range validation.Fields {
					if v.Field == field && v.Code == code {
						found = true
					}
				}
				if !found {
					t.Fatal(validation.Fields)
				}
			}
			f.unchanged(t, before, 0)
			if scenario != "cv mismatch" && scenario != "cv unsupported" && scenario != "cv too large" && f.inspect.calls != 0 {
				t.Fatal("rejection inspected CV before its gate")
			}
		})
	}
}

func TestManualCreateTransactionFailureDeletesFile(t *testing.T) {
	f := setupManualIntake(t)
	failing := boardstore.NewStore(f.pool, rejectAudit{}, movementContext{f.drafts}, nil, draftjson.Decode)
	before := f.effects(t)
	_, err := failing.CreateManual(context.Background(), f.company, f.recruiter, f.vacancy, f.input(pipelineconfig.Defaults(f.vacancy).Stages[0].ID), f.inspect, f.files)
	if err == nil || f.files.puts != 1 || f.files.deletes != 1 {
		t.Fatal(err, f.files)
	}
	if f.effects(t) != before {
		t.Fatal("transaction failure retained rows")
	}
	keys, err := f.files.local.Keys(context.Background())
	if err != nil || len(keys) != 0 {
		t.Fatal(keys, err)
	}
}
