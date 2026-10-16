//go:build integration

package draftstore

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
)

func TestSubstates_AuditFailureRollsBackFirstAndLaterPuts(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	id := draftIDOf(t, created)
	ctx := context.Background()
	failing := NewStore(pool, failingAudit{})
	for _, phase := range []string{"first PUT", "later PUT"} {
		t.Run(phase, func(t *testing.T) {
			get, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
			if err != nil {
				t.Fatal(err)
			}
			body := []byte(`{"substates":[{"name":"Failure ` + phase + `"}]}`)
			before := substateSnapshot(t, pool, id)
			got, err := failing.PutSubstates(ctx, p.companyID, p.ownerID, id, get.ETag, true, body)
			if err == nil || !reflect.DeepEqual(got, drafts.Result{}) || before != substateSnapshot(t, pool, id) {
				t.Fatalf("failed audit did not roll back: %+v %v", got, err)
			}
			if _, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, get.ETag, true, body); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSubstates_LiveGatesCorruptionAndOverflowFailClosed(t *testing.T) {
	pool := requireDraftPool(t)
	cases := []struct {
		name, mutate string
		want         error
	}{
		{"deleted user", `UPDATE users SET deleted_at=now() WHERE id=$1`, drafts.ErrUnauthenticated},
		{"revoked membership", `DELETE FROM company_members WHERE user_id=$1`, drafts.ErrForbidden},
		{"suspended company", `UPDATE companies SET status='suspended' WHERE id=$1`, drafts.ErrCompanyNotActive},
		{"tombstoned company", `UPDATE companies SET deleted_at=now() WHERE id=$1`, drafts.ErrCompanyInactive},
		{"corrupt JSON", `UPDATE job_draft_substate_catalogs SET catalog='broken'::bytea WHERE draft_id=$1`, nil},
		{"null catalog", `UPDATE job_draft_substate_catalogs SET catalog='{"substates":null}'::bytea WHERE draft_id=$1`, nil},
		{"corrupt entries", `UPDATE job_draft_substate_catalogs SET catalog='{"substates":[{"id":"bad","name":"Uno"}]}'::bytea WHERE draft_id=$1`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, p, created := createV2Draft(t, pool)
			id := draftIDOf(t, created)
			ctx := context.Background()
			saved, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, substatecatalog.ETag(id, 0), true, []byte(`{"substates":[]}`))
			if err != nil {
				t.Fatal(err)
			}
			target := id
			switch tc.name {
			case "deleted user", "revoked membership":
				target = p.ownerID
			case "suspended company", "tombstoned company":
				target = p.companyID
			}
			if _, err := pool.Exec(ctx, tc.mutate, target); err != nil {
				t.Fatal(err)
			}
			before := substateSnapshot(t, pool, id)
			for _, write := range []bool{false, true} {
				var got drafts.Result
				if write {
					got, err = s.PutSubstates(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"substates":[]}`))
				} else {
					got, err = s.GetSubstates(ctx, p.companyID, p.ownerID, id)
				}
				if err == nil || (tc.want != nil && !errors.Is(err, tc.want)) || !reflect.DeepEqual(got, drafts.Result{}) || before != substateSnapshot(t, pool, id) {
					t.Fatalf("gate write=%v returned data or changed state: %+v %v", write, got, err)
				}
			}
		})
	}
	t.Run("version overflow", func(t *testing.T) {
		s, p, created := createV2Draft(t, pool)
		id := draftIDOf(t, created)
		ctx := context.Background()
		if _, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, substatecatalog.ETag(id, 0), true, []byte(`{"substates":[]}`)); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE job_draft_substate_catalogs SET version=9223372036854775807 WHERE draft_id=$1`, id); err != nil {
			t.Fatal(err)
		}
		get, err := s.GetSubstates(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
		before := substateSnapshot(t, pool, id)
		got, err := s.PutSubstates(ctx, p.companyID, p.ownerID, id, get.ETag, true, []byte(`{"substates":[{"name":"Cambio"}]}`))
		if !errors.Is(err, drafts.ErrVersionOverflow) || !reflect.DeepEqual(got, drafts.Result{}) || before != substateSnapshot(t, pool, id) {
			t.Fatalf("overflow=%+v %v", got, err)
		}
	})
}
