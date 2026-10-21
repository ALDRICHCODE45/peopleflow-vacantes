//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
)

func columnConfirm(body []byte) []byte {
	return []byte(strings.Replace(string(body), `"stages":`, `"confirm_impact":true,"stages":`, 1))
}
func columnApplied(t *testing.T, raw []byte) pc.Impact {
	t.Helper()
	var out struct {
		Applied pc.Impact `json:"applied_impact"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out.Applied
}
func columnConfig(t *testing.T, raw []byte) pc.Configuration {
	t.Helper()
	var c pc.Configuration
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	return c
}
func columnEffects(t *testing.T, m movementFixture) string {
	t.Helper()
	var raw string
	if err := m.pool.QueryRow(context.Background(), `SELECT jsonb_build_array(
 (SELECT to_jsonb(d) FROM job_drafts d WHERE id=$1),
 (SELECT to_jsonb(p) FROM vacancy_processes p WHERE id=$1),
 (SELECT to_jsonb(c) FROM job_draft_pipeline_configs c WHERE draft_id=$1),
 (SELECT to_jsonb(c) FROM job_draft_delivery_configs c WHERE draft_id=$1),
 (SELECT to_jsonb(f) FROM process_delivery_fulfillments f WHERE process_id=$1),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id=$1),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_events a WHERE entity_id=$1 OR metadata->>'vacancy_id'=$1::text),
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM process_coverage_milestones m WHERE process_id=$1))::text`, m.vacancy).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestColumnsPreviewAppliedEchoAtomicityAndDeliveryReach(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	c := pc.Defaults(m.vacancy)
	moved, err := m.move(t, m.item, c.Stages[1].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	m.item = moved.Item
	beforeBoard, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	c.Stages = append(c.Stages[:1:1], append([]pc.Stage{{Name: "Inserted before candidate"}}, c.Stages[1:]...)...)
	body := movementPipelineBody(t, c)
	before := columnEffects(t, m)
	preview, err := m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, body)
	if err != nil || !preview.HasImpact || len(preview.NotApplicable) != 1 || len(preview.RecoveryReassigned) != 0 || before != columnEffects(t, m) {
		t.Fatal(preview, err)
	}
	if preview.NotApplicable[0].StageID != preview.Stages[1].ID || preview.NotApplicable[0].ParticipationID != m.item.ID.String() || preview.NotApplicable[0].Candidate.ID != m.actor.String() {
		t.Fatal(preview)
	}
	raw, _ := json.Marshal(preview)
	obj := movementKeys(t, movementObject(t, raw), "stages", "not_applicable", "recovery_reassigned", "has_impact")
	if _, present := obj["lifecycle"]; present {
		t.Fatal("preview must not embed lifecycle")
	}
	movementKeys(t, obj["not_applicable"].([]any)[0], "participation_id", "candidate", "stage_id")
	for _, s := range obj["stages"].([]any) {
		movementKeys(t, s, "id", "kind", "name")
	}
	for _, bad := range []struct {
		body []byte
		want error
	}{
		{body, pc.ErrImpactConfirmation},
		{[]byte(strings.Replace(string(body), `"stages":`, `"confirm_impact":null,"stages":`, 1)), nil},
	} {
		_, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, bad.body)
		if err == nil || (bad.want != nil && !errors.Is(err, bad.want)) || before != columnEffects(t, m) {
			t.Fatal("rejected edit wrote effects", err)
		}
	}
	if _, err = m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, columnConfirm(body)); err == nil || before != columnEffects(t, m) {
		t.Fatal("preview accepted confirmation or wrote", err)
	}
	saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, columnConfirm(body))
	if err != nil {
		t.Fatal(err)
	}
	applied := columnApplied(t, saved.Body)
	if !reflect.DeepEqual(applied, preview.Impact) || !reflect.DeepEqual(columnConfig(t, saved.Body).Stages, preview.Stages) {
		t.Fatal(applied, preview)
	}
	obj = movementKeys(t, movementObject(t, saved.Body), "version", "structure_locked", "stages", "exit", "limits", "retired", "applied_impact")
	if _, present := obj["lifecycle"]; present {
		t.Fatal("PUT must not embed lifecycle")
	}
	movementKeys(t, obj["applied_impact"], "not_applicable", "recovery_reassigned")
	afterBoard, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || !reflect.DeepEqual(afterBoard.Participations[0], m.item) || !reflect.DeepEqual(afterBoard.Coverage, beforeBoard.Coverage) || afterBoard.Delivery != beforeBoard.Delivery {
		t.Fatal(afterBoard, err)
	}
	history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil || len(history.Items) != 3 {
		t.Fatal(history, err)
	}
	mark := history.Items[2]
	raw, _ = json.Marshal(mark)
	movementKeys(t, movementObject(t, raw), "kind", "stage_id", "actor", "at")
	if mark.Kind != "not_applicable" || mark.Actor.ID != m.recruiter || mark.Actor.Kind != "recruiter" || mark.ToStageID != preview.Stages[1].ID {
		t.Fatal(mark)
	}
	var metadata []byte
	if err = m.pool.QueryRow(ctx, `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftPipelineConfigured'`, m.vacancy).Scan(&metadata); err != nil {
		t.Fatal(err)
	}
	var event map[string]string
	_ = json.Unmarshal(metadata, &event)
	var audited pc.Impact
	_ = json.Unmarshal([]byte(event["applied_impact"]), &audited)
	if !reflect.DeepEqual(audited, applied) {
		t.Fatal(event)
	}
	// Not-applicable is never a delivery entry, even when choosing that cutoff.
	deliveryBody := []byte(`{"cutoffStageId":"` + preview.Stages[1].ID + `","targetQuantity":2,"commitmentDate":"2020-01-02"}`)
	deliveryPreview, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, deliveryBody)
	if err != nil || deliveryPreview.Delivered != 0 || len(deliveryPreview.Candidates) != 0 || deliveryPreview.WouldFulfill {
		t.Fatal(deliveryPreview, err)
	}
	current := columnConfig(t, saved.Body)
	before = columnEffects(t, m)
	noop, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, movementPipelineBody(t, current))
	if err != nil || noop.ETag != saved.ETag || columnApplied(t, noop.Body).HasImpact() || before != columnEffects(t, m) {
		t.Fatal(noop, err)
	}
	get, err := m.drafts.GetPipeline(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	movementKeys(t, movementObject(t, get.Body), "version", "structure_locked", "stages", "exit", "limits", "retired", "lifecycle")
	current.Stages[1].Name = "Renamed"
	if _, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, movementPipelineBody(t, current)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM participation_stage_history WHERE participation_id=$1 AND event_kind='not_applicable'`, m.item.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("duplicate marks", count, err)
	}
}

func TestColumnsEditsPreserveFrozenFulfillment(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	base := pc.Defaults(m.vacancy)
	fulfillmentConfig(t, m, 1, 1)
	moved, err := m.move(t, m.item, base.Stages[1].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	m.item = moved.Item
	before := fulfillmentStatus(t, m)
	if before.State != "fulfilled" {
		t.Fatal(before)
	}
	proposal := base
	proposal.Stages[1].Name = "Renamed cutoff"
	proposal.Stages = append(proposal.Stages[:1:1], append([]pc.Stage{{Name: "Not delivered"}}, proposal.Stages[1:]...)...)
	_, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, columnConfirm(movementPipelineBody(t, proposal)))
	if err != nil {
		t.Fatal(err)
	}
	after := fulfillmentStatus(t, m)
	if !reflect.DeepEqual(before, after) || after.Fulfillment.CutoffStageName != "Screening" {
		t.Fatal("edit changed frozen attainment/snapshot", before, after)
	}
	assertOneFulfillment(t, m)
}

func TestColumnsImpactAuditFailureRollsBackMarksAndConfiguration(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	base := pc.Defaults(m.vacancy)
	moved, err := m.move(t, m.item, base.Stages[1].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	m.item = moved.Item
	proposal := base
	proposal.Stages = append(base.Stages[:1:1], append([]pc.Stage{{Name: "Before candidate"}}, base.Stages[1:]...)...)
	before := columnEffects(t, m)
	failing := draftstore.NewStore(m.pool, rejectAudit{})
	_, err = failing.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, columnConfirm(movementPipelineBody(t, proposal)))
	if err == nil || before != columnEffects(t, m) {
		t.Fatal("audit failure did not roll back all marks/configuration", err)
	}
}

func TestColumnsAppliedImpactRecomputedAfterPreviewMove(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	c := pc.Defaults(m.vacancy)
	c.Stages = append(c.Stages[:1:1], append([]pc.Stage{{Name: "New step"}}, c.Stages[1:]...)...)
	body := movementPipelineBody(t, c)
	preview, err := m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, body)
	if err != nil || preview.HasImpact {
		t.Fatal(preview, err)
	}
	moved, err := m.move(t, m.item, pc.Defaults(m.vacancy).Stages[1].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	m.item = moved.Item
	before := columnEffects(t, m)
	if _, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, body); !errors.Is(err, pc.ErrImpactConfirmation) || before != columnEffects(t, m) {
		t.Fatal(err)
	}
	saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, columnConfirm(body))
	if err != nil {
		t.Fatal(err)
	}
	applied := columnApplied(t, saved.Body)
	if reflect.DeepEqual(applied, preview.Impact) || len(applied.NotApplicable) != 1 || applied.NotApplicable[0].StageID != preview.Stages[1].ID {
		t.Fatal(applied, preview)
	}
}

func TestColumnsRetiredRecoveryPlacementConfirmationAndRealReach(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	base := pc.Defaults(m.vacancy)
	proposal := base
	proposal.Stages = append(base.Stages[:4:4], pc.Stage{Name: "One"}, pc.Stage{Name: "Two"}, pc.Stage{Name: "Three"}, base.Stages[4])
	saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, movementPipelineBody(t, proposal))
	if err != nil {
		t.Fatal(err)
	}
	current := columnConfig(t, saved.Body)
	for _, stage := range current.Stages[1:7] {
		out, err := m.move(t, m.item, stage.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		m.item = out.Item
	}
	discarded, err := m.discard(t, m.item, discardBody)
	if err != nil {
		t.Fatal(err)
	}
	m.item = discarded.Item
	saved, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, columnConfirm(movementPipelineBody(t, base)))
	if err != nil {
		t.Fatal(err)
	}
	impact := columnApplied(t, saved.Body)
	target := base.Stages[4].ID
	if len(impact.RecoveryReassigned) != 1 || impact.RecoveryReassigned[0].DefaultStageID != target || len(impact.NotApplicable) != 1 || impact.NotApplicable[0].StageID != target {
		t.Fatal(impact)
	}
	before := columnEffects(t, m)
	if _, err = m.recover(t, m.item, `{"to_stage_id":"`+target+`"}`); !errors.Is(err, board.ErrPlacementReentry) || before != columnEffects(t, m) {
		t.Fatal("placement override lacked confirmation", err)
	}
	status, err := m.drafts.GetDeliveryStatus(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || status.Delivered != 0 {
		t.Fatal("mark counted as reached", status, err)
	}
	recovered, err := m.recover(t, m.item, `{"to_stage_id":"`+target+`","confirm_placement_reentry":true}`)
	if err != nil || recovered.StageID != target || recovered.Coverage.Covered != 1 || recovered.Delivery.Delivered != 1 {
		t.Fatal(recovered, err)
	}
	h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !h.Items[len(h.Items)-1].Hire || h.Items[len(h.Items)-1].Kind != "recovery" {
		t.Fatal(h)
	}
}

func TestColumnsReorderDoesNotMarkReachedStages(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	c := pc.Defaults(m.vacancy)
	for _, index := range []int{1, 2, 1} {
		out, err := m.move(t, m.item, c.Stages[index].ID, false)
		if err != nil {
			t.Fatal(err)
		}
		m.item = out.Item
	}
	c.Stages[1], c.Stages[3] = c.Stages[3], c.Stages[1]
	preview, err := m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, movementPipelineBody(t, c))
	if err != nil || len(preview.NotApplicable) != 1 || preview.NotApplicable[0].StageID != c.Stages[1].ID {
		t.Fatal(preview, err)
	}
	saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, columnConfirm(movementPipelineBody(t, c)))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(columnApplied(t, saved.Body), preview.Impact) {
		t.Fatal(string(saved.Body))
	}
	// Current screening at index 3 now advances directly to placement.
	out, err := m.move(t, m.item, c.Stages[4].ID, false)
	if err != nil || out.StageID != c.Stages[4].ID {
		t.Fatal(out, err)
	}
}

func TestColumnsRemoveOccupiedCutoffAndDiscardedRecovery(t *testing.T) {
	for _, earlier := range []bool{false, true} {
		t.Run(map[bool]string{false: "default", true: "earlier"}[earlier], func(t *testing.T) {
			m := setupMovement(t)
			ctx := context.Background()
			base := pc.Defaults(m.vacancy)
			proposed := base
			proposed.Stages = append(base.Stages[:2:2], append([]pc.Stage{{Name: "Historical interview"}}, base.Stages[2:]...)...)
			saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, movementPipelineBody(t, proposed))
			if err != nil {
				t.Fatal(err)
			}
			current := columnConfig(t, saved.Body)
			custom := current.Stages[2]
			for _, s := range current.Stages[1:3] {
				out, err := m.move(t, m.item, s.ID, false)
				if err != nil {
					t.Fatal(err)
				}
				m.item = out.Item
			}
			remove := movementPipelineBody(t, base)
			before := columnEffects(t, m)
			for _, preview := range []bool{true, false} {
				var err error
				if preview {
					_, err = m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, remove)
				} else {
					_, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, columnConfirm(remove))
				}
				var occupied *pc.Occupied
				if !errors.As(err, &occupied) || !reflect.DeepEqual(occupied.StageIDs, []string{custom.ID}) || before != columnEffects(t, m) {
					t.Fatal(err)
				}
			}
			discarded, err := m.discard(t, m.item, discardBody)
			if err != nil {
				t.Fatal(err)
			}
			m.item = discarded.Item
			before = columnEffects(t, m)
			if _, err = m.recover(t, m.item, `{"to_stage_id":"`+custom.ID+`"}`); !errors.Is(err, board.ErrValidation) || before != columnEffects(t, m) {
				t.Fatal("target must be absent when previous exists", err)
			}
			// A retained discard previous stage is not an occupant, but cutoff is guarded.
			var oldCutoff string
			if err = m.pool.QueryRow(ctx, `SELECT cutoff_stage_id::text FROM job_draft_delivery_configs WHERE draft_id=$1`, m.vacancy).Scan(&oldCutoff); err != nil {
				t.Fatal(err)
			}
			if _, err = m.pool.Exec(ctx, `UPDATE job_draft_delivery_configs SET cutoff_stage_id=$2 WHERE draft_id=$1`, m.vacancy, custom.ID); err != nil {
				t.Fatal(err)
			}
			before = columnEffects(t, m)
			for _, preview := range []bool{true, false} {
				if preview {
					_, err = m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, remove)
				} else {
					_, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, columnConfirm(remove))
				}
				if !errors.Is(err, pc.ErrCutoffStageInUse) || before != columnEffects(t, m) {
					t.Fatal(err)
				}
			}
			if _, err = m.pool.Exec(ctx, `UPDATE job_draft_delivery_configs SET cutoff_stage_id=$2 WHERE draft_id=$1`, m.vacancy, oldCutoff); err != nil {
				t.Fatal(err)
			}
			before = columnEffects(t, m)
			preview, err := m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, remove)
			if err != nil || len(preview.RecoveryReassigned) != 1 || !preview.HasImpact || len(preview.NotApplicable) != 0 || before != columnEffects(t, m) {
				t.Fatal(preview, err)
			}
			rawPreview, _ := json.Marshal(preview)
			recoveryItem := movementObject(t, rawPreview)["recovery_reassigned"].([]any)[0]
			recoveryKeys := movementKeys(t, recoveryItem, "participation_id", "candidate", "retired_stage_id", "default_stage_id")
			movementKeys(t, recoveryKeys["candidate"], "id", "full_name")
			if preview.RecoveryReassigned[0].RetiredStageID != custom.ID || preview.RecoveryReassigned[0].DefaultStageID != base.Stages[1].ID {
				t.Fatal(preview)
			}
			if _, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, remove); !errors.Is(err, pc.ErrImpactConfirmation) || before != columnEffects(t, m) {
				t.Fatal(err)
			}
			saved, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, columnConfirm(remove))
			if err != nil || !reflect.DeepEqual(columnApplied(t, saved.Body), preview.Impact) {
				t.Fatal(string(saved.Body), err)
			}
			retired := movementObject(t, saved.Body)["retired"].([]any)
			r := movementKeys(t, retired[0], "id", "kind", "name")
			if len(retired) != 1 || r["id"] != custom.ID || r["name"] != custom.Name {
				t.Fatal(retired)
			}
			view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil || len(view.RetiredStages) != 1 || view.RetiredStages[0].Name != custom.Name || view.Participations[0].Discard.RecoveryStageID != base.Stages[1].ID || view.Participations[0].Discard.PreviousStageID != custom.ID {
				t.Fatal(view, err)
			}
			rawBoard, _ := json.Marshal(view)
			boardWire := movementKeys(t, movementObject(t, rawBoard), "stages", "exit", "coverage", "participations", "substates", "delivery", "retired_stages", "screening_filters", "lifecycle")
			movementKeys(t, boardWire["retired_stages"].([]any)[0], "id", "kind", "name")
			movementKeys(t, boardWire["participations"].([]any)[0].(map[string]any)["discard"], "reason", "discarded_at", "previous_stage_id", "recovery_stage_id")
			for _, tc := range []struct {
				body string
				want error
			}{
				{`{}`, board.ErrRecoveryStageRequired},
				{`{"to_stage_id":"` + base.Stages[2].ID + `"}`, board.ErrValidation},
				{`{"to_stage_id":"` + uuid.NewString() + `"}`, board.ErrValidation},
				{`{"to_stage_id":"` + custom.ID + `"}`, board.ErrValidation},
			} {
				before = columnEffects(t, m)
				_, err := m.recover(t, m.item, tc.body)
				if !errors.Is(err, tc.want) || before != columnEffects(t, m) {
					t.Fatal(tc.body, err)
				}
			}
			target := base.Stages[1].ID
			if earlier {
				target = base.Stages[0].ID
			}
			recovered, err := m.recover(t, m.item, `{"to_stage_id":"`+target+`"}`)
			if err != nil || recovered.StageID != target || recovered.Discard != nil || recovered.SubstateID != nil || recovered.Coverage.Covered != 0 || recovered.Delivery != discarded.Delivery {
				t.Fatal(recovered, err)
			}
			var override, previous string
			if err = m.pool.QueryRow(ctx, `SELECT metadata->>'recovery_override',metadata->>'previous_stage_id' FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationRecovered'`, m.item.ID).Scan(&override, &previous); err != nil || override != "true" || previous != custom.ID {
				t.Fatal(override, previous, err)
			}
			h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil || h.Items[len(h.Items)-1].Kind != "recovery" || h.Items[len(h.Items)-1].ToStageID != target {
				t.Fatal(h, err)
			}
		})
	}
}
