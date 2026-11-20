package http

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftlist"
)

func TestListDraftsReplacementKeysOnTheWire(t *testing.T) {
	at := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	seq := 2
	source := reqEntryID
	store := &fakeDraftLister{page: draftlist.Page{Items: []draftlist.Item{
		{ID: listDraftID, Team: listTestTeam(nil), Version: 1, Process: strPtr("active"), Status: "published", PublishedAt: &at, CreatedAt: at, UpdatedAt: at,
			Kind: "replacement", Sequence: &seq, ReplacementOf: &source, RootProcessID: reqUserID, Visibility: strPtr("private")},
	}}}
	rec := doDraft(t, draftListRouter(store, true), http.MethodGet, draftListPath, nil, nil)
	var page struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &page); err != nil || rec.Code != 200 || len(page.Items) != 1 {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	item := page.Items[0]
	if item["kind"] != "replacement" || item["sequence"] != float64(2) || item["replacement_of"] != reqEntryID.String() || item["root_process_id"] != reqUserID.String() || item["visibility"] != "private" {
		t.Fatalf("%v", item)
	}
}
