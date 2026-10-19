//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
)

func TestColumnsSuccessfulEditsPreserveEveryHistoryRowAndActiveSubstate(t *testing.T) {
	m, id := activeSubstateFixture(t)
	ctx := context.Background()
	m.item = setSubstateHTTP(t, m, id)
	// Include immutable name snapshots and discard/recovery fields, not only
	// the intake/move projection returned by History.
	discarded, err := m.discard(t, m.item, discardBody)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := m.recover(t, discarded.Item, `{}`)
	if err != nil {
		t.Fatal(err)
	}
	m.item = recovered.Item
	m.item = setSubstateHTTP(t, m, id)
	readHistory := func() map[string]json.RawMessage {
		t.Helper()
		var raw []byte
		if err := m.pool.QueryRow(ctx, `SELECT jsonb_object_agg(h.id,to_jsonb(h)) FROM participation_stage_history h WHERE participation_id=$1`, m.item.ID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var rows map[string]json.RawMessage
		if err := json.Unmarshal(raw, &rows); err != nil {
			t.Fatal(err)
		}
		return rows
	}
	current := pc.Defaults(m.vacancy)
	tag := pc.ETag(m.vacancy, 0)
	for _, edit := range []string{"insert", "rename", "reorder"} {
		t.Run(edit, func(t *testing.T) {
			before := readHistory()
			detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil {
				t.Fatal(err)
			}
			switch edit {
			case "insert":
				current.Stages = append(current.Stages[:1:1], append([]pc.Stage{{Name: "Added"}}, current.Stages[1:]...)...)
			case "rename":
				current.Stages[1].Name = "Renamed"
			case "reorder":
				current.Stages[1], current.Stages[2] = current.Stages[2], current.Stages[1]
			}
			saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, tag, true, columnConfirm(movementPipelineBody(t, current)))
			if err != nil {
				t.Fatal(err)
			}
			tag, current = saved.ETag, columnConfig(t, saved.Body)
			after := readHistory()
			for key, row := range before {
				if !reflect.DeepEqual(row, after[key]) {
					t.Fatalf("pre-existing history row %s changed or disappeared", key)
				}
			}
			if edit == "insert" && len(after) <= len(before) {
				t.Fatal("fixture must produce new not_applicable history")
			}
			next, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil || next.SubstateID == nil || *next.SubstateID != id || !reflect.DeepEqual(detail, next) {
				t.Fatal("column edit changed participation/substate", err)
			}
		})
	}
}

func TestColumnsOrdinaryRecoveryAuditsOverrideFalse(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	discarded, err := m.discard(t, m.item, discardBody)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := m.recover(t, discarded.Item, `{}`)
	if err != nil || recovered.StageID != m.item.StageID {
		t.Fatal(recovered, err)
	}
	var count int
	var override, previous string
	if err = m.pool.QueryRow(ctx, `SELECT count(*),min(metadata->>'recovery_override'),min(metadata->>'previous_stage_id') FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationRecovered'`, m.item.ID).Scan(&count, &override, &previous); err != nil || count != 1 || override != "false" || previous != m.item.StageID {
		t.Fatal(count, override, previous, err)
	}
}

func TestColumnsCutoffRemovalRejectedAfterFulfillment(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	base := pc.Defaults(m.vacancy)
	proposal := pc.Defaults(m.vacancy)
	proposal.Stages = append(proposal.Stages[:1:1], append([]pc.Stage{{Name: "Custom cutoff"}}, proposal.Stages[1:]...)...)
	saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, movementPipelineBody(t, proposal))
	if err != nil {
		t.Fatal(err)
	}
	cutoff := columnConfig(t, saved.Body).Stages[1].ID
	if _, err = m.pool.Exec(ctx, `UPDATE job_draft_delivery_configs SET cutoff_stage_id=$2,target_quantity=1 WHERE draft_id=$1`, m.vacancy, cutoff); err != nil {
		t.Fatal(err)
	}
	moved, err := m.move(t, m.item, cutoff, false)
	if err != nil || moved.Delivery.State != "fulfilled" {
		t.Fatal(moved, err)
	}
	// Remove occupancy as a competing rejection reason: the retained cutoff,
	// even after fulfillment, is the sole reason this edit must fail.
	moved, err = m.move(t, moved.Item, base.Stages[0].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	m.item = moved.Item
	frozen := fulfillmentStatus(t, m)
	before := columnEffects(t, m)
	for _, operation := range []string{"preview", "put"} {
		var err error
		if operation == "preview" {
			_, err = m.drafts.PreviewPipeline(ctx, m.company, m.recruiter, m.vacancy, movementPipelineBody(t, base))
		} else {
			_, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, columnConfirm(movementPipelineBody(t, base)))
		}
		if !errors.Is(err, pc.ErrCutoffStageInUse) || before != columnEffects(t, m) || !reflect.DeepEqual(frozen, fulfillmentStatus(t, m)) {
			t.Fatal(operation, err)
		}
	}
	assertOneFulfillment(t, m)
}
