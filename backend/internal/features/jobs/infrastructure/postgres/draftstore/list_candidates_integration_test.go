//go:build integration

package draftstore

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type listQueryCounter struct{ total, aggregates int }

func (q *listQueryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	q.total++
	if strings.Contains(data.SQL, "FROM process_participations") {
		q.aggregates++
	}
	return ctx
}
func (*listQueryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func TestListV2_CandidatesAndRequesterUseOnePageQuery(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	requester := insertRequester(t, pool, p.companyID, "client", "List client")
	doc := envelopeOf(t, []byte(readV2Document))
	doc["fields"].(map[string]any)["requester"] = map[string]any{"kind": "client", "id": requester.String()}
	body := mustCanonical(t, doc)
	at := time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)
	paused, closed, finished := at.Add(time.Hour), at.Add(2*time.Hour), at.Add(3*time.Hour)
	for i := 0; i < 51; i++ {
		id := uuid.New()
		seedListV2(t, pool, p, p.ownerID, id, at.Add(-time.Duration(i)*time.Second), body)
		// Published again, with retained lifecycle dates, an unmaterialized
		// pipeline and no participations. Dates must add no per-item lookups.
		if _, err := pool.Exec(context.Background(), `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by,paused_at,closed_at,process_finished_at) VALUES($1,$2,'published',$4,$3,$5,$6,$7)`, id, p.companyID, p.ownerID, at, paused, closed, finished); err != nil {
			t.Fatal(err)
		}
	}
	counter := &listQueryCounter{}
	config := pool.Config()
	config.ConnConfig.Tracer = counter
	traced, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(traced.Close)
	store := newStore(t, traced)
	previousQueries := 0
	for _, limit := range []int{1, 50} {
		counter.total, counter.aggregates = 0, 0
		page := listV2Page(t, store, p, p.ownerID, draftlist.Request{Limit: limit})
		if len(page.Items) != limit || page.NextCursor == "" {
			t.Fatalf("page length=%d cursor=%q", len(page.Items), page.NextCursor)
		}
		for _, item := range page.Items {
			if item.Requester == nil || item.Requester.Name == nil || *item.Requester.Name != "List client" {
				t.Fatal("requester projection changed", item)
			}
			if item.PublishedAt == nil || !item.PublishedAt.Equal(at) || item.PausedAt == nil || !item.PausedAt.Equal(paused) || item.ClosedAt == nil || !item.ClosedAt.Equal(closed) || item.ProcessFinishedAt == nil || !item.ProcessFinishedAt.Equal(finished) {
				t.Fatalf("lifecycle date projection changed: %+v", item)
			}
			if item.Candidates == nil || item.Candidates.Total != 0 || item.Candidates.InProcess != 0 || item.Candidates.Discarded != 0 || len(item.Candidates.ByStage) != 5 {
				t.Fatalf("published empty summary=%+v", item.Candidates)
			}
		}
		if counter.aggregates != 1 {
			t.Fatalf("candidate aggregation statements=%d want 1", counter.aggregates)
		}
		// BEGIN + three live gates + one page SELECT + COMMIT, independent of size.
		if counter.total != 6 {
			t.Fatalf("statements=%d want 6 (no per-item lookups)", counter.total)
		}
		if previousQueries != 0 && counter.total != previousQueries {
			t.Fatal("page query count grew with item count")
		}
		previousQueries = counter.total
	}
}
