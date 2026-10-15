//go:build integration

package draftstore

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// requireDraftPool guards the DSN: only the dedicated loopback draft_test DB.
// Explicit timestamps and IDs make keyset boundaries independent of the clock.
func seedListV2(t *testing.T, pool *pgxpool.Pool, p principal, actor, id uuid.UUID, at time.Time, body []byte) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `INSERT INTO job_drafts (id,company_id,created_by,principal_recruiter_id,fields,updated_at) VALUES ($1,$2,$3,$4,$5,$6)`, id, p.companyID, p.ownerID, actor, body, at); err != nil {
		t.Fatal(err)
	}
}

func listV2Page(t *testing.T, s *Store, p principal, actor uuid.UUID, req draftlist.Request) draftlist.Page {
	t.Helper()
	page, err := s.ListV2(context.Background(), p.companyID, actor, req)
	if err != nil {
		t.Fatalf("ListV2: %v", err)
	}
	if page.Items == nil {
		t.Fatal("Items must be non-nil")
	}
	return page
}

func listV2After(t *testing.T, token string, p principal, actor uuid.UUID) *draftlist.Cursor {
	t.Helper()
	cursor, err := draftlist.DecodeCursor(token, draftlist.Scope{CompanyID: p.companyID, ActorID: actor})
	if err != nil {
		t.Fatal(err)
	}
	return &cursor
}

func TestListV2_VisibilityOrderAndPagination(t *testing.T) {
	pool := requireDraftPool(t)
	s := newStore(t, pool)
	p, other := newPrincipal(t, pool), newPrincipal(t, pool)
	recruiter := addMember(t, pool, p.companyID, "recruiter")
	at := time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)
	ids := []uuid.UUID{uuid.MustParse("00000000-0000-4000-8000-000000000003"), uuid.MustParse("00000000-0000-4000-8000-000000000002"), uuid.MustParse("00000000-0000-4000-8000-000000000001")}
	seedListV2(t, pool, p, p.ownerID, ids[0], at, []byte(readV2Document))
	seedListV2(t, pool, p, recruiter, ids[1], at, []byte(readV2Document))
	seedListV2(t, pool, p, recruiter, ids[2], at.Add(-2*time.Second), []byte(readV2Document))
	// The v1 row between v2 rows cannot consume a limit/cursor slot.
	seedListV2(t, pool, p, recruiter, uuid.New(), at.Add(-time.Second), []byte(`{"schema_version":1,"fields":{}}`))
	seedListV2(t, pool, other, other.ownerID, uuid.New(), at.Add(time.Hour), []byte(readV2Document))
	for _, limit := range []int{1, 2, 50} {
		t.Run(fmt.Sprintf("limit_%d", limit), func(t *testing.T) {
			var got []uuid.UUID
			var after *draftlist.Cursor
			pages := 0
			for {
				page := listV2Page(t, s, p, p.ownerID, draftlist.Request{Limit: limit, After: after})
				pages++
				if want := min(limit, len(ids)-len(got)); len(page.Items) != want {
					t.Fatalf("page size=%d want %d", len(page.Items), want)
				}
				for _, item := range page.Items {
					got = append(got, item.ID)
				}
				if page.NextCursor == "" {
					break
				}
				if pages > len(ids) {
					t.Fatal("pagination did not terminate")
				}
				after = listV2After(t, page.NextCursor, p, p.ownerID)
				last := page.Items[len(page.Items)-1]
				if after.LastID != last.ID || !after.LastUpdatedAt.Equal(last.UpdatedAt) {
					t.Fatal("cursor must point at last returned row")
				}
			}
			if !reflect.DeepEqual(got, ids) {
				t.Fatalf("IDs=%v want %v", got, ids)
			}
			if pages != (len(ids)+limit-1)/limit {
				t.Fatalf("pages=%d", pages)
			}
		})
	}
	own := listV2Page(t, s, p, recruiter, draftlist.Request{Limit: 50})
	if len(own.Items) != 2 || own.Items[0].ID != ids[1] || own.Items[1].ID != ids[2] {
		t.Fatalf("recruiter rows=%+v", own.Items)
	}
	// Bypass HTTP cursor validation: SQL must still use session identities.
	forged := &draftlist.Cursor{CompanyID: other.companyID, ActorID: p.ownerID, LastUpdatedAt: at.Add(2 * time.Hour), LastID: uuid.New()}
	scoped := listV2Page(t, s, p, recruiter, draftlist.Request{Limit: 1, After: forged})
	if len(scoped.Items) != 1 || scoped.Items[0].ID != ids[1] {
		t.Fatalf("cursor widened visibility: %+v", scoped)
	}
	next := listV2After(t, scoped.NextCursor, p, recruiter)
	if next.ActorID != recruiter || next.CompanyID != p.companyID {
		t.Fatal("next cursor must use session scope")
	}
}

func TestListV2_ProjectionMatchesGetV2(t *testing.T) {
	pool := requireDraftPool(t)
	for _, shape := range []string{"null", "kind_only", "internal_area", "client", "deleted_principal"} {
		t.Run(shape, func(t *testing.T) {
			p := newPrincipal(t, pool)
			doc := envelopeOf(t, []byte(readV2Document))
			fields := doc["fields"].(map[string]any)
			if shape == "null" {
				fields["title"] = nil
			}
			var wantRequester *draftlist.Requester
			if shape == "kind_only" {
				fields["requester"] = map[string]any{"kind": "client", "id": nil}
				wantRequester = &draftlist.Requester{Kind: "client"}
			}
			if shape == "internal_area" || shape == "client" {
				ref := insertRequester(t, pool, p.companyID, shape, "Engineering").String()
				name := "Engineering"
				fields["requester"] = map[string]any{"kind": shape, "id": ref}
				wantRequester = &draftlist.Requester{Kind: shape, ID: &ref, Name: &name}
			}
			s, created, _ := seedReadV2(t, pool, p, mustCanonical(t, doc))
			principalID := p.ownerID
			if shape == "deleted_principal" {
				principalID = addMember(t, pool, p.companyID, "recruiter")
				if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET principal_recruiter_id=$1 WHERE id=$2`, principalID, draftIDOf(t, created)); err != nil {
					t.Fatal(err)
				}
				if _, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at=now() WHERE id=$1`, principalID); err != nil {
					t.Fatal(err)
				}
			}
			page := listV2Page(t, s, p, p.ownerID, draftlist.Request{Limit: 50})
			if len(page.Items) != 1 || page.NextCursor != "" {
				t.Fatalf("page=%+v", page)
			}
			item := page.Items[0]
			got, err := s.GetV2(context.Background(), p.companyID, p.ownerID, item.ID)
			if err != nil {
				t.Fatal(err)
			}
			get := envelopeOf(t, got.Body)
			getFields := get["fields"].(map[string]any)
			var title any
			if item.Title != nil {
				title = *item.Title
			}
			if title != getFields["title"] || strconv.FormatInt(item.Version, 10) != get["version"] || item.CreatedAt.UTC().Format(timestampLayout) != get["created_at"] || item.UpdatedAt.UTC().Format(timestampLayout) != get["updated_at"] {
				t.Fatalf("list=%+v GET=%s", item, got.Body)
			}
			if !reflect.DeepEqual(item.Requester, wantRequester) {
				t.Fatalf("requester=%+v want %+v", item.Requester, wantRequester)
			}
			var requester any
			if item.Requester != nil {
				var id, name any
				if item.Requester.ID != nil {
					id = *item.Requester.ID
				}
				if item.Requester.Name != nil {
					name = *item.Requester.Name
				}
				requester = map[string]any{"kind": item.Requester.Kind, "id": id, "name": name}
			}
			if !reflect.DeepEqual(requester, getFields["requester"]) {
				t.Fatalf("list requester=%v GET=%v", requester, getFields["requester"])
			}
			if item.Principal.ID != principalID {
				t.Fatal("wrong principal")
			}
			if shape == "deleted_principal" {
				if item.Principal.Name != nil {
					t.Fatal("deleted principal name must be nil")
				}
			} else if item.Principal.Name == nil || *item.Principal.Name != "Draft Test" {
				t.Fatalf("principal=%+v", item.Principal)
			}
		})
	}
}

func TestListV2_GatesMatchGetV2(t *testing.T) {
	pool := requireDraftPool(t)
	for _, name := range []string{"deleted_user", "no_membership", "deleted_company", "non_active_company"} {
		t.Run(name, func(t *testing.T) {
			p := newPrincipal(t, pool)
			s, created, _ := seedReadV2(t, pool, p, []byte(readV2Document))
			actor := p.ownerID
			want := drafts.ErrCompanyNotActive
			var err error
			switch name {
			case "deleted_user":
				_, err = pool.Exec(context.Background(), `UPDATE users SET deleted_at=now() WHERE id=$1`, actor)
				want = drafts.ErrUnauthenticated
			case "no_membership":
				actor = insertUser(t, pool)
				registerUserCleanup(t, pool, actor)
				want = drafts.ErrForbidden
			case "deleted_company":
				_, err = pool.Exec(context.Background(), `UPDATE companies SET deleted_at=now() WHERE id=$1`, p.companyID)
				want = drafts.ErrCompanyInactive
			case "non_active_company":
				_, err = pool.Exec(context.Background(), `UPDATE companies SET status='pending_verification' WHERE id=$1`, p.companyID)
			}
			if err != nil {
				t.Fatal(err)
			}
			_, getErr := s.GetV2(context.Background(), p.companyID, actor, draftIDOf(t, created))
			_, listErr := s.ListV2(context.Background(), p.companyID, actor, draftlist.Request{Limit: 20})
			if getErr != want || listErr != getErr {
				t.Fatalf("list=%v GET=%v want sentinel %v", listErr, getErr, want)
			}
		})
	}
}

func TestListV2_Empty(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	page := listV2Page(t, newStore(t, pool), p, p.ownerID, draftlist.Request{Limit: 20})
	if len(page.Items) != 0 || page.NextCursor != "" {
		t.Fatalf("page=%+v", page)
	}
}

func TestListV2_CorruptRowsFail(t *testing.T) {
	pool := requireDraftPool(t)
	for _, shape := range []string{"noncanonical", "missing_catalog", "wrong_catalog_kind", "foreign_catalog", "string_schema"} {
		t.Run(shape, func(t *testing.T) {
			p := newPrincipal(t, pool)
			doc := envelopeOf(t, []byte(readV2Document))
			fields := doc["fields"].(map[string]any)
			switch shape {
			case "noncanonical":
				fields["title"] = " padded "
			case "missing_catalog":
				fields["requester"] = map[string]any{"kind": "client", "id": uuid.NewString()}
			case "wrong_catalog_kind":
				fields["requester"] = map[string]any{"kind": "client", "id": insertRequester(t, pool, p.companyID, "internal_area", "Wrong").String()}
			case "foreign_catalog":
				other := newPrincipal(t, pool)
				fields["requester"] = map[string]any{"kind": "client", "id": insertRequester(t, pool, other.companyID, "client", "Other").String()}
			case "string_schema":
				doc["schema_version"] = "2"
			}
			s, _, _ := seedReadV2(t, pool, p, mustCanonical(t, doc))
			_, err := s.ListV2(context.Background(), p.companyID, p.ownerID, draftlist.Request{Limit: 20})
			if err == nil || errors.Is(err, drafts.ErrNotFound) || errors.Is(err, drafts.ErrValidation) {
				t.Fatalf("expected server invariant error, got %v", err)
			}
		})
	}
}

func TestListV2_SaveDuringPaginationMayMoveBeforeCursor(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	first, second, third := uuid.New(), uuid.New(), uuid.New()
	for i, id := range []uuid.UUID{first, second, third} {
		seedListV2(t, pool, p, p.ownerID, id, at.Add(-time.Duration(i)*time.Second), []byte(readV2Document))
	}
	page := listV2Page(t, s, p, p.ownerID, draftlist.Request{Limit: 1})
	if page.Items[0].ID != first {
		t.Fatal("wrong first row")
	}
	after := listV2After(t, page.NextCursor, p, p.ownerID)
	// Model a save's version/timestamp change deterministically (S7).
	if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET updated_at=$1, version=version+1 WHERE id=$2`, at.Add(time.Second), second); err != nil {
		t.Fatal(err)
	}
	later := listV2Page(t, s, p, p.ownerID, draftlist.Request{Limit: 50, After: after})
	if len(later.Items) != 1 || later.Items[0].ID != third {
		t.Fatalf("later=%+v", later)
	}
	restarted := listV2Page(t, s, p, p.ownerID, draftlist.Request{Limit: 1})
	if restarted.Items[0].ID != second {
		t.Fatal("restart must reveal saved draft at top")
	}
}

func TestListV2_FiftyItemBoundary(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	at := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	ids := make([]uuid.UUID, 53)
	for i := range ids {
		ids[i] = uuid.New()
		seedListV2(t, pool, p, p.ownerID, ids[i], at.Add(-time.Duration(i)*time.Second), []byte(readV2Document))
	}
	first := listV2Page(t, s, p, p.ownerID, draftlist.Request{Limit: 50})
	if len(first.Items) != 50 || first.NextCursor == "" {
		t.Fatalf("first page length=%d cursor=%q", len(first.Items), first.NextCursor)
	}
	after := listV2After(t, first.NextCursor, p, p.ownerID)
	if after.LastID != ids[49] {
		t.Fatal("cursor must point to item 50, not lookahead")
	}
	second := listV2Page(t, s, p, p.ownerID, draftlist.Request{Limit: 50, After: after})
	if len(second.Items) != 3 || second.NextCursor != "" {
		t.Fatalf("second page=%+v", second)
	}
	var got []uuid.UUID
	for _, item := range append(first.Items, second.Items...) {
		got = append(got, item.ID)
	}
	if !reflect.DeepEqual(got, ids) {
		t.Fatalf("IDs=%v want %v", got, ids)
	}
}
