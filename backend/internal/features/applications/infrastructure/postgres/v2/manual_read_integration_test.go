//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func TestManualDeliveryCountsEachParticipationOnce(t *testing.T) {
	for _, reuse := range []bool{false, true} {
		name := "company_identity"
		if reuse {
			name = "reused_organic"
		}
		t.Run(name, func(t *testing.T) {
			m := manualReadFixture(t, reuse)
			ctx := context.Background()
			fulfillmentConfig(t, m, 1, 2)
			stages := pipelineconfig.Defaults(m.vacancy).Stages
			first, err := m.move(t, m.item, stages[1].ID, false)
			if err != nil || first.Delivery.Delivered != 1 || first.Delivery.State != "pending" {
				t.Fatal(first, err)
			}
			back, err := m.move(t, first.Item, stages[0].ID, false)
			if err != nil {
				t.Fatal(err)
			}
			again, err := m.move(t, back.Item, stages[1].ID, false)
			if err != nil || again.Delivery.Delivered != 1 || again.Delivery.State != "pending" {
				t.Fatal(again, err)
			}
			preview, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, deliveryBody(m, 1, 2, false))
			if err != nil || preview.Delivered != 1 || len(preview.Candidates) != 1 {
				t.Fatal(preview, err)
			}
			got := preview.Candidates[0]
			if got.ParticipationID != m.item.ID || got.Candidate.ID != m.item.Candidate.ID || got.Candidate.FullName != m.item.Candidate.FullName || !got.ReachedAt.Equal(first.MovedAt) {
				t.Fatal(got)
			}
			organic := fulfillmentOther(t, m)
			moved, err := m.move(t, organic, stages[1].ID, false)
			if err != nil || moved.Delivery.Delivered != 2 || moved.Delivery.State != "fulfilled" {
				t.Fatal(moved, err)
			}
			frozen := fulfillmentStatus(t, m)
			if frozen.Fulfillment == nil || len(frozen.Fulfillment.Candidates) != 2 || !reflect.DeepEqual(frozen.Fulfillment.Candidates[0], got) {
				t.Fatal(frozen)
			}
			assertOneFulfillment(t, m)
		})
	}
}

// SQL fixtures deliberately bypass the future manual intake write route.
func manualReadFixture(t *testing.T, reuse bool) movementFixture {
	t.Helper()
	m := setupMovement(t)
	ctx := context.Background()
	cc, cv := uuid.New(), uuid.New()
	var identity any = cc
	if reuse {
		identity = nil
	}
	key, err := m.storage.Put(ctx, []byte("%PDF-1 manual private"))
	if err != nil {
		t.Fatal(err)
	}
	var oldCV uuid.UUID
	if err = m.pool.QueryRow(ctx, `SELECT cv_version_id FROM process_participations WHERE id=$1`, m.item.ID).Scan(&oldCV); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// Restore only this fixture's participation so the shared harness can clean up.
		if _, err := m.pool.Exec(ctx, `UPDATE process_participations SET source='organic',candidate_id=$2,cv_version_id=$3,company_candidate_id=NULL,company_candidate_cv_id=NULL,added_by=NULL WHERE id=$1`, m.item.ID, m.actor, oldCV); err != nil {
			t.Error(err)
		}
		if _, err := m.pool.Exec(ctx, `DELETE FROM company_candidate_cvs WHERE id=$1`, cv); err != nil {
			t.Error(err)
		}
		if _, err := m.pool.Exec(ctx, `DELETE FROM company_candidates WHERE id=$1`, cc); err != nil {
			t.Error(err)
		}
	})
	if !reuse {
		seedApplyGeo(t, m.fixture)
		if _, err := m.pool.Exec(ctx, `INSERT INTO geo_postal_codes(country_code,postal_code,municipality_code) VALUES('MX','44100','14039') ON CONFLICT DO NOTHING`); err != nil {
			t.Fatal(err)
		}
		_, err = m.pool.Exec(ctx, `INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,state_code,municipality_code,postal_code,years_of_experience,skills,created_by) SELECT $1,$2,'Manual Person','manual@example.test','manual@example.test',country_code,left(municipality_code,2),municipality_code,postal_code,7.9,ARRAY['Go'],$3 FROM geo_postal_codes WHERE country_code='MX' AND postal_code='44100' AND municipality_code='14039'`, cc, m.company, m.recruiter)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := m.pool.Exec(ctx, `INSERT INTO company_candidate_educations(company_candidate_id,position,level,status) VALUES($1,0,'bachelor','completed'),($1,1,'phd','in_progress')`, cc); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = m.pool.Exec(ctx, `INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,21,'application/pdf','manual.pdf')`, cv, m.company, identity, key); err != nil {
		t.Fatal(err)
	}
	var user any
	if reuse {
		user = m.actor
	}
	if _, err = m.pool.Exec(ctx, `UPDATE process_participations SET source='manual',candidate_id=$2,company_candidate_id=$3,cv_version_id=NULL,company_candidate_cv_id=$4,added_by=$5 WHERE id=$1`, m.item.ID, user, identity, cv, m.recruiter); err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE participation_stage_history SET actor_kind='recruiter',actor_id=$2 WHERE participation_id=$1 AND event_kind='intake'`, m.item.ID, m.recruiter); err != nil {
		t.Fatal(err)
	}
	detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Source != "manual" || detail.AddedBy == nil || detail.AddedBy.ID != m.recruiter || detail.AddedBy.Name == "" || detail.CV.ID != cv || detail.CV.Name != "manual.pdf" {
		t.Fatalf("manual detail: %+v", detail)
	}
	if reuse {
		if detail.Candidate.Kind != "organic" || detail.Candidate.ID != m.actor || !reflect.DeepEqual(detail.Profile, m.item.Profile) {
			t.Fatal("reused identity/profile changed", detail)
		}
	} else {
		if detail.Candidate.Kind != "manual" || detail.Candidate.ID != cc || detail.Candidate.FullName != "Manual Person" || detail.Profile.Location == nil || detail.Profile.Location.PostalCode == nil || *detail.Profile.Location.PostalCode != "44100" || detail.Profile.YearsOfExperience == nil || *detail.Profile.YearsOfExperience != 7 || detail.Profile.EducationLevel == nil || *detail.Profile.EducationLevel != "bachelor" || !reflect.DeepEqual(detail.Profile.Skills, []string{"Go"}) {
			t.Fatalf("manual identity/profile: %+v", detail)
		}
	}
	m.item = detail.Item
	return m
}

func TestManualBoardDetailCVAndCandidateIsolation(t *testing.T) {
	for _, reuse := range []bool{false, true} {
		name := "company_identity"
		if reuse {
			name = "reused_organic"
		}
		t.Run(name, func(t *testing.T) {
			m := manualReadFixture(t, reuse)
			ctx := context.Background()
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || len(view.Participations) != 1 || !reflect.DeepEqual(view.Participations[0], m.item) {
				t.Fatal(view, err)
			}
			raw, _ := json.Marshal(m.item)
			var obj map[string]json.RawMessage
			if err = json.Unmarshal(raw, &obj); err != nil {
				t.Fatal(err)
			}
			want := []string{"id", "stage_id", "version", "etag", "candidate", "added_by", "applied_at", "source", "cv", "moved_at", "discard", "substate_id", "profile", "screening_answers"}
			if len(obj) != len(want) {
				t.Fatal(string(raw))
			}
			for _, k := range want {
				if _, ok := obj[k]; !ok {
					t.Fatal("missing", k)
				}
			}
			file, err := m.board.File(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil {
				t.Fatal(err)
			}
			data, err := io.ReadAll(file.Reader)
			file.Reader.Close()
			if err != nil || string(data) != "%PDF-1 manual private" || file.Name != "manual.pdf" {
				t.Fatal(file, err, string(data))
			}
			page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
			if err != nil || len(page.Items) != 0 {
				t.Fatal("manual participation exposed to candidate", page, err)
			}
			foreign := setupMovement(t)
			if _, err = m.board.Board(ctx, foreign.company, foreign.recruiter, m.vacancy); !errors.Is(err, board.ErrNotFound) {
				t.Fatal("foreign board", err)
			}
			if _, err = m.board.Detail(ctx, foreign.company, foreign.recruiter, m.vacancy, m.item.ID); !errors.Is(err, board.ErrNotFound) {
				t.Fatal("foreign detail", err)
			}
			if _, err = m.board.File(ctx, foreign.company, foreign.recruiter, m.vacancy, m.item.ID); !errors.Is(err, board.ErrNotFound) {
				t.Fatal("foreign CV", err)
			}
		})
	}
}

func TestManualMovementDiscardRecoverSubstateAndHistory(t *testing.T) {
	m := manualReadFixture(t, false)
	ctx := context.Background()
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	fulfillmentConfig(t, m, 3, 1)
	catalog, err := m.drafts.PutSubstates(ctx, m.company, m.recruiter, m.vacancy, substatecatalog.ETag(m.vacancy, 0), true, []byte(`{"substates":[{"name":"Interview"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	substate := movementObject(t, catalog.Body)["substates"].([]any)[0].(map[string]any)["id"].(string)
	if _, err := m.pool.Exec(ctx, `INSERT INTO job_draft_management_configs(draft_id,version,hiring_headcount) VALUES($1,1,1)`, m.vacancy); err != nil {
		t.Fatal(err)
	}
	assertOrigin := func(out board.Moved, err error) {
		t.Helper()
		if err != nil || out.Source != "manual" || out.AddedBy == nil || *out.AddedBy != *m.item.AddedBy || out.Candidate != m.item.Candidate {
			t.Fatal(out, err)
		}
	}
	item := m.item
	for i := 1; i <= 3; i++ {
		out, err := m.move(t, item, stages[i].ID, false)
		assertOrigin(out, err)
		item = out.Item
	}
	status := fulfillmentStatus(t, m)
	if status.Fulfillment == nil || len(status.Fulfillment.Candidates) != 1 {
		t.Fatalf("manual delivery not fulfilled: %+v", status)
	}
	reached := status.Fulfillment.Candidates[0]
	if reached.ParticipationID != item.ID || reached.Candidate.ID != item.Candidate.ID || reached.Candidate.FullName != item.Candidate.FullName {
		t.Fatal(reached)
	}
	assertOneFulfillment(t, m)
	out, err := m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(`{"substate_id":"`+substate+`"}`))
	assertOrigin(out, err)
	if out.SubstateID == nil || *out.SubstateID != substate {
		t.Fatal("manual assignment missing", out)
	}
	detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, item.ID)
	if err != nil || detail.SubstateID == nil || *detail.SubstateID != substate {
		t.Fatal(detail, err)
	}
	item = out.Item
	out, err = m.board.Discard(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(`{"reason":{"group":"candidate","key":"unresponsive"}}`))
	assertOrigin(out, err)
	if out.SubstateID != nil {
		t.Fatal("discard retained substate", out)
	}
	item = out.Item
	out, err = m.board.Recover(ctx, m.company, m.recruiter, m.vacancy, item.ID, item.ETag, true, []byte(`{}`))
	assertOrigin(out, err)
	item = out.Item
	out, err = m.move(t, item, stages[4].ID, false)
	assertOrigin(out, err)
	if out.Delivery.Delivered != 1 || out.Delivery.State != "fulfilled" || !reflect.DeepEqual(status.Fulfillment, fulfillmentStatus(t, m).Fulfillment) {
		t.Fatal("manual recovery duplicated or changed delivery", out.Delivery)
	}
	assertOneFulfillment(t, m)
	if out.Coverage.Covered != 1 || out.Coverage.FullCoverageReachedAt == nil {
		t.Fatal(out.Coverage)
	}
	history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, item.ID)
	if err != nil || len(history.Items) < 7 {
		t.Fatal(history, err)
	}
	assigned, cleared := false, false
	for _, entry := range history.Items {
		if entry.Kind == "substate" {
			if entry.ToSubstateID != nil && *entry.ToSubstateID == substate && entry.ToSubstateName != nil && *entry.ToSubstateName == "Interview" {
				assigned = true
			}
			if entry.FromSubstateID != nil && *entry.FromSubstateID == substate && entry.ToSubstateID == nil {
				cleared = true
			}
		}
		if entry.Actor.Kind != "recruiter" || entry.Actor.ID != m.recruiter || entry.Actor.FullName == "" {
			t.Fatal(entry)
		}
	}
	if !assigned || !cleared {
		t.Fatal("missing manual substate history", history)
	}
}
