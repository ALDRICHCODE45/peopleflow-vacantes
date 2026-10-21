//go:build integration

package draftstore

import (
	"context"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/google/uuid"
)

func TestListPublicationStatusKeepsOrderCursorAndDraftTimestamps(t *testing.T) {
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	ctx := context.Background()
	id := draftIDOf(t, draft)
	// A later empty draft must keep its place ahead of the published row.
	second := createV2(t, s, p, uuid.NewString(), []byte(`{"fields":{}}`))
	other := draftIDOf(t, second)
	before, err := s.ListV2(ctx, p.companyID, p.ownerID, draftlist.Request{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Items) != 1 || before.Items[0].ID != other || before.Items[0].Status != "draft" || before.Items[0].PublishedAt != nil {
		t.Fatalf("before=%+v", before)
	}
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	after, err := s.ListV2(ctx, p.companyID, p.ownerID, draftlist.Request{Limit: 1})
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("publication reordered page/cursor: %+v %v", after, err)
	}
	cursor, err := draftlist.DecodeCursor(before.NextCursor, draftlist.Scope{CompanyID: p.companyID, ActorID: p.ownerID})
	if err != nil {
		t.Fatal(err)
	}
	page, err := s.ListV2(ctx, p.companyID, p.ownerID, draftlist.Request{Limit: 1, After: &cursor})
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != id || page.Items[0].Status != "published" || page.Items[0].PublishedAt == nil || !page.Items[0].PublishedAt.Equal(fixedDeliveryClock()) || page.NextCursor != "" {
		t.Fatalf("published page=%+v %v", page, err)
	}
	got, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil || !reflect.DeepEqual(withoutLifecycleResult(t, got), draft) {
		t.Fatal("publication changed draft sort timestamps/version")
	}
}
