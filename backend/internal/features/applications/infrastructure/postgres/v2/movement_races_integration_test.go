//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
)

// Excludes only participation effects: a rejected authoring transaction must
// leave its resources, projection, audit and idempotency exactly unchanged.
func movementAuthoringSnapshot(t *testing.T, m movementFixture) string {
	t.Helper()
	var raw string
	err := m.pool.QueryRow(context.Background(), `SELECT json_build_array(
 (SELECT row_to_json(d) FROM job_drafts d WHERE id=$1),
 (SELECT row_to_json(c) FROM job_draft_pipeline_configs c WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_substate_catalogs c WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_delivery_configs c WHERE draft_id=$1),
 (SELECT row_to_json(c) FROM job_draft_management_configs c WHERE draft_id=$1),
 (SELECT row_to_json(p) FROM vacancy_processes p WHERE id=$1),
 (SELECT row_to_json(p) FROM vacancy_public_projections p WHERE id=$1),
 (SELECT json_agg(i ORDER BY id) FROM job_draft_idempotency i WHERE company_id=$2),
 (SELECT json_agg(a ORDER BY id) FROM audit_events a WHERE entity_id=$1))::text`, m.vacancy, m.company).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestMovementCrossResourceForcedInterleavings(t *testing.T) {
	for _, resource := range []string{"pipeline rename", "pipeline reorder", "delivery", "republish", "published save", "apply", "rejected apply"} {
		for _, first := range []string{"move", "resource"} {
			t.Run(resource+"/"+first+"_first", func(t *testing.T) {
				m := setupMovement(t)
				readyMovementConfiguration(t, m)
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				stages := pipelineconfig.Defaults(m.vacancy).Stages
				// Race an actual hire crossing headcount, not merely an inert board edit.
				for i := 1; i < 4; i++ {
					moved, err := m.move(t, m.item, stages[i].ID, false)
					if err != nil {
						t.Fatal(err)
					}
					m.item = moved.Item
				}
				movePool, movePID := operationPool(t, ctx, m.pool)
				resourcePool, resourcePID := operationPool(t, ctx, m.pool)
				a := audit.NewAuditEventRepository()
				mover := boardstore.NewStore(movePool, a, movementContext{draftstore.NewStore(movePool, a)}, m.storage, draftjson.Decode)
				author := draftstore.NewStore(resourcePool, a)
				intake := NewStore(resourcePool, a, testVacancyRules{})
				draftTag, err := draftversion.FormatETagV2(m.vacancy.String(), 1)
				if err != nil {
					t.Fatal(err)
				}
				c := pipelineconfig.Defaults(m.vacancy)
				if resource == "pipeline rename" {
					c.Stages[1].Name = "Filter"
				}
				if resource == "pipeline reorder" {
					c.Stages[1], c.Stages[2] = c.Stages[2], c.Stages[1]
				}
				pipelineBody := movementPipelineBody(t, c)
				delivery, err := m.drafts.GetDelivery(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil {
					t.Fatal(err)
				}
				var request app.Request
				applyKey := uuid.New()
				if resource == "apply" || resource == "rejected apply" {
					cv, err := m.library.Upload(ctx, m.other, "Other CV", "cv.pdf", []byte("%PDF-1 other"))
					if err != nil {
						t.Fatal(err)
					}
					request = m.request(cv.ID)
					if resource == "rejected apply" {
						request.Revision = "stale-revision"
					}
				}
				var want error
				switch resource {
				case "pipeline reorder":
					want = pipelineconfig.ErrStructureLocked
				case "republish":
					want = publication.ErrAlreadyPublished
				case "rejected apply":
					want = app.ErrQuestionnaireChanged
				}
				resourceOperation := func() error {
					var err error
					switch resource {
					case "pipeline rename", "pipeline reorder":
						_, err = author.PutPipeline(ctx, m.company, m.recruiter, m.vacancy, pipelineconfig.ETag(m.vacancy, 0), true, pipelineBody)
					case "delivery":
						_, err = author.PutDelivery(ctx, m.company, m.recruiter, m.vacancy, delivery.ETag, true, movementDeliveryBody(m))
					case "republish":
						_, err = author.Publish(ctx, m.company, m.recruiter, m.vacancy, uuid.NewString(), true, draftTag, true, []byte(`{}`))
					case "published save":
						_, err = author.SaveV2(ctx, m.company, m.recruiter, m.vacancy, draftTag, true, []byte(`{"fields":{"title":"Updated role"}}`))
					case "apply", "rejected apply":
						_, err = intake.Apply(ctx, m.other, m.vacancy, applyKey, request)
					}
					return err
				}
				before := movementAuthoringSnapshot(t, m)
				blocker, err := m.pool.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer blocker.Rollback(context.Background())
				var blockerPID int
				if err = blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM job_drafts WHERE id=$1 FOR UPDATE`, m.vacancy).Scan(&blockerPID); err != nil {
					t.Fatal(err)
				}
				moved := make(chan error, 1)
				configured := make(chan error, 1)
				startMove := func() {
					go func() {
						_, err := mover.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+stages[4].ID+`"}`))
						moved <- err
					}()
				}
				startResource := func() { go func() { configured <- resourceOperation() }() }
				if first == "move" {
					startMove()
					waitBlockedBy(t, ctx, m.pool, movePID, blockerPID)
					startResource()
					waitBlockedBy(t, ctx, m.pool, resourcePID, movePID)
				} else {
					startResource()
					waitBlockedBy(t, ctx, m.pool, resourcePID, blockerPID)
					startMove()
					waitBlockedBy(t, ctx, m.pool, movePID, resourcePID)
				}
				if err = blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				await := func(ch <-chan error) error {
					t.Helper()
					select {
					case err := <-ch:
						return err
					case <-ctx.Done():
						t.Fatal("possible deadlock: operations did not finish within 15s")
						return ctx.Err()
					}
				}
				if err = await(moved); err != nil {
					t.Fatal("hire failed", err)
				}
				if err = await(configured); !errors.Is(err, want) {
					t.Fatalf("resource error = %v, want %v", err, want)
				}
				if want != nil && movementAuthoringSnapshot(t, m) != before {
					t.Fatal("rejected side left authoring effects")
				}
				view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
				count := 1
				if resource == "apply" {
					count = 2
				}
				if err != nil || len(view.Participations) != count || view.Coverage.Covered != 1 || view.Coverage.Required == nil || *view.Coverage.Required != 1 || view.Coverage.FullCoverageReachedAt == nil {
					t.Fatal(view, err)
				}
				var hires, audits, milestones, idempotency int
				if err = m.pool.QueryRow(ctx, `SELECT
     (SELECT count(*) FROM participation_stage_history WHERE participation_id=$1 AND hire),
     (SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationMoved'),
     (SELECT count(*) FROM process_coverage_milestones WHERE process_id=$2 AND covered=1 AND required=1),
     (SELECT count(*) FROM participation_idempotency WHERE process_id=$2 AND idem_key=$3)`, m.item.ID, m.vacancy, applyKey).Scan(&hires, &audits, &milestones, &idempotency); err != nil || hires != 1 || audits != 4 || milestones != 1 {
					t.Fatal(hires, audits, milestones, err)
				}
				if idempotency != count-1 {
					t.Fatal("rejected apply left idempotency, or successful apply lost it", idempotency)
				}
				history, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
				if err != nil || len(history.Items) != 5 || !history.Items[4].Hire || history.Items[4].Departure || history.Items[4].ToStageID != stages[4].ID || history.Items[4].FromStageID == nil || *history.Items[4].FromStageID != stages[3].ID {
					t.Fatal(history, err)
				}
				detail, err := m.board.Detail(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
				if err != nil || detail.Version != "5" || detail.ETag != board.ETag(m.item.ID, 5) || detail.StageID != stages[4].ID {
					t.Fatal(detail, err)
				}
				pipeline, err := m.drafts.GetPipeline(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil {
					t.Fatal(err)
				}
				obj := movementObject(t, pipeline.Body)
				if obj["structure_locked"] != true {
					t.Fatal("intake/move lost structure lock")
				}
				var persisted pipelineconfig.Configuration
				if err = json.Unmarshal(pipeline.Body, &persisted); err != nil {
					t.Fatal(err)
				}
				if resource == "pipeline reorder" {
					c = pipelineconfig.Defaults(m.vacancy)
				}
				if !reflect.DeepEqual(persisted, c) {
					t.Fatal("pipeline order/name drift", persisted, c)
				}
				expectedPipelineVersion := "0"
				if resource == "pipeline rename" {
					expectedPipelineVersion = "1"
				}
				if obj["version"] != expectedPipelineVersion {
					t.Fatal(obj)
				}
				deliveryAfter, err := m.drafts.GetDelivery(ctx, m.company, m.recruiter, m.vacancy)
				if err != nil {
					t.Fatal(err)
				}
				if resource == "delivery" {
					obj := movementObject(t, deliveryAfter.Body)
					if obj["version"] != "2" || obj["targetQuantity"] != float64(2) || obj["cutoffStageId"] != stages[2].ID {
						t.Fatal(obj)
					}
				} else if !reflect.DeepEqual(deliveryAfter, delivery) {
					t.Fatal("move changed delivery")
				}
				var draftVersion, projectionVersion int64
				var title string
				if err = m.pool.QueryRow(ctx, `SELECT d.version,p.source_draft_version,p.title FROM job_drafts d JOIN vacancy_public_projections p ON p.id=d.id WHERE d.id=$1`, m.vacancy).Scan(&draftVersion, &projectionVersion, &title); err != nil {
					t.Fatal(err)
				}
				expectedDraftVersion := int64(1)
				expectedTitle := "Engineer"
				if resource == "published save" {
					expectedDraftVersion, expectedTitle = 2, "Updated role"
				}
				if draftVersion != expectedDraftVersion || projectionVersion != expectedDraftVersion || title != expectedTitle {
					t.Fatal("draft/projection incoherent", draftVersion, projectionVersion, title)
				}
				if resource == "apply" {
					var other board.Item
					for _, item := range view.Participations {
						if item.ID != m.item.ID {
							other = item
						}
					}
					h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, other.ID)
					if err != nil || len(h.Items) != 1 || h.Items[0].Kind != "intake" || other.Version != "1" || other.StageID != stages[0].ID {
						t.Fatal("concurrent intake incoherent", other, h, err)
					}
				}
			})
		}
	}
}
