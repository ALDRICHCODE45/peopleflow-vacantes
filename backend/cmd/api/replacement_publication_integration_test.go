//go:build integration

package main

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// Replacement processes R3c (docs/contracts/replacement-processes-v1.md, «Private by
// default, publish later»; feature doc S4): `publish: true` on Start, publishing a
// private replacement later, and what a private replacement reads as, all through
// the production router.

// startOK starts a replacement from the source and returns its 201 body.
func (f *replFlow) startOK(source, body string) map[string]any {
	f.t.Helper()
	resp := f.start(source, body)
	if resp.status != 201 {
		f.t.Fatalf("start: %d %s", resp.status, resp.body)
	}
	return draftFlowObject(f.t, resp.body)
}

// publishPost is POST V/publication with the draft's current ETag and a fresh key.
func (f *replFlow) publishPost(id string) draftFlowResponse {
	f.t.Helper()
	draft := f.h.do(f.t, "GET", draftFlowV2Path+"/"+id, "", f.owner.token, nil)
	return f.h.do(f.t, "POST", draftFlowV2Path+"/"+id+"/publication", `{}`, f.owner.token, map[string]string{"If-Match": draft.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
}

func (f *replFlow) publication(id string) draftFlowResponse {
	f.t.Helper()
	return f.h.do(f.t, "GET", draftFlowV2Path+"/"+id+"/publication", "", f.owner.token, nil)
}

func (f *replFlow) processTime(column, id string) time.Time {
	f.t.Helper()
	var at time.Time
	if err := f.h.pool.QueryRow(context.Background(), `SELECT `+column+` FROM vacancy_processes WHERE id=$1`, id).Scan(&at); err != nil {
		f.t.Fatal(err)
	}
	return at
}

func (f *replFlow) projectionTime(id string) (time.Time, bool) {
	f.t.Helper()
	var at time.Time
	err := f.h.pool.QueryRow(context.Background(), `SELECT published_at FROM vacancy_public_projections WHERE id=$1`, id).Scan(&at)
	if err != nil {
		return time.Time{}, false
	}
	return at, true
}

// breakContent blanks the title stored in the draft, so its publication readiness fails.
func (f *replFlow) breakContent(id string) {
	f.t.Helper()
	f.exec(`UPDATE job_drafts SET fields=convert_to(replace(convert_from(fields,'UTF8'),'"title":"Backend Go"','"title":null'),'UTF8') WHERE id=$1`, id)
	if f.count(`SELECT count(*) FROM job_drafts WHERE id=$1 AND convert_from(fields,'UTF8') LIKE '%"title":null%'`, id) != 1 {
		f.t.Fatal("the title was not blanked")
	}
}

// publicAd is the public detail of a published ad and its raw body.
func publicAd(t *testing.T, f *replFlow, id string) (map[string]any, string) {
	t.Helper()
	r := f.h.do(t, "GET", "/v2/jobs/"+id, "", "", nil)
	if r.status != 200 {
		t.Fatalf("public ad %s: %d %s", id, r.status, r.body)
	}
	return draftFlowObject(t, r.body), string(r.body)
}

// withoutOwnKeys drops the two keys that are an ad's own (id, published_at).
func withoutOwnKeys(ad map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range ad {
		if k != "id" && k != "published_at" {
			out[k] = v
		}
	}
	return out
}

func assertNoReplacementWording(t *testing.T, body string) {
	t.Helper()
	lower := strings.ToLower(body)
	for _, word := range []string{"replac", "reemplaz", "root_process", "sequence", "visibility"} {
		if strings.Contains(lower, word) {
			t.Fatalf("the public ad mentions %q: %s", word, body)
		}
	}
}

func TestReplacementStartPublishesANormalAd(t *testing.T) {
	f := newReplFlow(t)
	root, credits := f.closedChain(1)
	ordinary := f.published() // an ordinary ad of the same company with the same content
	out := f.startOK(root, replBody(t, `,"publish":true`, credits...))
	id := out["id"].(string)

	if out["visibility"] != "public" {
		t.Fatalf("visibility = %v", out["visibility"])
	}
	lifecycle := out["lifecycle"].(map[string]any)
	if lifecycle["visibility"] != "public" || !reflect.DeepEqual(replActions(lifecycle), []string{"pause", "close"}) {
		t.Fatalf("lifecycle = %v", lifecycle)
	}

	// Same transaction: the process row, the link and the projection share the start instant.
	started := f.processTime("published_at", id)
	projected, ok := f.projectionTime(id)
	if !ok || !projected.Equal(started) || out["started_at"] != started.UTC().Format("2006-01-02T15:04:05.000000Z") {
		t.Fatalf("projection %v %v, process %v, started_at %v", projected, ok, started, out["started_at"])
	}
	if f.count(`SELECT count(*) FROM vacancy_replacements WHERE process_id=$1 AND started_at=$2`, id, started) != 1 {
		t.Fatal("the clock of the replacement is its start")
	}

	// S4: it sells as a normal ad, with nothing that says it is a replacement, and the
	// same shape and numbers as an ordinary ad of the same content.
	replacementAd, replacementBody := publicAd(t, f, id)
	ordinaryAd, _ := publicAd(t, f, ordinary)
	publicFlowAssertKeys(t, replacementAd, true)
	if !reflect.DeepEqual(withoutOwnKeys(replacementAd), withoutOwnKeys(ordinaryAd)) {
		t.Fatalf("the replacement ad differs from an ordinary ad:\n%v\n%v", replacementAd, ordinaryAd)
	}
	assertNoReplacementWording(t, replacementBody)
	list := publicFlowGet(t, f.h, "/v2/jobs?company_id="+f.company.companyID.String()+"&limit=50", 200)["items"].([]any)
	listed := map[string]map[string]any{}
	for _, raw := range list {
		item := raw.(map[string]any)
		listed[item["id"].(string)] = item
	}
	if listed[id] == nil || listed[ordinary] == nil || listed[root] != nil {
		t.Fatalf("catalog = %v (the replacement and the ordinary ad are listed, the closed original is not)", listed)
	}
	publicFlowAssertKeys(t, listed[id], false)
	itemBody, err := json.Marshal(listed[id])
	if err != nil {
		t.Fatal(err)
	}
	assertNoReplacementWording(t, string(itemBody))

	// Published: GET V/publication says so and a second publish is refused.
	read := f.publication(id)
	if want := `{"status":"published","publishedAt":"` + out["started_at"].(string) + `","missing":[]}`; read.status != 200 || string(read.body) != want {
		t.Fatalf("publication: %d %s, want %s", read.status, read.body, want)
	}
	again := f.publishPost(id)
	if again.status != 409 || draftFlowCatalogCode(t, again.body) != "already_published" {
		t.Fatalf("publish again: %d %s", again.status, again.body)
	}

	// Audit: the start says it published, and the usual publication event exists once.
	if got := f.auditMetadata(id, "VacancyReplacementStarted")["visibility"]; got != "public" {
		t.Fatalf("started visibility = %v", got)
	}
	meta := f.auditMetadata(id, "VacancyPublished")
	if meta["publishedAt"] != out["started_at"] || meta["version"] != "1" || meta["snapshot"] == nil {
		t.Fatalf("VacancyPublished = %v", meta)
	}
	if f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id) != 1 {
		t.Fatal("VacancyPublished must be written once")
	}
	// A replay returns the frozen answer, never a second publication.
	if f.count(`SELECT count(*) FROM vacancy_public_projections WHERE id=$1`, id) != 1 {
		t.Fatal("projection count")
	}
}

func TestReplacementStartPublishIsAllOrNothing(t *testing.T) {
	f := newReplFlow(t)
	root, credits := f.closedChain(1)
	f.breakContent(root)
	drafts, replacements := f.companyDrafts(), f.replacements()
	projections := f.count(`SELECT count(*) FROM vacancy_public_projections WHERE company_id=$1`, f.company.companyID)
	audits := f.count(`SELECT count(*) FROM audit_events WHERE company_id=$1`, f.company.companyID)

	resp := f.start(root, replBody(t, `,"publish":true`, credits...))
	body := draftFlowObject(t, resp.body)
	if resp.status != 422 || body["code"] != "publication_incomplete" || !reflect.DeepEqual(body["missing"], []any{"title_missing"}) {
		t.Fatalf("publish an incomplete ad: %d %s", resp.status, resp.body)
	}
	if f.companyDrafts() != drafts || f.replacements() != replacements ||
		f.count(`SELECT count(*) FROM vacancy_public_projections WHERE company_id=$1`, f.company.companyID) != projections ||
		f.count(`SELECT count(*) FROM audit_events WHERE company_id=$1`, f.company.companyID) != audits ||
		f.count(`SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1 AND operation='vacancy-replacement:r1'`, f.company.companyID) != 0 {
		t.Fatal("a refused publish left a trace")
	}

	// The same source starts private: publication readiness is only asked when publishing.
	out := f.startOK(root, replBody(t, `,"publish":false`, credits...))
	if out["visibility"] != "private" {
		t.Fatalf("visibility = %v", out["visibility"])
	}
}

func TestReplacementPublishLaterKeepsTheClock(t *testing.T) {
	f := newReplFlow(t)
	root, credits := f.closedChain(1)
	out := f.startOK(root, replBody(t, "", credits...))
	id := out["id"].(string)

	_, view := f.view(id)
	replAssertView(t, view, map[string]any{"publication": "published", "visibility": "private", "kind": "replacement"})
	if got := replActions(view); !reflect.DeepEqual(got, []string{"pause", "close", "publish"}) {
		t.Fatalf("allowed_actions = %v", got)
	}

	// A private replacement reads as unpublished, without writing, and is invisible.
	snapshot := f.scalar(`SELECT (SELECT count(*) FROM audit_events WHERE entity_id=$1)::text || (SELECT count(*) FROM vacancy_public_projections WHERE id=$1)::text`, id)
	read := f.publication(id)
	if read.status != 200 || string(read.body) != `{"status":"draft","publishedAt":null,"missing":[]}` || read.header.Get("ETag") != "" {
		t.Fatalf("publication of a private replacement: %d %s", read.status, read.body)
	}
	if f.scalar(`SELECT (SELECT count(*) FROM audit_events WHERE entity_id=$1)::text || (SELECT count(*) FROM vacancy_public_projections WHERE id=$1)::text`, id) != snapshot {
		t.Fatal("the publication read wrote")
	}
	publicFlowGet(t, f.h, "/v2/jobs/"+id, 404)

	// The clock: process anchors before publishing.
	started := f.processTime("published_at", id)
	lifecycleVersion := f.scalar(`SELECT lifecycle_version FROM vacancy_processes WHERE id=$1`, id)
	events := f.count(`SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1`, id)
	commitment := f.scalar(`SELECT commitment_date::text FROM job_draft_delivery_configs WHERE draft_id=$1`, id)
	if out["commitment_date"] != commitment {
		t.Fatalf("commitment = %v", commitment)
	}
	// The lifecycle transitions of a private replacement keep offering publish.
	if got := f.transition(id, "pause", `{}`); got.status != 200 || !reflect.DeepEqual(replActions(draftFlowObject(t, got.body)), []string{"resume", "close", "publish"}) {
		t.Fatalf("pause: %d %s", got.status, got.body)
	}
	if got := f.transition(id, "resume", `{}`); got.status != 200 {
		t.Fatalf("resume: %d %s", got.status, got.body)
	}
	lifecycleVersion = f.scalar(`SELECT lifecycle_version FROM vacancy_processes WHERE id=$1`, id)
	events = f.count(`SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1`, id)

	time.Sleep(20 * time.Millisecond)
	published := f.publishPost(id)
	if published.status != 201 {
		t.Fatalf("publish later: %d %s", published.status, published.body)
	}
	body := draftFlowObject(t, published.body)
	at, err := time.Parse(time.RFC3339Nano, body["publishedAt"].(string))
	if err != nil || len(body) != 3 || body["id"] != id || body["status"] != "published" || !at.After(started) {
		t.Fatalf("publish later body = %s (started %v)", published.body, started)
	}

	// The clock did not restart: the process, its link, its lifecycle history and its commitment are as they were.
	if after := f.processTime("published_at", id); !after.Equal(started) {
		t.Fatalf("vacancy_processes.published_at moved: %v -> %v", started, after)
	}
	if f.count(`SELECT count(*) FROM vacancy_replacements WHERE process_id=$1 AND started_at=$2`, id, started) != 1 ||
		f.scalar(`SELECT lifecycle_version FROM vacancy_processes WHERE id=$1`, id) != lifecycleVersion ||
		f.count(`SELECT count(*) FROM vacancy_lifecycle_events WHERE process_id=$1`, id) != events ||
		f.scalar(`SELECT commitment_date::text FROM job_draft_delivery_configs WHERE draft_id=$1`, id) != commitment {
		t.Fatal("publishing later touched the process clock")
	}
	// What candidates see is the publication time.
	projected, ok := f.projectionTime(id)
	if !ok || !projected.Equal(at) {
		t.Fatalf("projection published_at = %v %v, want %v", projected, ok, at)
	}
	ad, _ := publicAd(t, f, id)
	publicFlowAssertKeys(t, ad, true)

	_, view = f.view(id)
	replAssertView(t, view, map[string]any{"visibility": "public", "kind": "replacement", "published_at": started.UTC().Format("2006-01-02T15:04:05.000000Z")})
	if got := replActions(view); !reflect.DeepEqual(got, []string{"pause", "close"}) {
		t.Fatalf("allowed_actions after publishing = %v", got)
	}
	read = f.publication(id)
	if want := `{"status":"published","publishedAt":"` + body["publishedAt"].(string) + `","missing":[]}`; read.status != 200 || string(read.body) != want {
		t.Fatalf("publication after publishing: %d %s", read.status, read.body)
	}
	if again := f.publishPost(id); again.status != 409 || draftFlowCatalogCode(t, again.body) != "already_published" {
		t.Fatalf("publish again: %d %s", again.status, again.body)
	}

	// VacancyPublished once, at the publication time.
	meta := f.auditMetadata(id, "VacancyPublished")
	if meta["publishedAt"] != body["publishedAt"] || f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id) != 1 {
		t.Fatalf("VacancyPublished = %v", meta)
	}

	// Editing the published replacement refreshes the ad and keeps the publication time.
	publicFlowPatch(t, f.h, id, f.owner, map[string]any{"title": "Backend Go senior"})
	if f.count(`SELECT count(*) FROM vacancy_public_projections WHERE id=$1 AND title='Backend Go senior' AND published_at=$2`, id, at) != 1 {
		t.Fatal("a save must refresh the projection and keep its publication time")
	}
	if after := f.processTime("published_at", id); !after.Equal(started) {
		t.Fatal("a save moved the process clock")
	}
}

func TestReplacementPublishLaterRules(t *testing.T) {
	f := newReplFlow(t)
	// private starts a replacement in a chain of its own.
	private := func() string {
		root, credits := f.closedChain(1)
		return f.startOK(root, replBody(t, "", credits...))["id"].(string)
	}
	expect := func(t *testing.T, name string, resp draftFlowResponse, status int, code string) map[string]any {
		t.Helper()
		if resp.status != status || draftFlowCatalogCode(t, resp.body) != code {
			t.Fatalf("%s: %d %s, want %d %s", name, resp.status, resp.body, status, code)
		}
		return draftFlowObject(t, resp.body)
	}

	t.Run("paused", func(t *testing.T) {
		id := private()
		if got := f.transition(id, "pause", `{}`); got.status != 200 {
			t.Fatal(got.body)
		}
		if got := f.publishPost(id); got.status != 201 {
			t.Fatalf("publish while paused: %d %s", got.status, got.body)
		}
		// Paused stays paused: the public ad answers «unavailable» until it resumes.
		if got := publicFlowGet(t, f.h, "/v2/jobs/"+id, 410); got["code"] != "vacancy_unavailable" || got["data"].(map[string]any)["availability"] != "paused" {
			t.Fatalf("paused ad = %v", got)
		}
		_, view := f.view(id)
		if view["publication"] != "paused" || view["visibility"] != "public" {
			t.Fatalf("view = %v", view)
		}
		if got := f.transition(id, "resume", `{}`); got.status != 200 {
			t.Fatal(got.body)
		}
		publicAd(t, f, id)
	})

	t.Run("closed", func(t *testing.T) {
		id := private()
		f.closeIt(id, "continue")
		_, view := f.view(id)
		if view["visibility"] != "private" || strings.Contains(strings.Join(replActions(view), ","), "publish") {
			t.Fatalf("a closed private replacement offers publish: %v", view)
		}
		body := expect(t, "closed", f.publishPost(id), 409, "lifecycle_transition_invalid")
		data := body["data"].(map[string]any)
		if data["action"] != "publish" || !reflect.DeepEqual(data["lifecycle"], any(view)) {
			t.Fatalf("data = %v", data)
		}
		if _, ok := f.projectionTime(id); ok {
			t.Fatal("a closed replacement got a projection")
		}
	})

	t.Run("incomplete", func(t *testing.T) {
		id := private()
		f.breakContent(id)
		body := expect(t, "incomplete", f.publishPost(id), 422, "publication_incomplete")
		if !reflect.DeepEqual(body["missing"], []any{"title_missing"}) {
			t.Fatalf("missing = %v", body["missing"])
		}
		read := f.publication(id)
		if read.status != 200 || string(read.body) != `{"status":"draft","publishedAt":null,"missing":["title_missing"]}` {
			t.Fatalf("publication: %d %s", read.status, read.body)
		}
		if _, ok := f.projectionTime(id); ok {
			t.Fatal("an incomplete replacement got a projection")
		}
	})

	t.Run("headers and replay", func(t *testing.T) {
		id := private()
		path := draftFlowV2Path + "/" + id + "/publication"
		draft := f.h.do(t, "GET", draftFlowV2Path+"/"+id, "", f.owner.token, nil)
		etag := draft.header.Get("ETag")
		expect(t, "no key", f.h.do(t, "POST", path, `{}`, f.owner.token, map[string]string{"If-Match": etag}), 400, "idempotency_key_required")
		expect(t, "no if-match", f.h.do(t, "POST", path, `{}`, f.owner.token, map[string]string{"Idempotency-Key": uuid.NewString()}), 428, "precondition_required")
		expect(t, "stale", f.h.do(t, "POST", path, `{}`, f.owner.token, map[string]string{"If-Match": `"jd-r2-` + id + `-v9"`, "Idempotency-Key": uuid.NewString()}), 412, "version_conflict")
		if _, ok := f.projectionTime(id); ok {
			t.Fatal("a rejected publish wrote")
		}
		key := uuid.NewString()
		first := f.h.do(t, "POST", path, `{}`, f.owner.token, map[string]string{"If-Match": etag, "Idempotency-Key": key})
		replay := f.h.do(t, "POST", path, `{}`, f.owner.token, map[string]string{"If-Match": etag, "Idempotency-Key": key})
		if first.status != 201 || replay.status != 201 || string(first.body) != string(replay.body) || replay.header.Get("Idempotency-Replayed") != "true" {
			t.Fatalf("replay: %d %s / %d %s", first.status, first.body, replay.status, replay.body)
		}
		if f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id) != 1 {
			t.Fatal("a replay published twice")
		}
	})
}

func TestReplacementPublishLaterConcurrently(t *testing.T) {
	f := newReplFlow(t)
	root, credits := f.closedChain(1)
	id := f.startOK(root, replBody(t, "", credits...))["id"].(string)
	draft := f.h.do(t, "GET", draftFlowV2Path+"/"+id, "", f.owner.token, nil)
	etag := draft.header.Get("ETag")
	results := make(chan draftFlowResponse, 4)
	for i := 0; i < 4; i++ {
		go func() {
			results <- f.h.do(t, "POST", draftFlowV2Path+"/"+id+"/publication", `{}`, f.owner.token, map[string]string{"If-Match": etag, "Idempotency-Key": uuid.NewString()})
		}()
	}
	created, conflicts := 0, 0
	for i := 0; i < 4; i++ {
		switch resp := <-results; {
		case resp.status == 201:
			created++
		case resp.status == 409 && draftFlowCatalogCode(t, resp.body) == "already_published":
			conflicts++
		default:
			t.Fatalf("unexpected answer: %d %s", resp.status, resp.body)
		}
	}
	if created != 1 || conflicts != 3 || f.count(`SELECT count(*) FROM vacancy_public_projections WHERE id=$1`, id) != 1 ||
		f.count(`SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='VacancyPublished'`, id) != 1 {
		t.Fatalf("created %d, conflicts %d", created, conflicts)
	}
}

func TestReplacementPublishedAdApplicantsIgnoreCarriedParticipations(t *testing.T) {
	f := newCarryFlow(t)
	src, _ := f.draftWithConfiguration()
	f.closeIt(src, "finish")
	f.cover(src)
	credit := f.credit(src, "did_not_hold")
	s := replStages(src)
	at := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Microsecond)

	// Ten earlier candidates, all carried into the replacement.
	items := make([]string, 10)
	for i := range items {
		person := f.manual("Carried " + uuid.NewString()[:8])
		f.participate(src, person, s["screening"], at)
		items[i] = carriedItem(person, s["screening"])
	}
	out := f.startOK(src, replBody(t, carriedJSON(items...)+`,"publish":true`, credit))
	id := out["id"].(string)
	n := replStages(id)
	if got := f.count(`SELECT count(*) FROM process_participations WHERE process_id=$1 AND carried_from_participation_id IS NOT NULL`, id); got != 10 {
		t.Fatalf("carried = %d", got)
	}
	applicants := func() any {
		ad, _ := publicAd(t, f.replFlow, id)
		return ad["applicants"]
	}
	// An ordinary ad with no applicants says «under_10»; ten carried rows must not change that.
	if got := applicants(); got != "under_10" {
		t.Fatalf("applicants = %v with only carried participations", got)
	}
	// Real applicants still count, exactly like on an ordinary ad: nine more stay under ten, the tenth reaches it.
	for i := 0; i < 9; i++ {
		f.participate(id, f.manual("Applicant "+uuid.NewString()[:8]), n["new"], at)
	}
	if got := applicants(); got != "under_10" {
		t.Fatalf("applicants = %v with nine applicants and ten carried", got)
	}
	f.participate(id, f.manual("Applicant "+uuid.NewString()[:8]), n["new"], at)
	if got := applicants(); got != "10_plus" {
		t.Fatalf("applicants = %v with ten applicants", got)
	}
	listed := publicFlowGet(t, f.h, "/v2/jobs?company_id="+f.company.companyID.String()+"&limit=50", 200)["items"].([]any)
	for _, raw := range listed {
		if item := raw.(map[string]any); item["id"] == id && item["applicants"] != "10_plus" {
			t.Fatalf("the catalog applicants = %v", item["applicants"])
		}
	}
}
