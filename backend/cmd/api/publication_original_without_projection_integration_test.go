//go:build integration

package main

import (
	"reflect"
	"testing"
	"time"
)

// Replacement processes R3e (feature doc T12, finding F1): only a replacement can be
// private. An ORIGINAL process row with no public projection (the shape the metrics
// demo seeds and any legacy row has) keeps the publication semantics of main: it reads
// as published, offers no `publish` action, cannot be published again and a content
// save writes its projection. Everything goes through the production router.

func TestOriginalProcessWithoutProjectionKeepsPublicationSemanticsOfMain(t *testing.T) {
	f := newReplFlow(t)
	id := f.draft()
	started := time.Date(2026, 10, 1, 9, 30, 0, 0, time.UTC)
	// Seeded like the metrics demo: the process row only, no projection.
	f.exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',$3,$4)`, id, f.company.companyID, started, f.owner.userID)
	if _, ok := f.projectionTime(id); ok {
		t.Fatal("fixture has a projection")
	}

	// GET publication: published at the process clock, nothing missing, no write.
	got := f.publication(id)
	if want := `{"status":"published","publishedAt":"` + replTime(started) + `","missing":[]}`; got.status != 200 || string(got.body) != want {
		t.Fatalf("publication = %d %s, want %s", got.status, got.body, want)
	}
	if _, ok := f.projectionTime(id); ok {
		t.Fatal("reading the publication created a projection")
	}

	// Lifecycle: a live public process, with no `publish` action, as on main.
	_, view := f.view(id)
	if view["visibility"] != "public" || view["kind"] != "original" || view["publication"] != "published" || !reflect.DeepEqual(replActions(view), []string{"pause", "close"}) {
		t.Fatalf("lifecycle = %v", view)
	}
	paused := f.transition(id, "pause", `{}`)
	if paused.status != 200 {
		t.Fatalf("pause: %d %s", paused.status, paused.body)
	}
	if actions := replActions(draftFlowObject(t, paused.body)); !reflect.DeepEqual(actions, []string{"resume", "close"}) {
		t.Fatalf("paused actions = %v", actions)
	}
	if resumed := f.transition(id, "resume", `{}`); resumed.status != 200 {
		t.Fatalf("resume: %d %s", resumed.status, resumed.body)
	}

	// Draft list and chain read it as public too.
	page := f.list(f.owner.token, "?root_process_id="+id)
	if len(page.items) != 1 || page.items[0]["visibility"] != "public" || page.items[0]["kind"] != "original" {
		t.Fatalf("list items = %v", page.items)
	}
	items := replList(t, f.chainOK(id)["items"])
	if len(items) != 1 || replObject(t, items[0])["visibility"] != "public" {
		t.Fatalf("chain items = %v", items)
	}

	// Publish: already published, exactly as on main.
	if again := f.publishPost(id); again.status != 409 || draftFlowCatalogCode(t, again.body) != "already_published" {
		t.Fatalf("publish again = %d %s", again.status, again.body)
	}
	if _, ok := f.projectionTime(id); ok {
		t.Fatal("the refused publish created a projection")
	}

	// A content save materializes the projection with the process clock.
	draft := f.h.do(t, "GET", draftFlowV2Path+"/"+id, "", f.owner.token, nil)
	saved := f.h.do(t, "PATCH", draftFlowV2Path+"/"+id, `{"fields":{"title":"Saved original"}}`, f.owner.token, map[string]string{"If-Match": draft.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatalf("save: %d %s", saved.status, saved.body)
	}
	at, ok := f.projectionTime(id)
	if !ok || !at.Equal(started) {
		t.Fatalf("projection after the save = %v %v, want %v", at, ok, started)
	}
	if title := f.scalar(`SELECT title FROM vacancy_public_projections WHERE id=$1`, id); title != "Saved original" {
		t.Fatalf("projection title = %v", title)
	}
	if got := f.publication(id); string(got.body) != `{"status":"published","publishedAt":"`+replTime(started)+`","missing":[]}` {
		t.Fatalf("publication after the save = %s", got.body)
	}
	if _, view = f.view(id); view["visibility"] != "public" {
		t.Fatalf("lifecycle after the save = %v", view)
	}

	// A closed original without projection still reads published, never offers publish.
	closed := f.draft()
	f.exec(`INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',$3,$4)`, closed, f.company.companyID, started, f.owner.userID)
	f.closeIt(closed, "continue")
	if got := f.publication(closed); string(got.body) != `{"status":"published","publishedAt":"`+replTime(started)+`","missing":[]}` {
		t.Fatalf("closed publication = %s", got.body)
	}
	if again := f.publishPost(closed); again.status != 409 || draftFlowCatalogCode(t, again.body) != "already_published" {
		t.Fatalf("publish closed = %d %s", again.status, again.body)
	}
	if _, view = f.view(closed); view["visibility"] != "public" {
		t.Fatalf("closed lifecycle = %v", view)
	}
}
