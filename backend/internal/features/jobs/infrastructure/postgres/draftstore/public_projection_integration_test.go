//go:build integration

package draftstore

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func publicProjectionSnapshot(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) string {
	t.Helper()
	var out string
	if err := pool.QueryRow(context.Background(), `SELECT COALESCE((SELECT row_to_json(p)::text FROM vacancy_public_projections p WHERE id=$1),'absent')`, id).Scan(&out); err != nil {
		t.Fatal(err)
	}
	return out
}
func TestPublicProjectionPublicationSaveGuardAndRollback(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	id := draftIDOf(t, draft)
	ctx := context.Background()
	if got := publicProjectionSnapshot(t, pool, id); got != "absent" {
		t.Fatal(got)
	}
	failingPublish := NewStore(pool, failingAudit{})
	failingPublish.clock = fixedDeliveryClock
	initial := publicationSnapshot(t, pool, id)
	if _, err := failingPublish.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`)); err == nil {
		t.Fatal("publication audit failure ignored")
	}
	if initial != publicationSnapshot(t, pool, id) || publicProjectionSnapshot(t, pool, id) != "absent" {
		t.Fatal("failed publication persisted projection/process/idempotency/audit")
	}
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	before := publicProjectionSnapshot(t, pool, id)
	if before == "absent" {
		t.Fatal("publication omitted projection")
	}
	// All three guarded resources reject missing requirements and commit nothing.
	for _, tc := range []struct {
		name, body string
		save       func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (drafts.Result, error)
		read       func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error)
		codes      []string
	}{
		{"draft", `{"fields":{"title":null,"requester":null}}`, s.SaveV2, s.GetV2, []string{"title_missing", "requester_missing"}},
		{"description", `{"fields":{"description":null}}`, s.SaveV2, s.GetV2, []string{"description_missing"}},
		{"remote scope", `{"fields":{"remote_scope":null}}`, s.SaveV2, s.GetV2, []string{"remote_scope_missing"}},
		{"work mode", `{"fields":{"work_mode":null}}`, s.SaveV2, s.GetV2, []string{"work_mode_missing"}},
		{"schedule", `{"fields":{"work_schedule":null}}`, s.SaveV2, s.GetV2, []string{"work_schedule_missing"}},
		{"contract", `{"fields":{"contract_type":null}}`, s.SaveV2, s.GetV2, []string{"contract_type_missing"}},
		{"area", `{"fields":{"professional_area":null}}`, s.SaveV2, s.GetV2, []string{"professional_area_missing"}},
		{"delivery", nullDelivery, s.PutDelivery, s.GetDelivery, []string{"delivery_cutoff_missing", "delivery_target_missing", "commitment_date_missing"}},
		{"management", `{"requestDate":null,"hiringHeadcount":null}`, s.PutManagement, s.GetManagement, []string{"request_date_missing", "hiring_headcount_missing"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			current, err := tc.read(ctx, p.companyID, p.ownerID, id)
			if err != nil {
				t.Fatal(err)
			}
			snapshot := publicationSnapshot(t, pool, id)
			projection := publicProjectionSnapshot(t, pool, id)
			result, err := tc.save(ctx, p.companyID, p.ownerID, id, current.ETag, true, []byte(tc.body))
			var incomplete *publication.Incomplete
			if !errors.As(err, &incomplete) || !reflect.DeepEqual(incomplete.Missing, tc.codes) || !reflect.DeepEqual(result, drafts.Result{}) {
				t.Fatalf("result=%+v error=%v", result, err)
			}
			if snapshot != publicationSnapshot(t, pool, id) || projection != publicProjectionSnapshot(t, pool, id) {
				t.Fatal("rejected write changed state")
			}
		})
	}
	// Past commitment alone is exempt. The projection has the exact source version.
	s.clock = func() time.Time { return fixedDeliveryClock().Add(24 * time.Hour) }
	saved, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, draft.ETag, true, []byte(`{"fields":{"title":"Updated public title","skills":["SQL","Go"],"screening_questions":[{"id":"1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d","type":"open","prompt":"Why?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	var title string
	var version, draftVersion int64
	var publishedAt time.Time
	var skills []string
	var questions int
	if err := pool.QueryRow(ctx, `SELECT p.title,p.source_draft_version,d.version,p.published_at,p.skills,p.screening_questions FROM vacancy_public_projections p JOIN job_drafts d USING(id) WHERE p.id=$1`, id).Scan(&title, &version, &draftVersion, &publishedAt, &skills, &questions); err != nil {
		t.Fatal(err)
	}
	if title != "Updated public title" || version != draftVersion || !publishedAt.Equal(fixedDeliveryClock()) || !reflect.DeepEqual(skills, []string{"SQL", "Go"}) || questions != 1 {
		t.Fatal("stale projection")
	}
	// Audit failure after a published save must roll back BOTH draft and projection.
	failing := NewStore(pool, failingAudit{})
	failing.clock = s.clock
	snapshot := publicationSnapshot(t, pool, id)
	projection := publicProjectionSnapshot(t, pool, id)
	if _, err := failing.SaveV2(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"fields":{"title":"Must roll back","skills":[],"screening_questions":[]}}`)); err == nil {
		t.Fatal("audit failure ignored")
	}
	if snapshot != publicationSnapshot(t, pool, id) || projection != publicProjectionSnapshot(t, pool, id) {
		t.Fatal("save/projection/audit not atomic")
	}
}

func TestPublicProjectionPublishedBeforeP2MaterializesOnNoopSave(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	id := draftIDOf(t, draft)
	ctx := context.Background()
	// Simulate a P1 process without a projection; never delete a row to do so.
	if _, err := pool.Exec(ctx, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',$3,$4)`, id, p.companyID, fixedDeliveryClock(), p.ownerID); err != nil {
		t.Fatal(err)
	}
	snapshot := publicationSnapshot(t, pool, id)
	fields := envelopeOf(t, draft.Body)["fields"].(map[string]any)
	noop := mustCanonical(t, map[string]any{"fields": map[string]any{"title": fields["title"]}})
	result, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, draft.ETag, true, noop)
	if err != nil {
		t.Fatal(err)
	}
	if result.ETag != draft.ETag || snapshot != publicationSnapshot(t, pool, id) || publicProjectionSnapshot(t, pool, id) == "absent" {
		t.Fatal("no-op save failed to materialize only projection")
	}
}
