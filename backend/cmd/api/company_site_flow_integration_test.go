//go:build integration

package main

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	roles "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/google/uuid"
)

// Use the isolated draft harness's pool, JWT signer, actors, HTTP client, and
// fixtures. Compose a fresh production router so no existing harness is edited.
func newCompanySiteFlowHarness(t *testing.T) *draftFlowHarness {
	t.Helper()
	h := newDraftFlowHarness(t)
	q := db.New(h.pool)
	users := identitypostgres.NewUserRepository(q)
	members := companiespostgres.NewCompanyMemberRepository(h.pool)
	companies := companiespostgres.NewCompanyRepository(h.pool, auditpostgres.NewAuditEventRepository())
	router := newRouter(routerDeps{requireAuth: identityhttp.RequireAuth(h.signer.verifier), requireRecruiter: identityhttp.RequireCompanyRole(users, members, companies, roles.RecruiterRole), requireOwner: identityhttp.RequireCompanyRole(users, members, companies, roles.OwnerRole), siteHandler: newCompanySiteHandler(h.pool), queries: q, pool: h.pool})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	h.server = server
	h.client = server.Client()
	return h
}
func siteFlowCleanup(t *testing.T, h *draftFlowHarness, company uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		for _, query := range []string{`DELETE FROM company_site_slug_history WHERE company_id=$1`, `DELETE FROM company_site_media WHERE company_id=$1`, `DELETE FROM company_sites WHERE company_id=$1`} {
			if _, err := h.pool.Exec(context.Background(), query, company); err != nil {
				t.Error(err)
			}
		}
	})
}
func siteFlowDraft(t *testing.T, r draftFlowResponse) map[string]any {
	t.Helper()
	if r.status != 200 {
		t.Fatalf("%d %s", r.status, r.body)
	}
	draftFlowAssertNoStore(t, r)
	m := draftFlowObject(t, r.body)
	draft, ok := m["draft"].(map[string]any)
	if !ok {
		t.Fatal(m)
	}
	return draft
}
func siteFlowBody(t *testing.T, m map[string]any) string {
	t.Helper()
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
func TestCompanySiteFlow(t *testing.T) {
	h := newCompanySiteFlowHarness(t)
	a, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, a.companyID)
	owner := h.actor(t, ownerID, sub)
	b, bID, bSub := draftFlowNewPrincipal(t, h.pool, "active")
	siteFlowCleanup(t, h, b.companyID)
	other := h.actor(t, bID, bSub)
	const path = "/v2/me/company/site"
	first := h.do(t, "GET", path, "", owner.token, nil)
	doc := siteFlowDraft(t, first)
	if first.header.Get("ETag") != `"1"` {
		t.Fatal(first.header)
	}
	env := draftFlowObject(t, first.body)
	if env["published"] != nil || env["has_unpublished_changes"] != true || len(env["media"].([]any)) != 0 {
		t.Fatal(env)
	}
	repeat := h.do(t, "GET", path, "", owner.token, nil)
	if string(repeat.body) != string(first.body) {
		t.Fatal("lazy create not stable")
	}
	slug := "site-" + a.companyID.String()
	doc["slug"] = slug
	body := siteFlowBody(t, doc)
	save := h.do(t, "PUT", path+"/draft", body, owner.token, map[string]string{"If-Match": `"1"`})
	siteFlowDraft(t, save)
	if save.header.Get("ETag") != `"2"` {
		t.Fatalf("%d %s", save.status, save.body)
	}
	noop := h.do(t, "PUT", path+"/draft", body, owner.token, map[string]string{"If-Match": `"2"`})
	if string(noop.body) != string(save.body) || noop.header.Get("ETag") != `"2"` {
		t.Fatal("not a no-op", noop.status, string(noop.body))
	}
	doc["slug"] = "different-" + a.companyID.String()
	stale := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": `"1"`})
	draftFlowAssertError(t, stale, 412, "version_conflict")
	if stale.header.Get("ETag") != `"2"` {
		t.Fatal(stale.header)
	}
	after := h.do(t, "GET", path, "", owner.token, nil)
	if string(after.body) != string(save.body) {
		t.Fatal("stale save mutated data")
	}
	current := draftFlowObject(t, stale.body)["current"]
	expected := draftFlowObject(t, save.body)
	if siteFlowBody(t, current.(map[string]any)) != siteFlowBody(t, expected) {
		t.Fatal("stale current differs")
	}
	ownAvailable := h.do(t, "GET", path+"/slug-availability?slug="+slug, "", owner.token, nil)
	if draftFlowObject(t, ownAvailable.body)["available"] != true {
		t.Fatal(string(ownAvailable.body))
	}
	otherGet := h.do(t, "GET", path, "", other.token, nil)
	otherDoc := siteFlowDraft(t, otherGet)
	if otherDoc["slug"] != nil {
		t.Fatal("foreign company leaked")
	}
	otherDoc["slug"] = slug
	taken := h.do(t, "PUT", path+"/draft", siteFlowBody(t, otherDoc), other.token, map[string]string{"If-Match": `"1"`})
	draftFlowAssertError(t, taken, 409, "slug_taken")
	otherAvailable := h.do(t, "GET", path+"/slug-availability?slug="+slug, "", other.token, nil)
	if draftFlowObject(t, otherAvailable.body)["reason"] != "taken" {
		t.Fatal(string(otherAvailable.body))
	}
	recruiterID, recruiterSub := a.addUser(t, "recruiter")
	recruiter := h.actor(t, recruiterID, recruiterSub)
	doc["slug"] = slug
	doc["seo"].(map[string]any)["title"] = "Recruiter edit"
	recruiterSave := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), recruiter.token, map[string]string{"If-Match": `"2"`})
	siteFlowDraft(t, recruiterSave)
	if recruiterSave.header.Get("ETag") != `"3"` {
		t.Fatal(recruiterSave.header)
	}
	foreignAfter := h.do(t, "GET", path, "", other.token, nil)
	if string(foreignAfter.body) != string(otherGet.body) {
		t.Fatal("foreign mutation")
	}
	// A company-owned cover is accepted; a different company's cover and a
	// matching-company wrong-kind reference both fail without advancing version.
	mediaID := uuid.New()
	if _, err := h.pool.Exec(context.Background(), `INSERT INTO company_site_media(id,company_id,kind,storage_key,content_type,width,height,byte_size,created_by) VALUES($1,$2,'cover','test-key','image/png',200,200,100,$3)`, mediaID, b.companyID, bID); err != nil {
		t.Fatal(err)
	}
	hero := doc["blocks"].([]any)[0].(map[string]any)["content"].(map[string]any)
	hero["cover"] = map[string]any{"media_id": mediaID.String()}
	foreignMedia := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": `"3"`})
	draftFlowAssertError(t, foreignMedia, 400, "validation_error")
	if _, err := h.pool.Exec(context.Background(), `UPDATE company_site_media SET company_id=$2,created_by=$3,kind='portrait' WHERE id=$1`, mediaID, a.companyID, ownerID); err != nil {
		t.Fatal(err)
	}
	wrongKind := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": `"3"`})
	draftFlowAssertError(t, wrongKind, 400, "validation_error")
	if _, err := h.pool.Exec(context.Background(), `UPDATE company_site_media SET kind='cover' WHERE id=$1`, mediaID); err != nil {
		t.Fatal(err)
	}
	withMedia := h.do(t, "PUT", path+"/draft", siteFlowBody(t, doc), owner.token, map[string]string{"If-Match": `"3"`})
	siteFlowDraft(t, withMedia)
	media := draftFlowObject(t, withMedia.body)["media"].([]any)
	if len(media) != 1 || media[0].(map[string]any)["url"] != "/v2/company-sites/media/"+mediaID.String() {
		t.Fatal(media)
	}
}
