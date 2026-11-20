package http

import (
	"net/http"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

func TestListDraftsRootProcessIDFilter(t *testing.T) {
	root := listDraftID
	t.Run("forwards a canonical id", func(t *testing.T) {
		store := &fakeDraftLister{}
		rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath+"?root_process_id="+root.String(), nil, nil)
		if rec.Code != 200 || store.req.RootProcessID == nil || *store.req.RootProcessID != root {
			t.Fatalf("%d %+v", rec.Code, store.req)
		}
	})
	t.Run("no filter stays nil", func(t *testing.T) {
		store := &fakeDraftLister{}
		doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath, nil, nil)
		if store.req.RootProcessID != nil {
			t.Fatalf("%+v", store.req)
		}
	})
	t.Run("a cursor issued for the same filter is accepted and forwarded", func(t *testing.T) {
		cursor := draftlist.Cursor{CompanyID: reqCompanyID, ActorID: reqUserID, LastUpdatedAt: time.Unix(0, 0), LastID: listDraftID, RootProcessID: &root}
		token, err := draftlist.EncodeCursor(cursor)
		if err != nil {
			t.Fatal(err)
		}
		store := &fakeDraftLister{}
		rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath+"?root_process_id="+root.String()+"&cursor="+token, nil, nil)
		if rec.Code != 200 || store.req.After == nil || store.req.After.RootProcessID == nil || *store.req.After.RootProcessID != root {
			t.Fatalf("%d %+v", rec.Code, store.req)
		}
	})
	filtered := draftlist.Cursor{CompanyID: reqCompanyID, ActorID: reqUserID, LastUpdatedAt: time.Unix(0, 0), LastID: listDraftID, RootProcessID: &root}
	filteredToken, _ := draftlist.EncodeCursor(filtered)
	plain := filtered
	plain.RootProcessID = nil
	plainToken, _ := draftlist.EncodeCursor(plain)
	otherRoot := uuid.MustParse("77777777-7777-7777-7777-777777777777")
	for name, tc := range map[string]struct {
		query string
		code  httpjson.Code
	}{
		"text":                           {"?root_process_id=abc", httpjson.CodeInvalidRequest},
		"empty":                          {"?root_process_id=", httpjson.CodeInvalidRequest},
		"uppercase":                      {"?root_process_id=55555555-5555-5555-5555-55555555555A", httpjson.CodeInvalidRequest},
		"repeated":                       {"?root_process_id=" + root.String() + "&root_process_id=" + root.String(), httpjson.CodeInvalidRequest},
		"filtered cursor without filter": {"?cursor=" + filteredToken, httpjson.CodeInvalidCursor},
		"plain cursor with a filter":     {"?root_process_id=" + root.String() + "&cursor=" + plainToken, httpjson.CodeInvalidCursor},
		"filtered cursor, other filter":  {"?root_process_id=" + otherRoot.String() + "&cursor=" + filteredToken, httpjson.CodeInvalidCursor},
		"bad filter beats a bad cursor":  {"?root_process_id=abc&cursor=" + filteredToken, httpjson.CodeInvalidRequest},
		"garbage cursor with a filter":   {"?root_process_id=" + root.String() + "&cursor=%25%25", httpjson.CodeInvalidRequest},
	} {
		t.Run(name, func(t *testing.T) {
			store := &fakeDraftLister{}
			rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath+tc.query, nil, nil)
			assertCatalogError(t, rec, http.StatusBadRequest, tc.code)
			if store.calls != 0 {
				t.Fatalf("store called %d times for rejected input", store.calls)
			}
		})
	}
}
