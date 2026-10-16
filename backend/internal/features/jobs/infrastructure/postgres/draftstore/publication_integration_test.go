//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func readyPublication(t *testing.T, pool *pgxpool.Pool) (*Store, principal, drafts.Result) {
	t.Helper()
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, created)
	requester := insertRequester(t, pool, p.companyID, "internal_area", "Engineering")
	patch := []byte(`{"fields":{"requester":{"kind":"internal_area","id":"` + requester.String() + `"}}}`)
	saved, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, created.ETag, true, patch)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, vacancymanagement.ETag(id, 0), true, []byte(`{"requestDate":"2026-10-11","hiringHeadcount":2}`)); err != nil {
		t.Fatal(err)
	}
	cutoff := pipelineconfig.Defaults(id).Stages[3].ID
	target := int64(5)
	date := "2026-10-16"
	if _, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, deliveryBody(t, deliveryconfig.Configuration{CutoffStageID: &cutoff, TargetQuantity: &target, CommitmentDate: &date})); err != nil {
		t.Fatal(err)
	}
	return s, p, saved
}
func TestPublicationPureReadPublishReplayFrozenAuditAndVersions(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	ctx := context.Background()
	id := draftIDOf(t, draft)
	before := publicationSnapshot(t, pool, id)
	ready, err := s.GetPublication(ctx, p.companyID, p.ownerID, id)
	if err != nil || string(ready.Body) != `{"status":"draft","publishedAt":null,"missing":[]}` || ready.ETag != "" || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("readiness=%s %v", ready.Body, err)
	}
	reads := []func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (drafts.Result, error){s.GetV2, s.GetPipeline, s.GetSubstates, s.GetDelivery, s.GetManagement}
	originals := make([]drafts.Result, len(reads))
	for i, read := range reads {
		originals[i], err = read(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
	}
	key := uuid.NewString()
	published, err := s.Publish(ctx, p.companyID, p.ownerID, id, key, true, draft.ETag, true, []byte(`{}`))
	if err != nil || published.Replayed || published.ETag != draft.ETag {
		t.Fatalf("publish=%+v %v", published, err)
	}
	var result map[string]any
	if err := json.Unmarshal(published.Body, &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 3 || result["id"] != id.String() || result["status"] != "published" || result["publishedAt"] != "2026-10-16T18:00:00.000000Z" {
		t.Fatalf("body=%s", published.Body)
	}
	for i, read := range reads {
		after, err := read(ctx, p.companyID, p.ownerID, id)
		if err != nil || !reflect.DeepEqual(after, originals[i]) {
			t.Fatalf("publish changed resource %d: %v", i, err)
		}
	}
	var actor uuid.UUID
	var at time.Time
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT published_by,published_at FROM vacancy_processes WHERE id=$1 AND company_id=$2 AND status='published'`, id, p.companyID).Scan(&actor, &at); err != nil || actor != p.ownerID || !at.Equal(fixedDeliveryClock()) {
		t.Fatalf("process: %s %s %v", actor, at, err)
	}
	if err := pool.QueryRow(ctx, `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]string
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	var snapshot map[string]any
	if err := json.Unmarshal([]byte(metadata["snapshot"]), &snapshot); err != nil {
		t.Fatal(err)
	}
	want := map[string]any{"targetQuantity": float64(5), "cutoffStageId": pipelineconfig.Defaults(id).Stages[3].ID, "cutoffStageName": "En proceso", "commitmentDate": "2026-10-16", "hiringHeadcount": float64(2), "requestDate": "2026-10-11"}
	if metadata["publishedAt"] != result["publishedAt"] || !reflect.DeepEqual(snapshot, want) || auditCount(t, pool, id, vacancyPublishedEvent) != 1 {
		t.Fatalf("audit=%s", raw)
	}
	// Content/configuration remain editable. An already-published readiness read
	// suppresses missing requirements; replay retains original body and draft tag.
	if _, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, draft.ETag, true, []byte(`{"fields":{"title":null}}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, originals[3].ETag, true, []byte(nullDelivery)); err != nil {
		t.Fatal(err)
	}
	before = publicationSnapshot(t, pool, id)
	replay, err := s.Publish(ctx, p.companyID, p.ownerID, id, strings.ToUpper(key), true, "", false, []byte(" { } \n"))
	if err != nil || !replay.Replayed || replay.ETag != published.ETag || !bytes.Equal(replay.Body, published.Body) || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("replay=%+v %v", replay, err)
	}
	got, err := s.GetPublication(ctx, p.companyID, p.ownerID, id)
	if err != nil || string(got.Body) != `{"status":"published","publishedAt":"2026-10-16T18:00:00.000000Z","missing":[]}` || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("published readiness=%s %v", got.Body, err)
	}
}
func TestPublicationOrderRejectionsAndAuditFailureAreAtomic(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	id := draftIDOf(t, draft)
	ctx := context.Background()
	key := uuid.NewString()
	nonprincipal := addMember(t, pool, p.companyID, "recruiter")
	foreign := newPrincipal(t, pool)
	for _, tc := range []struct {
		name, key, tag, body string
		keyPresent, present  bool
		want                 error
	}{
		{"missing key", "", draft.ETag, `{}`, false, true, drafts.ErrIdempotencyKeyRequired}, {"empty key", "", draft.ETag, `{}`, true, true, drafts.ErrInvalidIdempotencyKey}, {"bad key", "bad", "", `{}`, true, false, drafts.ErrInvalidIdempotencyKey},
		{"missing precondition", key, "", `{}`, true, false, drafts.ErrPreconditionRequired}, {"weak", key, `W/"x"`, `{}`, true, true, drafts.ErrInvalidRequest}, {"stale", key, ifMatchV2For(t, id, 1), `{}`, true, true, drafts.ErrVersionConflict},
		{"precondition before body", key, "", `{"extra":1}`, true, false, drafts.ErrPreconditionRequired},
		{"precondition before malformed JSON", key, "", `{`, true, false, drafts.ErrPreconditionRequired},
		{"not empty object", key, draft.ETag, `{"extra":1}`, true, true, drafts.ErrInvalidRequest}, {"null", key, draft.ETag, `null`, true, true, drafts.ErrInvalidRequest}, {"duplicate", key, draft.ETag, `{"x":1,"x":1}`, true, true, drafts.ErrInvalidRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationSnapshot(t, pool, id)
			got, err := s.Publish(ctx, p.companyID, p.ownerID, id, tc.key, tc.keyPresent, tc.tag, tc.present, []byte(tc.body))
			if !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
				t.Fatalf("got=%+v err=%v want=%v", got, err, tc.want)
			}
		})
	}
	for _, caller := range []struct{ company, actor, id uuid.UUID }{{p.companyID, nonprincipal, id}, {foreign.companyID, foreign.ownerID, id}, {p.companyID, p.ownerID, uuid.New()}} {
		before := publicationSnapshot(t, pool, id)
		got, err := s.Publish(ctx, caller.company, caller.actor, caller.id, "", false, "", false, []byte(`bad`))
		if !errors.Is(err, drafts.ErrNotFound) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
			t.Fatalf("authorization=%+v %v", got, err)
		}
	}
	failing := NewStore(pool, failingAudit{})
	failing.clock = fixedDeliveryClock
	before := publicationSnapshot(t, pool, id)
	got, err := failing.Publish(ctx, p.companyID, p.ownerID, id, key, true, draft.ETag, true, []byte(`{}`))
	if err == nil || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatal("audit failure persisted process/idempotency")
	}
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, key, true, draft.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, key, tag, body string
		present              bool
		want                 error
	}{
		{"conflict before precondition", key, "", `{"extra":1}`, false, drafts.ErrIdempotencyConflict},
		{"precondition before already", uuid.NewString(), "", `{}`, false, drafts.ErrPreconditionRequired},
		{"stale before already", uuid.NewString(), ifMatchV2For(t, id, 1), `{}`, true, drafts.ErrVersionConflict},
		{"already", uuid.NewString(), draft.ETag, `{}`, true, publication.ErrAlreadyPublished},
		{"already before body", uuid.NewString(), draft.ETag, `{"extra":1}`, true, publication.ErrAlreadyPublished},
		{"already before malformed JSON", uuid.NewString(), draft.ETag, `{`, true, publication.ErrAlreadyPublished},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationSnapshot(t, pool, id)
			got, err := s.Publish(ctx, p.companyID, p.ownerID, id, tc.key, true, tc.tag, tc.present, []byte(tc.body))
			if !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
				t.Fatalf("%+v %v want %v", got, err, tc.want)
			}
		})
	}
}
func TestPublicationIncompleteAndPastCommitmentNeverWrite(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, draft)
	before := publicationSnapshot(t, pool, id)
	read, err := s.GetPublication(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`))
	var incomplete *publication.Incomplete
	if !errors.As(err, &incomplete) || !reflect.DeepEqual(incomplete.Missing, []string{"requester_missing", "request_date_missing", "hiring_headcount_missing", "delivery_cutoff_missing", "delivery_target_missing", "commitment_date_missing"}) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("read=%s incomplete=%+v err=%v", read.Body, incomplete, err)
	}
	s, p, draft = readyPublication(t, pool)
	id = draftIDOf(t, draft)
	s.clock = func() time.Time { return fixedDeliveryClock().Add(24 * time.Hour) }
	before = publicationSnapshot(t, pool, id)
	got, err = s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`))
	if !errors.As(err, &incomplete) || !reflect.DeepEqual(incomplete.Missing, []string{"commitment_date_past"}) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("past=%+v %v", incomplete, err)
	}
}
func TestPublicationConcurrentPublishExactlyOneProcess(t *testing.T) {
	pool := requireDraftPool(t)
	for _, sameKey := range []bool{false, true} {
		t.Run(map[bool]string{false: "distinct keys", true: "same key"}[sameKey], func(t *testing.T) {
			s, p, draft := readyPublication(t, pool)
			ctx := context.Background()
			id := draftIDOf(t, draft)
			key := uuid.NewString()
			start := make(chan struct{})
			var wg sync.WaitGroup
			results := make(chan error, 2)
			replays := make(chan bool, 2)
			for range 2 {
				k := key
				if !sameKey {
					k = uuid.NewString()
				}
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					got, err := s.Publish(ctx, p.companyID, p.ownerID, id, k, true, draft.ETag, true, []byte(`{}`))
					results <- err
					replays <- got.Replayed
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			close(replays)
			wins, conflicts, replayed := 0, 0, 0
			for err := range results {
				if err == nil {
					wins++
				} else if errors.Is(err, publication.ErrAlreadyPublished) {
					conflicts++
				} else {
					t.Fatal(err)
				}
			}
			for r := range replays {
				if r {
					replayed++
				}
			}
			var count int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM vacancy_processes WHERE id=$1`, id).Scan(&count); err != nil {
				t.Fatal(err)
			}
			var idempotencyRows int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1 AND operation=$2`, p.companyID, publishOperation).Scan(&idempotencyRows); err != nil {
				t.Fatal(err)
			}
			if count != 1 || idempotencyRows != 1 || auditCount(t, pool, id, vacancyPublishedEvent) != 1 || sameKey && (wins != 2 || replayed != 1) || !sameKey && (wins != 1 || conflicts != 1) {
				t.Fatalf("rows=%d idempotency=%d wins=%d conflicts=%d replays=%d", count, idempotencyRows, wins, conflicts, replayed)
			}
		})
	}
}
func TestPublicationDeliveryRaceRevalidatesFrozenSnapshot(t *testing.T) {
	pool := requireDraftPool(t)
	for _, mode := range []string{"missing", "past"} {
		t.Run(mode, func(t *testing.T) {
			for range 10 {
				s, p, draft := readyPublication(t, pool)
				id := draftIDOf(t, draft)
				ctx := context.Background()
				writer := newStore(t, pool)
				writer.clock = func() time.Time { return fixedDeliveryClock().Add(-24 * time.Hour) }
				body := []byte(nullDelivery)
				if mode == "past" {
					cutoff := pipelineconfig.Defaults(id).Stages[3].ID
					quantity := int64(5)
					date := "2026-10-15"
					body = deliveryBody(t, deliveryconfig.Configuration{CutoffStageID: &cutoff, TargetQuantity: &quantity, CommitmentDate: &date})
				}
				start := make(chan struct{})
				var publishErr, deliveryErr error
				var wg sync.WaitGroup
				wg.Add(2)
				go func() {
					defer wg.Done()
					<-start
					_, publishErr = s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`))
				}()
				go func() {
					defer wg.Done()
					<-start
					_, deliveryErr = writer.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 1), true, body)
				}()
				close(start)
				wg.Wait()
				if deliveryErr != nil {
					t.Fatal(deliveryErr)
				}
				var count int
				if err := pool.QueryRow(ctx, `SELECT count(*) FROM vacancy_processes WHERE id=$1`, id).Scan(&count); err != nil {
					t.Fatal(err)
				}
				var idempotencyRows int
				if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1 AND operation=$2`, p.companyID, publishOperation).Scan(&idempotencyRows); err != nil {
					t.Fatal(err)
				}
				var incomplete *publication.Incomplete
				if publishErr == nil {
					var raw []byte
					if count != 1 || idempotencyRows != 1 {
						t.Fatal("missing process")
					}
					if err := pool.QueryRow(ctx, `SELECT metadata FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id).Scan(&raw); err != nil {
						t.Fatal(err)
					}
					var metadata map[string]string
					_ = json.Unmarshal(raw, &metadata)
					var snap map[string]any
					_ = json.Unmarshal([]byte(metadata["snapshot"]), &snap)
					if snap["commitmentDate"] != "2026-10-16" || snap["targetQuantity"] != float64(5) || snap["cutoffStageId"] != pipelineconfig.Defaults(id).Stages[3].ID {
						t.Fatalf("invalid publication snapshot=%s", raw)
					}
				} else if !errors.As(publishErr, &incomplete) || count != 0 || idempotencyRows != 0 || auditCount(t, pool, id, vacancyPublishedEvent) != 0 {
					t.Fatalf("race=%v rows=%d", publishErr, count)
				}
			}
		})
	}
}
