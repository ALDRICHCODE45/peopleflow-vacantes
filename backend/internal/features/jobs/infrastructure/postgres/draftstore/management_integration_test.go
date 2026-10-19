//go:build integration

package draftstore

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancymanagement"
)

const nullManagement = `{"requestDate":null,"hiringHeadcount":null}`

func TestManagementPureGetFirstPutNoOpAuditAndIsolation(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	ctx := context.Background()
	id := draftIDOf(t, created)
	before := publicationSnapshot(t, pool, id)
	first, err := s.GetManagement(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.GetManagement(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(first, second) || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("GET not pure: %v", err)
	}
	var root map[string]any
	if err := json.Unmarshal(first.Body, &root); err != nil {
		t.Fatal(err)
	}
	if len(root) != 5 || root["version"] != "0" || root["requestDate"] != nil || root["hiringHeadcount"] != nil || root["today"] != "2026-10-16" || !reflect.DeepEqual(root["limits"], map[string]any{"maxHiringHeadcount": float64(999)}) || first.ETag != vacancymanagement.ETag(id, 0) {
		t.Fatalf("GET=%s %s", first.Body, first.ETag)
	}
	saved, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, first.ETag, true, []byte(nullManagement))
	if err != nil || saved.ETag != vacancymanagement.ETag(id, 1) || auditCount(t, pool, id, managementConfiguredEvent) != 1 {
		t.Fatalf("first=%+v %v", saved, err)
	}
	before = publicationSnapshot(t, pool, id)
	noop, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(nullManagement))
	if err != nil || !reflect.DeepEqual(saved, noop) || before != publicationSnapshot(t, pool, id) {
		t.Fatalf("noop=%+v %v", noop, err)
	}
	changed, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, saved.ETag, true, []byte(`{"requestDate":"2026-10-11","hiringHeadcount":999}`))
	if err != nil || changed.ETag != vacancymanagement.ETag(id, 2) {
		t.Fatalf("changed=%+v %v", changed, err)
	}
	// Management audit is the only change to the existing resource snapshot.
	var actor string
	var raw []byte
	if err := pool.QueryRow(ctx, `SELECT actor_id::text,metadata FROM audit_events WHERE entity_id=$1 AND event_type='JobDraftManagementConfigured' AND metadata->>'version'='2'`, id).Scan(&actor, &raw); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]string
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	if actor != p.ownerID.String() || metadata["previous"] != nullManagement || metadata["new"] != `{"requestDate":"2026-10-11","hiringHeadcount":999}` {
		t.Fatalf("audit=%s", raw)
	}
	draft, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(draft, created) {
		t.Fatal("management changed draft")
	}
	before = publicationSnapshot(t, pool, id)
	failing := NewStore(pool, failingAudit{})
	failing.clock = fixedDeliveryClock
	got, err := failing.PutManagement(ctx, p.companyID, p.ownerID, id, changed.ETag, true, []byte(nullManagement))
	if err == nil || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatal("audit failure not atomic")
	}
}
func TestManagementRejectedWritesAreAtomic(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, created := createV2Draft(t, pool)
	s.clock = fixedDeliveryClock
	id := draftIDOf(t, created)
	ctx := context.Background()
	nonprincipal := addMember(t, pool, p.companyID, "recruiter")
	for _, tc := range []struct {
		name, tag, body string
		present         bool
		want            error
	}{
		{"required", "", nullManagement, false, drafts.ErrPreconditionRequired}, {"weak", `W/"x"`, nullManagement, true, drafts.ErrInvalidRequest}, {"stale", vacancymanagement.ETag(id, 1), nullManagement, true, drafts.ErrVersionConflict}, {"draft tag", created.ETag, nullManagement, true, drafts.ErrVersionConflict},
		{"shape", vacancymanagement.ETag(id, 0), `{}`, true, drafts.ErrInvalidRequest}, {"future", vacancymanagement.ETag(id, 0), `{"requestDate":"2026-10-17","hiringHeadcount":1}`, true, drafts.ErrValidation}, {"headcount", vacancymanagement.ETag(id, 0), `{"requestDate":null,"hiringHeadcount":1000}`, true, drafts.ErrValidation},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := publicationSnapshot(t, pool, id)
			got, err := s.PutManagement(ctx, p.companyID, p.ownerID, id, tc.tag, tc.present, []byte(tc.body))
			if !errors.Is(err, tc.want) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
				t.Fatalf("got=%+v %v want=%v", got, err, tc.want)
			}
		})
	}
	before := publicationSnapshot(t, pool, id)
	got, err := s.PutManagement(ctx, p.companyID, nonprincipal, id, "", false, []byte(`bad`))
	if !errors.Is(err, drafts.ErrNotFound) || !reflect.DeepEqual(got, drafts.Result{}) || before != publicationSnapshot(t, pool, id) {
		t.Fatal("authorization precedence")
	}
}
