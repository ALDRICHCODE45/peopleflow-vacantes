package http

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
)

func TestListDraftsPublicationKeysAndUTCTimestamp(t *testing.T) {
	at := time.Date(2026, 10, 16, 12, 34, 56, 123456000, time.FixedZone("Mexico", -6*60*60))
	store := &fakeDraftLister{page: draftlist.Page{Items: []draftlist.Item{{ID: listDraftID, Status: "published", Process: strPtr("active"), PublishedAt: &at, Version: 1, Principal: draftlist.Principal{ID: listPrincipalID}}, {ID: reqEntryID, Status: "draft", Version: 1, Principal: draftlist.Principal{ID: listPrincipalID}}}}}
	r := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath, nil, nil)
	assertNoStore(t, r)
	var page struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if r.Code != 200 || len(page.Items) != 2 || len(page.Items[0]) != 12 || len(page.Items[1]) != 12 || page.Items[1]["process"] != nil || page.Items[0]["process"] != "active" || page.Items[0]["status"] != "published" || page.Items[0]["published_at"] != "2026-10-16T18:34:56.123456Z" || page.Items[1]["status"] != "draft" || page.Items[1]["published_at"] != nil {
		t.Fatalf("%d %s", r.Code, r.Body.String())
	}
	keys := map[string]bool{}
	for k := range page.Items[0] {
		keys[k] = true
	}
	if !reflect.DeepEqual(keys, map[string]bool{"id": true, "title": true, "work_mode": true, "work_schedule": true, "requester": true, "principal_recruiter": true, "version": true, "status": true, "process": true, "published_at": true, "created_at": true, "updated_at": true}) {
		t.Fatal(keys)
	}
}
