//go:build integration

package draftstore

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

func TestDelivery_AuditFailureRollsBackFirstAndLaterPuts(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	id := draftIDOf(t, created)
	ctx := context.Background()
	failing := NewStore(pool, failingAudit{})
	failing.clock = fixedDeliveryClock
	for i, phase := range []string{"first PUT", "later PUT"} {
		t.Run(phase, func(t *testing.T) {
			get, err := s.GetDelivery(ctx, p.companyID, p.ownerID, id)
			if err != nil {
				t.Fatal(err)
			}
			target := int64(i + 1)
			body := deliveryBody(t, deliveryconfig.Configuration{TargetQuantity: &target})
			before := deliverySnapshot(t, pool, id)
			got, err := failing.PutDelivery(ctx, p.companyID, p.ownerID, id, get.ETag, true, body)
			if err == nil || !reflect.DeepEqual(got, drafts.Result{}) || before != deliverySnapshot(t, pool, id) {
				t.Fatalf("audit failure=%+v %v", got, err)
			}
			if _, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, get.ETag, true, body); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestDelivery_LiveGatesCorruptionAndOverflowFailClosed(t *testing.T) {
	pool := requireDraftPool(t)
	cases := []struct {
		name, mutate string
		want         error
	}{
		{"deleted user", `UPDATE users SET deleted_at=now() WHERE id=$1`, drafts.ErrUnauthenticated},
		{"revoked membership", `DELETE FROM company_members WHERE user_id=$1`, drafts.ErrForbidden},
		{"suspended company", `UPDATE companies SET status='suspended' WHERE id=$1`, drafts.ErrCompanyNotActive},
		{"tombstoned company", `UPDATE companies SET deleted_at=now() WHERE id=$1`, drafts.ErrCompanyInactive},
		{"infinite date", `UPDATE job_draft_delivery_configs SET commitment_date='infinity'::date WHERE draft_id=$1`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, p, created := createV2Draft(t, pool)
			s.clock = fixedDeliveryClock
			id := draftIDOf(t, created)
			ctx := context.Background()
			saved, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, []byte(nullDelivery))
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
			before := deliverySnapshot(t, pool, id)
			for _, write := range []bool{false, true} {
				var got drafts.Result
				if write {
					got, err = s.PutDelivery(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(nullDelivery))
				} else {
					got, err = s.GetDelivery(ctx, p.companyID, p.ownerID, id)
				}
				if err == nil || tc.want != nil && !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != deliverySnapshot(t, pool, id) {
					t.Fatalf("write=%v got=%+v err=%v", write, got, err)
				}
			}
		})
	}
	t.Run("overflow", func(t *testing.T) {
		s, p, created := createV2Draft(t, pool)
		s.clock = fixedDeliveryClock
		id := draftIDOf(t, created)
		ctx := context.Background()
		if _, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, deliveryconfig.ETag(id, 0), true, []byte(nullDelivery)); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `UPDATE job_draft_delivery_configs SET version=9223372036854775807 WHERE draft_id=$1`, id); err != nil {
			t.Fatal(err)
		}
		get, err := s.GetDelivery(ctx, p.companyID, p.ownerID, id)
		if err != nil {
			t.Fatal(err)
		}
		before := deliverySnapshot(t, pool, id)
		got, err := s.PutDelivery(ctx, p.companyID, p.ownerID, id, get.ETag, true, []byte(`{"cutoffStageId":null,"targetQuantity":1,"commitmentDate":null}`))
		if !errors.Is(err, drafts.ErrVersionOverflow) || !reflect.DeepEqual(got, drafts.Result{}) || before != deliverySnapshot(t, pool, id) {
			t.Fatalf("overflow=%+v %v", got, err)
		}
	})
}
