//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/fulfillment"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func fulfillmentConfig(t *testing.T, m movementFixture, index int, target int) {
	t.Helper()
	_, err := m.pool.Exec(context.Background(), `UPDATE job_draft_delivery_configs SET cutoff_stage_id=$2,target_quantity=$3 WHERE draft_id=$1`, m.vacancy, pipelineconfig.Defaults(m.vacancy).Stages[index].ID, target)
	if err != nil {
		t.Fatal(err)
	}
}
func fulfillmentStatus(t *testing.T, m movementFixture) fulfillment.Status {
	t.Helper()
	out, err := m.drafts.GetDeliveryStatus(context.Background(), m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	return out
}
func fulfillmentEffects(t *testing.T, m movementFixture) string {
	t.Helper()
	var raw string
	if err := m.pool.QueryRow(context.Background(), `SELECT jsonb_build_array(
 (SELECT to_jsonb(f) FROM process_delivery_fulfillments f WHERE process_id=$1),
 (SELECT to_jsonb(d) FROM job_draft_delivery_configs d WHERE draft_id=$1),
 (SELECT to_jsonb(d) FROM job_drafts d WHERE id=$1),
 (SELECT to_jsonb(v) FROM vacancy_public_projections v WHERE id=$1),
 (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE entity_id=$1 OR metadata->>'vacancy_id'=$1::text),
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id=$1),
 (SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id WHERE p.process_id=$1),
 (SELECT jsonb_agg(to_jsonb(i) ORDER BY idem_key) FROM participation_idempotency i WHERE process_id=$1))::text`, m.vacancy).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}
func deliveryBody(m movementFixture, index, target int, confirm bool) []byte {
	flag := ""
	if confirm {
		flag = `,"confirm_fulfillment":true`
	}
	return []byte(`{"cutoffStageId":"` + pipelineconfig.Defaults(m.vacancy).Stages[index].ID + `","targetQuantity":` + stringNumber(target) + `,"commitmentDate":"2020-01-02"` + flag + `}`)
}
func stringNumber(n int) string { raw, _ := json.Marshal(n); return string(raw) }
func fulfillmentOther(t *testing.T, m movementFixture) board.Item {
	t.Helper()
	ctx := context.Background()
	cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1 other"))
	if err != nil {
		t.Fatal(err)
	}
	result, err := m.store.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID))
	if err != nil {
		t.Fatal(err)
	}
	var submitted app.Submitted
	if err = json.Unmarshal(result.Body, &submitted); err != nil {
		t.Fatal(err)
	}
	detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, submitted.ID)
	if err != nil {
		t.Fatal(err)
	}
	return detail.Item
}
func assertOneFulfillment(t *testing.T, m movementFixture) {
	t.Helper()
	var rows, events int
	if err := m.pool.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM process_delivery_fulfillments WHERE process_id=$1),(SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyDeliveryFulfilled')`, m.vacancy).Scan(&rows, &events); err != nil || rows != 1 || events != 1 {
		t.Fatal(rows, events, err)
	}
	var raw string
	if err := m.pool.QueryRow(context.Background(), `SELECT metadata->>'snapshot' FROM audit_events WHERE entity_id=$1 AND event_type='VacancyDeliveryFulfilled'`, m.vacancy).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var snapshot fulfillment.Snapshot
	if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(snapshot, *fulfillmentStatus(t, m).Fulfillment) {
		t.Fatal("audit snapshot differs from frozen resource")
	}
}
func TestFulfillmentHistoricalReachedUniqueAndDiscardRetention(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	fulfillmentConfig(t, m, 1, 3)
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	if got := fulfillmentStatus(t, m); got.State != "pending" || got.Delivered != 0 || got.Target != 3 || got.BusinessDaysRemaining == nil || *got.BusinessDaysRemaining >= 0 {
		t.Fatal(got)
	}
	moved, err := m.move(t, m.item, stages[1].ID, false)
	if err != nil || moved.Delivery.Delivered != 1 || moved.Delivery.State != "pending" {
		t.Fatal(moved, err)
	}
	firstAt := moved.MovedAt
	back, err := m.move(t, moved.Item, stages[0].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	again, err := m.move(t, back.Item, stages[1].ID, false)
	if err != nil {
		t.Fatal(err)
	}
	discarded, err := m.board.Discard(ctx, m.company, m.recruiter, m.vacancy, again.ID, again.ETag, true, []byte(`{"reason":{"group":"candidate","key":"unresponsive"}}`))
	if err != nil || discarded.Delivery.Delivered != 1 {
		t.Fatal(discarded, err)
	}
	before := fulfillmentEffects(t, m)
	preview, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, deliveryBody(m, 1, 2, false))
	if err != nil || preview.WouldFulfill || preview.Delivered != 1 || len(preview.Candidates) != 1 || !preview.Candidates[0].ReachedAt.Equal(firstAt) || before != fulfillmentEffects(t, m) {
		t.Fatal(preview, err)
	}
	recovered, err := m.board.Recover(ctx, m.company, m.recruiter, m.vacancy, discarded.ID, discarded.ETag, true, []byte(`{}`))
	if err != nil || recovered.Delivery.Delivered != 1 {
		t.Fatal(recovered, err)
	}
	// Substate changes are not entries into a stage.
	for i := 2; i <= 3; i++ {
		v, e := m.move(t, recovered.Item, stages[i].ID, false)
		if e != nil {
			t.Fatal(e)
		}
		recovered = v
	}
	set, err := m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, recovered.ID, recovered.ETag, true, []byte(`{"substate_id":null}`))
	if err != nil || set.Delivery.Delivered != 1 {
		t.Fatal(set, err)
	}
}
func TestFulfillmentMoveFreezesSnapshotAndAllWritesKeepSummary(t *testing.T) {
	m := setupMovement(t)
	ctx := context.Background()
	fulfillmentConfig(t, m, 1, 1)
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	moved, err := m.move(t, m.item, stages[1].ID, false)
	if err != nil || moved.Delivery.State != "fulfilled" || moved.Delivery.Delivered != 1 || moved.Delivery.Target != 1 {
		t.Fatal(moved, err)
	}
	status := fulfillmentStatus(t, m)
	if status.Fulfillment == nil || status.State != "fulfilled" || status.BusinessDaysRemaining != nil || status.Fulfillment.Result != "late" || status.Fulfillment.BusinessDaysDelta >= 0 || !status.Fulfillment.FulfilledAt.Equal(moved.MovedAt) || status.Fulfillment.CutoffStageName != "Screening" || len(status.Fulfillment.Candidates) != 1 || status.Fulfillment.Candidates[0].ParticipationID != m.item.ID {
		t.Fatal(status)
	}
	assertOneFulfillment(t, m)
	resource, err := m.drafts.GetDelivery(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || movementObject(t, resource.Body)["fulfilled"] != true {
		t.Fatal(resource, err)
	}
	before := fulfillmentEffects(t, m)
	for _, body := range [][]byte{deliveryBody(m, 1, 1, true), deliveryBody(m, 0, 999, false), []byte(`broken`)} {
		_, err = m.drafts.PutDelivery(ctx, m.company, m.recruiter, m.vacancy, resource.ETag, true, body)
		if !errors.Is(err, fulfillment.ErrFulfilled) || before != fulfillmentEffects(t, m) {
			t.Fatal("freeze changed state", err)
		}
	}
	if _, err = m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, deliveryBody(m, 0, 1, false)); !errors.Is(err, fulfillment.ErrFulfilled) || before != fulfillmentEffects(t, m) {
		t.Fatal(err)
	}
	// Later movement, names, discards and new applications cannot rewrite the result.
	back, err := m.move(t, moved.Item, stages[0].ID, false)
	if err != nil || back.Delivery != moved.Delivery {
		t.Fatal(back, err)
	}
	discarded, err := m.board.Discard(ctx, m.company, m.recruiter, m.vacancy, back.ID, back.ETag, true, []byte(`{"reason":{"group":"candidate","key":"unresponsive"}}`))
	if err != nil || discarded.Delivery != moved.Delivery {
		t.Fatal(discarded, err)
	}
	if _, err = m.pool.Exec(ctx, `UPDATE users SET full_name='Later name' WHERE id=$1`, m.actor); err != nil {
		t.Fatal(err)
	}
	renamed := pipelineconfig.Defaults(m.vacancy)
	renamed.Stages[1].Name = "Renamed cutoff"
	if _, err = m.drafts.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pipelineconfig.ETag(m.vacancy, 0), true, movementPipelineBody(t, renamed)); err != nil {
		t.Fatal(err)
	}
	fulfillmentOther(t, m)
	if got := fulfillmentStatus(t, m); !reflect.DeepEqual(got, status) {
		t.Fatal("frozen status drifted", got, status)
	}
	view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || view.Delivery != moved.Delivery {
		t.Fatal(view, err)
	}
	assertOneFulfillment(t, m)
}
func TestFulfillmentDeliveryEditsPreviewConfirmationAndCandidateOrder(t *testing.T) {
	for _, change := range []string{"target reduction", "cutoff change"} {
		t.Run(change, func(t *testing.T) {
			m := setupMovement(t)
			readyMovementConfiguration(t, m)
			ctx := context.Background()
			other := fulfillmentOther(t, m)
			stages := pipelineconfig.Defaults(m.vacancy).Stages
			for _, item := range []board.Item{m.item, other} {
				if _, err := m.move(t, item, stages[1].ID, false); err != nil {
					t.Fatal(err)
				}
			}
			// Equal timestamps deliberately protect the participation-id tie break.
			at := time.Date(2026, 1, 1, 18, 0, 0, 0, time.UTC)
			if _, err := m.pool.Exec(ctx, `UPDATE participation_stage_history SET created_at=$2 WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=$1) AND stage_id=$3`, m.vacancy, at, stages[1].ID); err != nil {
				t.Fatal(err)
			}
			if change == "target reduction" {
				fulfillmentConfig(t, m, 1, 3)
			} else {
				fulfillmentConfig(t, m, 4, 1)
			}
			before := fulfillmentEffects(t, m)
			preview, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, deliveryBody(m, 1, 1, false))
			if err != nil || !preview.WouldFulfill || preview.Delivered != 2 || len(preview.Candidates) != 2 || !preview.Candidates[0].ReachedAt.Equal(at) || preview.Candidates[0].ParticipationID.String() > preview.Candidates[1].ParticipationID.String() || before != fulfillmentEffects(t, m) {
				t.Fatal(preview, err)
			}
			resource, err := m.drafts.GetDelivery(ctx, m.company, m.recruiter, m.vacancy)
			if err != nil {
				t.Fatal(err)
			}
			_, err = m.drafts.PutDelivery(ctx, m.company, m.recruiter, m.vacancy, resource.ETag, true, deliveryBody(m, 1, 1, false))
			if !errors.Is(err, fulfillment.ErrConfirmationRequired) || before != fulfillmentEffects(t, m) {
				t.Fatal("unconfirmed edit wrote", err)
			}
			started := time.Now().UTC().Truncate(time.Microsecond)
			saved, err := m.drafts.PutDelivery(ctx, m.company, m.recruiter, m.vacancy, resource.ETag, true, deliveryBody(m, 1, 1, true))
			if err != nil || movementObject(t, saved.Body)["fulfilled"] != true {
				t.Fatal(saved, err)
			}
			status := fulfillmentStatus(t, m)
			if status.Delivered != 2 || status.Target != 1 || status.Fulfillment.FulfilledAt.Before(started) || status.Fulfillment.FulfilledAt.Equal(at) || len(status.Fulfillment.Candidates) != 1 || !reflect.DeepEqual(status.Fulfillment.Candidates, preview.Candidates[:1]) {
				t.Fatal(status)
			}
			var configured int
			if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftDeliveryConfigured'`, m.vacancy).Scan(&configured); err != nil || configured != 1 {
				t.Fatal(configured, err)
			}
			assertOneFulfillment(t, m)
		})
	}
}
func TestFulfillmentApplicationIntoNewAndRecovery(t *testing.T) {
	t.Run("intake", func(t *testing.T) {
		m := setupMovement(t)
		fulfillmentConfig(t, m, 0, 2)
		if got := fulfillmentStatus(t, m); got.Delivered != 1 || got.State != "pending" {
			t.Fatal(got)
		}
		second := fulfillmentOther(t, m)
		got := fulfillmentStatus(t, m)
		if got.Delivered != 2 || got.State != "fulfilled" || got.Fulfillment.Candidates[1].ParticipationID != second.ID {
			t.Fatal(got)
		}
		assertOneFulfillment(t, m)
	})
	t.Run("recovery", func(t *testing.T) {
		m := setupMovement(t)
		ctx := context.Background()
		stages := pipelineconfig.Defaults(m.vacancy).Stages
		moved, err := m.move(t, m.item, stages[1].ID, false)
		if err != nil {
			t.Fatal(err)
		}
		discarded, err := m.board.Discard(ctx, m.company, m.recruiter, m.vacancy, moved.ID, moved.ETag, true, []byte(`{"reason":{"group":"candidate","key":"unresponsive"}}`))
		if err != nil {
			t.Fatal(err)
		}
		// A review database may already have historical reaches but no backfill;
		// recovery is its next qualifying event and must fulfill at recovery time.
		fulfillmentConfig(t, m, 1, 1)
		// A value-equal PUT is not a triggering edit and retains cut-3 no-op semantics.
		resource, e := m.drafts.GetDelivery(ctx, m.company, m.recruiter, m.vacancy)
		if e != nil {
			t.Fatal(e)
		}
		before := fulfillmentEffects(t, m)
		noop, e := m.drafts.PutDelivery(ctx, m.company, m.recruiter, m.vacancy, resource.ETag, true, deliveryBody(m, 1, 1, false))
		if e != nil || noop.ETag != resource.ETag || before != fulfillmentEffects(t, m) {
			t.Fatal("no-op recorded fulfillment", e)
		}
		recovered, err := m.board.Recover(ctx, m.company, m.recruiter, m.vacancy, discarded.ID, discarded.ETag, true, []byte(`{}`))
		if err != nil || recovered.Delivery.State != "fulfilled" {
			t.Fatal(recovered, err)
		}
		got := fulfillmentStatus(t, m)
		if !got.Fulfillment.FulfilledAt.Equal(recovered.MovedAt) || !got.Fulfillment.Candidates[0].ReachedAt.Equal(moved.MovedAt) {
			t.Fatal(got)
		}
		assertOneFulfillment(t, m)
	})
}
func TestFulfillmentStatusPreviewAuthorizationAndValidationNoWrites(t *testing.T) {
	m := setupMovement(t)
	readyMovementConfiguration(t, m)
	ctx := context.Background()
	before := fulfillmentEffects(t, m)
	foreign := setupMovement(t)
	for _, id := range []uuid.UUID{uuid.New(), foreign.vacancy} {
		if _, err := m.drafts.GetDeliveryStatus(ctx, m.company, m.recruiter, id); !errors.Is(err, drafts.ErrNotFound) {
			t.Fatal(err)
		}
		if _, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, id, []byte(`broken`)); !errors.Is(err, drafts.ErrNotFound) {
			t.Fatal(err)
		}
	}
	for _, raw := range []string{`{}`, `{"cutoffStageId":null,"targetQuantity":0,"commitmentDate":null}`, strings.Replace(string(deliveryBody(m, 1, 1, false)), `"2020-01-02"`, `"2000-01-01"`, 1), strings.TrimSuffix(string(deliveryBody(m, 1, 1, false)), "}") + `,"confirm_fulfillment":null}`} {
		if _, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, m.vacancy, []byte(raw)); err == nil {
			t.Fatal("invalid preview accepted", raw)
		}
		if before != fulfillmentEffects(t, m) {
			t.Fatal("preview changed state")
		}
	}
	// Use a separate unpublished draft to retain this fixture's real participation.
	id := uuid.New()
	if _, err := m.pool.Exec(ctx, `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, id, m.vacancy); err != nil {
		t.Fatal(err)
	}
	if _, err := m.drafts.GetDeliveryStatus(ctx, m.company, m.recruiter, id); !errors.Is(err, fulfillment.ErrNotPublished) {
		t.Fatal(err)
	}
	if _, err := m.drafts.PreviewDelivery(ctx, m.company, m.recruiter, id, deliveryBody(m, 1, 1, false)); !errors.Is(err, fulfillment.ErrNotPublished) {
		t.Fatal(err)
	}
}

type fulfillmentAuditFailure struct{}

func (fulfillmentAuditFailure) Append(ctx context.Context, tx pgx.Tx, e auditentities.AuditEvent) error {
	if e.EventType == "VacancyDeliveryFulfilled" {
		return errors.New("injected fulfillment audit failure")
	}
	return audit.NewAuditEventRepository().Append(ctx, tx, e)
}
func TestFulfillmentAuditFailureRollsBackTriggerAndSnapshot(t *testing.T) {
	for _, trigger := range []string{"move", "application", "delivery edit", "recovery"} {
		t.Run(trigger, func(t *testing.T) {
			m := setupMovement(t)
			readyMovementConfiguration(t, m)
			ctx := context.Background()
			a := fulfillmentAuditFailure{}
			d := draftstore.NewStore(m.pool, a)
			b := boardstore.NewStore(m.pool, a, movementContext{d}, m.storage, draftjson.Decode)
			var operation func() error
			switch trigger {
			case "move":
				fulfillmentConfig(t, m, 1, 1)
				operation = func() error {
					_, e := b.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+pipelineconfig.Defaults(m.vacancy).Stages[1].ID+`"}`))
					return e
				}
			case "application":
				fulfillmentConfig(t, m, 0, 2)
				cv, e := m.library.Upload(ctx, m.other, "CV", "cv.pdf", []byte("%PDF-1"))
				if e != nil {
					t.Fatal(e)
				}
				s := NewStore(m.pool, a, testVacancyRules{}, d)
				operation = func() error { _, e := s.Apply(ctx, m.other, m.vacancy, uuid.New(), m.request(cv.ID)); return e }
			case "delivery edit":
				resource, e := d.GetDelivery(ctx, m.company, m.recruiter, m.vacancy)
				if e != nil {
					t.Fatal(e)
				}
				operation = func() error {
					_, e := d.PutDelivery(ctx, m.company, m.recruiter, m.vacancy, resource.ETag, true, deliveryBody(m, 0, 1, true))
					return e
				}
			case "recovery":
				discarded, e := m.board.Discard(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"reason":{"group":"candidate","key":"unresponsive"}}`))
				if e != nil {
					t.Fatal(e)
				}
				fulfillmentConfig(t, m, 0, 1)
				operation = func() error {
					_, e := b.Recover(ctx, m.company, m.recruiter, m.vacancy, discarded.ID, discarded.ETag, true, []byte(`{}`))
					return e
				}
			}
			before := fulfillmentEffects(t, m)
			if err := operation(); err == nil || before != fulfillmentEffects(t, m) {
				t.Fatal("trigger escaped audit rollback", err)
			}
		})
	}
}
