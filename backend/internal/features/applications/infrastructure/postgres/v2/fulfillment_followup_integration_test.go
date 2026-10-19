//go:build integration

package v2

import (
	"context"
	"strings"
	"testing"
	"time"

	pc "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func TestFulfillmentRecoverySoleFirstAttainment(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	base := pc.Defaults(m.vacancy)
	proposal := pc.Defaults(m.vacancy)
	proposal.Stages = append(proposal.Stages[:2:2], append([]pc.Stage{{Name: "Retire me"}}, proposal.Stages[2:]...)...)
	saved, err := m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pc.ETag(m.vacancy, 0), true, movementPipelineBody(t, proposal))
	if err != nil {
		t.Fatal(err)
	}
	current := columnConfig(t, saved.Body)
	for _, s := range current.Stages[1:3] {
		out, err := m.move(t, m.item, s.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		m.item = out.Item
	}
	out, err := m.discard(t, m.item, discardBody)
	if err != nil {
		t.Fatal(err)
	}
	m.item = out.Item
	// A new cutoff replaces the step preceding the retired stage. The edit's
	// not_applicable mark must not count as attainment; only recovery reaches it.
	proposal = base
	proposal.Stages = append(proposal.Stages[:1:1], append([]pc.Stage{{Name: "New cutoff"}}, proposal.Stages[1:]...)...)
	saved, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, saved.ETag, true, columnConfirm(movementPipelineBody(t, proposal)))
	if err != nil {
		t.Fatal(err)
	}
	cutoff := columnConfig(t, saved.Body).Stages[1].ID
	if _, err = m.pool.Exec(ctx, `UPDATE job_draft_delivery_configs SET cutoff_stage_id=$2,target_quantity=1 WHERE draft_id=$1`, m.vacancy, cutoff); err != nil {
		t.Fatal(err)
	}
	before := fulfillmentStatus(t, m)
	if before.State != "pending" || before.Delivered != 0 {
		t.Fatal(before)
	}
	var entries, marks int
	if err = m.pool.QueryRow(ctx, `SELECT count(*) FILTER(WHERE event_kind IN ('intake','move','recovery')),count(*) FILTER(WHERE event_kind='not_applicable') FROM participation_stage_history WHERE participation_id=$1 AND stage_id=$2`, m.item.ID, cutoff).Scan(&entries, &marks); err != nil || entries != 0 || marks != 1 {
		t.Fatal(entries, marks, err)
	}
	recovered, err := m.recover(t, m.item, `{"to_stage_id":"`+cutoff+`"}`)
	if err != nil || recovered.Delivery.State != "fulfilled" || recovered.Delivery.Delivered != 1 {
		t.Fatal(recovered, err)
	}
	got := fulfillmentStatus(t, m)
	if got.Fulfillment == nil || len(got.Fulfillment.Candidates) != 1 || got.Fulfillment.Candidates[0].ParticipationID != m.item.ID || !got.Fulfillment.Candidates[0].ReachedAt.Equal(recovered.MovedAt) || !got.Fulfillment.FulfilledAt.Equal(recovered.MovedAt) {
		t.Fatal(got)
	}
	assertOneFulfillment(t, m)
}

func TestFulfillmentSubstateOnlyHistoryNeverCountsAsReached(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	cutoff := pc.Defaults(m.vacancy).Stages[1].ID
	fulfillmentConfig(t, m, 1, 1)
	// Deliberately no intake/move/recovery at this cutoff. A retained substate
	// entry has a stage_id too, but it is not an entry into that stage.
	subAt := m.item.AppliedAt.Add(time.Microsecond)
	if _, err := m.pool.Exec(ctx, `INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,actor_kind,event_kind,to_substate_id,to_substate_name,created_at) VALUES($1,$2,$3,$4,'recruiter','substate',$5,'Historical label',$6)`, uuid.New(), m.item.ID, cutoff, m.recruiter, uuid.New(), subAt); err != nil {
		t.Fatal(err)
	}
	before := fulfillmentEffects(t, m)
	got := fulfillmentStatus(t, m)
	preview, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, deliveryBody(m, 1, 1, false))
	if err != nil || got.Delivered != 0 || got.State != "pending" || preview.Delivered != 0 || preview.WouldFulfill || len(preview.Candidates) != 0 || before != fulfillmentEffects(t, m) {
		t.Fatal(got, preview, err)
	}
	moved, err := m.move(t, m.item, cutoff, false)
	if err != nil {
		t.Fatal(err)
	}
	got = fulfillmentStatus(t, m)
	if got.Fulfillment == nil || !got.Fulfillment.Candidates[0].ReachedAt.Equal(moved.MovedAt) || !got.Fulfillment.Candidates[0].ReachedAt.After(subAt) {
		t.Fatal("substate supplied the attainment timestamp", got)
	}
	assertOneFulfillment(t, m)
}

func TestFulfillmentMissingConfigRollsBackTrigger(t *testing.T) {
	for _, trigger := range []string{"move", "apply", "recovery"} {
		t.Run(trigger, func(t *testing.T) {
			m := setupMovement(t)
			ctx := context.Background()
			if trigger == "recovery" {
				out, err := m.discard(t, m.item, discardBody)
				if err != nil {
					t.Fatal(err)
				}
				m.item = out.Item
			}
			var operation func() error
			if trigger == "apply" {
				cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1"))
				if err != nil {
					t.Fatal(err)
				}
				operation = func() error {
					_, err := m.store.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID))
					return err
				}
			} else if trigger == "move" {
				operation = func() error { _, err := m.move(t, m.item, pc.Defaults(m.vacancy).Stages[1].ID, false); return err }
			} else {
				operation = func() error { _, err := m.recover(t, m.item, `{}`); return err }
			}
			// Unsupported corrupt deployment state: fail closed rather than silently
			// retaining a partial participation/history/audit/idempotency write.
			if _, err := m.pool.Exec(ctx, `DELETE FROM job_draft_delivery_configs WHERE draft_id=$1`, m.vacancy); err != nil {
				t.Fatal(err)
			}
			before := fulfillmentEffects(t, m)
			err := operation()
			if err == nil || !strings.Contains(err.Error(), "published delivery configuration incomplete") || before != fulfillmentEffects(t, m) {
				t.Fatal("missing config did not fail closed atomically", err)
			}
		})
	}
}
