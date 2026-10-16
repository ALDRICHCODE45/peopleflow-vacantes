//go:build integration

package draftstore

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
)

func TestManagementAuditFailureOnFirstPutAndUnchangedStoredFutureDate(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, draft)
	failing := NewStore(pool, failingAudit{})
	failing.clock = fixedDeliveryClock
	before := publicationSnapshot(t, pool, id)
	got, err := failing.PutManagement(ctx, p.companyID, p.ownerID, id, vacancymanagement.ETag(id, 0), true, []byte(nullManagement))
	if err == nil || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatal("first audit failure wrote configuration")
	}
	saved, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, vacancymanagement.ETag(id, 0), true, []byte(`{"requestDate":"2026-10-16","hiringHeadcount":1}`))
	if err != nil {
		t.Fatal(err)
	}
	s.clock = func() time.Time { return fixedDeliveryClock().Add(-24 * time.Hour) }
	changed, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"requestDate":"2026-10-16","hiringHeadcount":2}`))
	if err != nil || changed.ETag != vacancymanagement.ETag(id, 2) {
		t.Fatalf("unchanged future value must be accepted: %+v %v", changed, err)
	}
}
func TestManagementConcurrentFirstPutsHaveOneWinner(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, draft)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, vacancymanagement.ETag(id, 0), true, []byte(nullManagement))
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	wins, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, drafts.ErrVersionConflict):
			conflicts++
		default:
			t.Fatal(err)
		}
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM job_draft_management_configs WHERE draft_id=$1 AND version=1`, id).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 || wins != 1 || conflicts != 1 || auditCount(t, pool, id, managementConfiguredEvent) != 1 {
		t.Fatalf("rows=%d wins=%d conflicts=%d", rows, wins, conflicts)
	}
}
func TestManagementLiveGatesCorruptionAndOverflowFailClosed(t *testing.T) {
	pool := requireDraftPool(t)
	for _, tc := range []struct {
		name, mutate string
		want         error
	}{
		{"deleted user", `UPDATE users SET deleted_at=now() WHERE id=$1`, drafts.ErrUnauthenticated}, {"membership", `DELETE FROM company_members WHERE user_id=$1`, drafts.ErrForbidden}, {"suspended company", `UPDATE companies SET status='suspended' WHERE id=$1`, drafts.ErrCompanyNotActive}, {"tombstoned company", `UPDATE companies SET deleted_at=now() WHERE id=$1`, drafts.ErrCompanyInactive}, {"infinite date", `UPDATE job_draft_management_configs SET request_date='infinity'::date WHERE draft_id=$1`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, p, draft := createV2Draft(t, pool)
			s.clock = fixedDeliveryClock
			ctx := context.Background()
			id := draftIDOf(t, draft)
			saved, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, vacancymanagement.ETag(id, 0), true, []byte(nullManagement))
			if err != nil {
				t.Fatal(err)
			}
			target := id
			switch tc.name {
			case "deleted user", "membership":
				target = p.ownerID
			case "suspended company", "tombstoned company":
				target = p.companyID
			}
			if _, err := pool.Exec(ctx, tc.mutate, target); err != nil {
				t.Fatal(err)
			}
			before := publicationSnapshot(t, pool, id)
			for _, write := range []bool{false, true} {
				var got drafts.Result
				if write {
					got, err = s.PutManagement(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(nullManagement))
				} else {
					got, err = s.GetManagement(ctx, p.companyID, p.ownerID, id)
				}
				if err == nil || tc.want != nil && !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
					t.Fatalf("write=%v got=%+v err=%v", write, got, err)
				}
			}
		})
	}
	t.Run("overflow", func(t *testing.T) {
		s, p, draft := createV2Draft(t, pool)
		s.clock = fixedDeliveryClock
		ctx := context.Background()
		id := draftIDOf(t, draft)
		if _, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, vacancymanagement.ETag(id, 0), true, []byte(nullManagement)); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE job_draft_management_configs SET version=9223372036854775807 WHERE draft_id=$1`, id); err != nil {
			t.Fatal(err)
		}
		get, err := s.GetManagement(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
		before := publicationSnapshot(t, pool, id)
		got, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, get.ETag, true, []byte(`{"requestDate":null,"hiringHeadcount":1}`))
		if !errors.Is(err, drafts.ErrVersionOverflow) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
			t.Fatalf("overflow=%+v %v", got, err)
		}
	})
}
