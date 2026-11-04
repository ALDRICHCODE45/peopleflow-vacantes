//go:build integration

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"

	boardapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	poolpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/pool"
	companiesentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	draftstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/google/uuid"
)

// Talent base gate, redaction, in-transaction re-check and cleanup
// (contract talent-base-visibility-v1, «What changes for a user without access»).
// Helpers (tbSet, tbGet, ...) live in talent_base_visibility_integration_test.go.

// --- talent base gate on the company-wide candidate routes -------------------

// tbPoolFixture is a company with a published vacancy, one manual candidate in it
// and three actors: the owner, `recruiter` (outside any list) and `listed`.
type tbPoolFixture struct {
	*candidateCVFixture
	listed  draftFlowActor
	vacancy string
}

func newTbPoolFixture(t *testing.T) *tbPoolFixture {
	t.Helper()
	f := newCandidateCVFixture(t, "manual")
	listedID, listedSub := f.company.addUser(t, "recruiter")
	var vacancy uuid.UUID
	if err := f.h.pool.QueryRow(context.Background(), `SELECT process_id FROM process_participations WHERE id=$1`, f.pid).Scan(&vacancy); err != nil {
		t.Fatal(err)
	}
	return &tbPoolFixture{candidateCVFixture: f, listed: f.h.actor(t, listedID, listedSub), vacancy: vacancy.String()}
}

type tbRoute struct {
	name, method, path, body string
	// status each member with access gets on the real candidate and on a random id.
	real, random int
}

// routes are the nine company-wide candidate routes. PATCH and POST cv carry no
// If-Match, so a 428 proves the request got past the gate and a 403 proves the
// gate ran before the If-Match check.
func (f *tbPoolFixture) routes() []tbRoute {
	base := orgCandidatesPath + "/manual/" + f.id.String()
	other := orgCandidatesPath + "/manual/" + uuid.NewString()
	part := "/participations/" + f.pid.String()
	otherPart := "/participations/" + uuid.NewString()
	contacts := func(id string) string { return `{"candidates":[{"kind":"manual","id":"` + id + `"}]}` }
	return []tbRoute{
		{"search", "GET", orgCandidatesPath, "", 200, 200},
		{"summary", "GET", orgCandidatesPath + "/summary", "", 200, 200},
		{"contacts", "POST", orgCandidatesPath + "/contacts", contacts(f.id.String()), 200, 200},
		{"detail", "GET", base, "", 200, 404},
		{"edit", "PATCH", base, `{"set":{}}`, 428, 428},
		{"history", "GET", base + "/history", "", 200, 404},
		{"cv", "GET", base + part + "/cv", "", 200, 404},
		{"cv original", "GET", base + part + "/cv/original", "", 200, 404},
		{"replace cv", "POST", base + part + "/cv", "", 428, 428},
		// random variants: same route shapes with ids that do not exist
		{"detail random", "GET", other, "", 200, 404},
		{"history random", "GET", other + "/history", "", 200, 404},
		{"cv random", "GET", other + otherPart + "/cv", "", 200, 404},
		{"cv original random", "GET", other + otherPart + "/cv/original", "", 200, 404},
		{"edit random", "PATCH", other, `{"set":{}}`, 428, 428},
		{"replace cv random", "POST", other + otherPart + "/cv", "", 428, 428},
	}
}

func (f *tbPoolFixture) assertAccess(t *testing.T, actor draftFlowActor, allowed bool) {
	t.Helper()
	for _, route := range f.routes() {
		r := f.h.do(t, route.method, route.path, route.body, actor.token, nil)
		draftFlowAssertNoStore(t, r)
		if !allowed {
			draftFlowAssertCatalogError(t, r, 403, "talent_base_restricted")
			if draftFlowObject(t, r.body)["error"] != "the company owner restricted the talent base" {
				t.Fatalf("%s: %s", route.name, r.body)
			}
			continue
		}
		want := route.real
		if strings.HasSuffix(route.name, "random") {
			want = route.random
		}
		if r.status != want {
			t.Fatalf("%s %s %s: status=%d want %d body=%s", route.name, route.method, route.path, r.status, want, r.body)
		}
	}
}

func TestTalentBaseVisibility_PoolRoutesAnswer403BeforeAnyLookup(t *testing.T) {
	f := newTbPoolFixture(t)
	f.assertAccess(t, f.recruiter, true) // today's behavior: everybody in the company

	tbSet(t, f.h, f.owner, "selected_users", f.listed.userID)
	f.assertAccess(t, f.recruiter, false)
	f.assertAccess(t, f.listed, true)
	f.assertAccess(t, f.owner, true)

	// D1: an empty selection is valid and only the owner sees the base.
	tbSet(t, f.h, f.owner, "selected_users")
	f.assertAccess(t, f.recruiter, false)
	f.assertAccess(t, f.listed, false)
	f.assertAccess(t, f.owner, true)

	tbSet(t, f.h, f.owner, "all_recruiters")
	f.assertAccess(t, f.recruiter, true)
	f.assertAccess(t, f.listed, true)

	anonymous := f.h.do(t, "GET", orgCandidatesPath, "", "", nil)
	draftFlowAssertError(t, anonymous, 401, "unauthenticated")
}

func TestTalentBaseVisibility_RestrictedRecruiterKeepsTheirVacancy(t *testing.T) {
	f := newTbPoolFixture(t)
	offboardTeamWrite(t, f.h, f.owner, f.vacancy, "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, f.recruiter.userID))
	tbSet(t, f.h, f.owner, "selected_users", f.listed.userID)

	base := draftFlowV2Path + "/" + f.vacancy
	part := base + "/participations/" + f.pid.String()
	for _, path := range []string{base + "/board", part, part + "/history", part + "/cv", part + "/cv/original"} {
		r := f.h.do(t, "GET", path, "", f.recruiter.token, nil)
		if r.status != 200 {
			t.Fatalf("GET %s: %d %s", path, r.status, r.body)
		}
	}
	// The same candidate outside the vacancy stays closed.
	draftFlowAssertCatalogError(t, f.h.do(t, "GET", f.path, "", f.recruiter.token, nil), 403, "talent_base_restricted")
}

func TestTalentBaseVisibility_DuplicatesCheckRedactsLastVacancy(t *testing.T) {
	f := newTbPoolFixture(t)
	for _, actor := range []draftFlowActor{f.recruiter, f.listed} {
		offboardTeamWrite(t, f.h, f.owner, f.vacancy, "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, actor.userID))
	}
	path := draftFlowV2Path + "/" + f.vacancy + "/pipeline/candidates/manual/duplicates-check"
	body := fmt.Sprintf(`{"email":%q,"phone":null}`, f.email)
	match := func(actor draftFlowActor) map[string]any {
		t.Helper()
		r := f.h.do(t, "POST", path, body, actor.token, nil)
		draftFlowAssertNoStore(t, r)
		if r.status != 200 {
			t.Fatalf("%d %s", r.status, r.body)
		}
		matches := orgCandidateKeys(t, draftFlowObject(t, r.body), "matches")["matches"].([]any)
		if len(matches) != 1 {
			t.Fatal(string(r.body))
		}
		return orgCandidateKeys(t, matches[0], "kind", "id", "full_name", "email_masked", "phone_masked", "last_vacancy", "last_added_at", "in_this_process")
	}

	full := match(f.recruiter) // everybody has access by default
	if full["last_vacancy"] == nil || full["last_added_at"] == nil || full["id"] != f.id.String() || full["in_this_process"] != true {
		t.Fatal(full)
	}
	editJSONEqual(t, full["last_vacancy"].(map[string]any)["id"], f.vacancy)

	tbSet(t, f.h, f.owner, "selected_users", f.listed.userID)
	redacted := match(f.recruiter)
	if redacted["last_vacancy"] != nil || redacted["last_added_at"] != nil {
		t.Fatalf("restricted recruiter must not see the last vacancy: %v", redacted)
	}
	for _, key := range []string{"kind", "id", "full_name", "email_masked", "phone_masked", "in_this_process"} {
		editJSONEqual(t, redacted[key], full[key])
	}
	for _, actor := range []draftFlowActor{f.listed, f.owner} {
		editJSONEqual(t, match(actor), full)
	}
}

// tbManualIntake posts a manual candidate whose email matches the fixture candidate,
// which answers 409 possible_duplicates unless it is confirmed distinct.
func (f *tbPoolFixture) manualIntake(t *testing.T, actor draftFlowActor) draftFlowResponse {
	t.Helper()
	stage := pipelineconfig.Defaults(uuid.MustParse(f.vacancy)).Stages[3].ID
	data := fmt.Sprintf(`{"stage_id":%q,"existing":null,"confirmed_distinct":false,"candidate":{"full_name":"Manual Candidate","education":[{"level":"bachelor","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null}],"years_of_experience":"1.5","seniority":"junior","languages":[{"code":"es","level":"native"}],"email":%q,"phone":null,"residence":{"country":"US"}}}`, stage, f.email)
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	field, err := m.CreateFormField("data")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = field.Write([]byte(data))
	file, err := m.CreateFormFile("cv", "resume.pdf")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("%PDF-1 manual HTTP upload"))
	if err = m.Close(); err != nil {
		t.Fatal(err)
	}
	return f.h.do(t, "POST", draftFlowV2Path+"/"+f.vacancy+"/pipeline/candidates/manual", b.String(), actor.token, map[string]string{"Idempotency-Key": uuid.NewString(), "Content-Type": m.FormDataContentType()})
}

// The 409 possible_duplicates warning of manual intake carries the same matches
// as duplicates-check, so it gets the same redaction.
func TestTalentBaseVisibility_ManualIntakeWarningRedactsLastVacancy(t *testing.T) {
	f := newTbPoolFixture(t)
	for _, actor := range []draftFlowActor{f.recruiter, f.listed} {
		offboardTeamWrite(t, f.h, f.owner, f.vacancy, "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, actor.userID))
	}
	match := func(actor draftFlowActor) map[string]any {
		t.Helper()
		r := f.manualIntake(t, actor)
		draftFlowAssertCatalogError(t, r, 409, "possible_duplicates")
		matches := orgCandidateKeys(t, draftFlowObject(t, r.body)["data"], "matches")["matches"].([]any)
		if len(matches) != 1 {
			t.Fatal(string(r.body))
		}
		return orgCandidateKeys(t, matches[0], "kind", "id", "full_name", "email_masked", "phone_masked", "last_vacancy", "last_added_at", "in_this_process")
	}
	full := match(f.recruiter) // everybody has access by default
	if full["last_vacancy"] == nil || full["last_added_at"] == nil {
		t.Fatal(full)
	}
	tbSet(t, f.h, f.owner, "selected_users", f.listed.userID)
	redacted := match(f.recruiter)
	if redacted["last_vacancy"] != nil || redacted["last_added_at"] != nil {
		t.Fatalf("restricted recruiter must not see the last vacancy: %v", redacted)
	}
	for _, key := range []string{"kind", "id", "full_name", "email_masked", "phone_masked", "in_this_process"} {
		editJSONEqual(t, redacted[key], full[key])
	}
	editJSONEqual(t, match(f.listed), full)
	editJSONEqual(t, match(f.owner), full)
}

// --- writes re-check the setting inside their transaction ---------------------

func TestTalentBaseVisibility_WritesRecheckInsideTheirTransaction(t *testing.T) {
	f := newTbPoolFixture(t)
	store := poolpostgres.NewStore(f.h.pool, poolStageNames)
	company := f.company.companyID
	ctx := context.Background()
	etag := f.h.do(t, "GET", f.path, "", f.owner.token, nil).header.Get("ETag")
	tbSet(t, f.h, f.owner, "selected_users", f.listed.userID)

	// Called below the router, so only the store's own re-check can refuse.
	_, err := store.Edit(ctx, company, f.recruiter.userID, f.id, etag, []byte(`{"set":{"current_company":"Leaked Co"}}`))
	if !errors.Is(err, companiesentities.ErrTalentBaseRestricted) {
		t.Fatalf("Edit by an unlisted recruiter: %v", err)
	}
	_, err = store.Edit(ctx, company, f.recruiter.userID, uuid.New(), etag, []byte(`{}`))
	if !errors.Is(err, companiesentities.ErrTalentBaseRestricted) {
		t.Fatalf("Edit of a missing candidate must not reveal it: %v", err)
	}
	_, err = store.CorrectCV(ctx, company, f.recruiter.userID, "manual", f.id, f.pid, etag, boardapp.ManualInput{}, nil, nil)
	if !errors.Is(err, companiesentities.ErrTalentBaseRestricted) {
		t.Fatalf("CorrectCV by an unlisted recruiter: %v", err)
	}
	if after := f.h.do(t, "GET", f.path, "", f.owner.token, nil); after.header.Get("ETag") != etag || strings.Contains(string(after.body), "Leaked Co") {
		t.Fatalf("a refused write changed the candidate: %s", after.body)
	}

	// Listed users and the owner still write.
	edit := f.h.do(t, "PATCH", f.path, `{"set":{"current_company":"Listed Co"}}`, f.listed.token, map[string]string{"If-Match": etag})
	if edit.status != 200 {
		t.Fatalf("listed edit: %d %s", edit.status, edit.body)
	}
}

func TestTalentBaseVisibility_OrganicEditRechecksInsideTransaction(t *testing.T) {
	f := newOrganicEditFixture(t)
	store := poolpostgres.NewStore(f.h.pool, poolStageNames)
	etag := f.detail(t).header.Get("ETag")
	tbSet(t, f.h, f.owner, "selected_users")
	_, err := store.EditOrganic(context.Background(), f.company.companyID, f.recruiter.userID, f.id, etag, []byte(`{"set":{"current_company":"Leaked Co"}}`))
	if !errors.Is(err, companiesentities.ErrTalentBaseRestricted) {
		t.Fatalf("EditOrganic by an unlisted recruiter: %v", err)
	}
	if n := draftFlowCount(t, f.h.pool, `SELECT count(*) FROM company_candidate_corrections WHERE company_id=$1 AND user_id=$2`, f.company.companyID, f.id); n != 0 {
		t.Fatalf("a refused write created a correction row: %d", n)
	}
}

func TestTalentBaseVisibility_RevocationCommittedMidWriteWins(t *testing.T) {
	f := newTbPoolFixture(t)
	store := poolpostgres.NewStore(f.h.pool, poolStageNames)
	etag := f.h.do(t, "GET", f.path, "", f.owner.token, nil).header.Get("ETag")
	tbSet(t, f.h, f.owner, "all_recruiters") // creates the settings row

	// An owner revocation in flight: uncommitted, holding the settings row.
	ctx := context.Background()
	revoke, err := f.h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer revoke.Rollback(ctx)
	if _, err = revoke.Exec(ctx, `UPDATE company_talent_base_settings SET mode='selected_users',version=version+1 WHERE company_id=$1`, f.company.companyID); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := store.Edit(ctx, f.company.companyID, f.recruiter.userID, f.id, etag, []byte(`{"set":{"current_company":"Late Co"}}`))
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("the write finished while the revocation was still open: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err = revoke.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-done:
		if !errors.Is(err, companiesentities.ErrTalentBaseRestricted) {
			t.Fatalf("a write that commits after a revocation must be refused, got %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the write never finished")
	}
	if after := f.h.do(t, "GET", f.path, "", f.owner.token, nil); after.header.Get("ETag") != etag {
		t.Fatalf("candidate changed: %s", after.body)
	}
}

// --- member removal and promotion clean the list ------------------------------

func TestTalentBaseVisibility_OffboardRemovesViewerAndAuditsIt(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	leaverID, _ := company.addUser(t, "recruiter")
	stayID, _ := company.addUser(t, "recruiter")
	plainID, _ := company.addUser(t, "recruiter")
	tbSet(t, h, owner, "selected_users", leaverID, stayID)

	offboard := func(user uuid.UUID) draftFlowResponse {
		t.Helper()
		path := offboardPath(t, h, user)
		r := h.do(t, "POST", path+"/offboard", `{}`, owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
		if r.status != 200 {
			t.Fatalf("offboard %d %s", r.status, r.body)
		}
		return r
	}
	metadata := func(user uuid.UUID, removed bool) map[string]any {
		return map[string]any{"company_id": company.companyID.String(), "user_id": user.String(), "reassignment_ids": []any{}, "ended_assignment_ids": []any{}, "talent_base_viewer_removed": removed}
	}
	membership := func(user uuid.UUID) string { return memberGuardID(t, h.pool, user).String() }

	leaverMembership := membership(leaverID)
	offboard(leaverID)
	after := tbGet(t, h, owner)
	editJSONEqual(t, tbViewerIDs(t, after.body), []string{stayID.String()})
	offboardAssertAudit(t, h, ownerID, "CompanyMemberOffboarded", "company_member", leaverMembership, metadata(leaverID, true))

	// Someone who was never listed: the key is present and false.
	plainMembership := membership(plainID)
	offboard(plainID)
	offboardAssertAudit(t, h, ownerID, "CompanyMemberOffboarded", "company_member", plainMembership, metadata(plainID, false))
	editJSONEqual(t, tbViewerIDs(t, tbGet(t, h, owner).body), []string{stayID.String()})

	// The last viewer leaving keeps the mode: an empty list, only the owner sees the base.
	offboard(stayID)
	doc := draftFlowObject(t, tbGet(t, h, owner).body)
	if doc["mode"] != "selected_users" || len(doc["viewers"].([]any)) != 0 {
		t.Fatalf("%v", doc)
	}
	if n := len(tbAudit(t, h, company.companyID)); n != 1 {
		t.Fatalf("cleanup must not write TalentBaseVisibilityChanged, got %d events", n)
	}
}

func TestTalentBaseVisibility_RemovingAMemberDropsTheViewerWithoutAnEvent(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	leaverID, _ := company.addUser(t, "recruiter")
	tbSet(t, h, owner, "selected_users", leaverID)
	membership := memberGuardID(t, h.pool, leaverID).String()

	r := h.do(t, "DELETE", "/me/company/members/"+membership, "", owner.token, nil)
	if r.status != http.StatusNoContent && r.status != http.StatusOK {
		t.Fatalf("remove %d %s", r.status, r.body)
	}
	editJSONEqual(t, tbViewerIDs(t, tbGet(t, h, owner).body), []string{})
	if n := draftFlowAuditCount(t, h.pool, uuid.MustParse(membership), "CompanyMemberOffboarded"); n != 0 {
		t.Fatalf("plain removal emits no member event, got %d", n)
	}
}

func TestTalentBaseVisibility_PromotionToOwnerDropsTheViewerRow(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	promotedID, promotedSub := company.addUser(t, "recruiter")
	promoted := h.actor(t, promotedID, promotedSub)
	otherID, _ := company.addUser(t, "recruiter")
	tbSet(t, h, owner, "selected_users", promotedID, otherID)
	role := func(role string) draftFlowResponse {
		return h.do(t, "PATCH", "/me/company/members/"+memberGuardID(t, h.pool, promotedID).String(), `{"role":"`+role+`"}`, owner.token, nil)
	}
	if r := role("owner"); r.status != 200 || len(r.body) != 0 {
		t.Fatalf("promotion changed its response: %d %q", r.status, r.body)
	}
	after := tbGet(t, h, owner)
	editJSONEqual(t, tbViewerIDs(t, after.body), []string{otherID.String()})
	if draftFlowObject(t, after.body)["mode"] != "selected_users" {
		t.Fatal("promotion must not change the mode")
	}

	// Demoting later does not silently restore the old selection.
	if r := role("recruiter"); r.status != 200 {
		t.Fatalf("demotion %d %s", r.status, r.body)
	}
	editJSONEqual(t, tbViewerIDs(t, tbGet(t, h, owner).body), []string{otherID.String()})
	restricted := h.do(t, "GET", orgCandidatesPath+"/summary", "", promoted.token, nil)
	draftFlowAssertCatalogError(t, restricted, 403, "talent_base_restricted")
}

func TestTalentBaseVisibility_RoleChangeWithoutSettingStillWorks(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	memberID, _ := company.addUser(t, "recruiter")
	path := "/me/company/members/" + memberGuardID(t, h.pool, memberID).String()
	for _, role := range []string{"owner", "recruiter"} {
		if r := h.do(t, "PATCH", path, `{"role":"`+role+`"}`, owner.token, nil); r.status != 200 || len(r.body) != 0 {
			t.Fatalf("%s: %d %q", role, r.status, r.body)
		}
	}
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_talent_base_settings WHERE company_id=$1`, company.companyID); n != 0 {
		t.Fatalf("a role change must not create the settings row, got %d", n)
	}
}

// The PUT locks the company row, then the setting; a pool write must take the
// company row first too, or its later FK checks on companies deadlock with it.
func TestTalentBaseVisibility_PutAndPoolWriteDoNotDeadlock(t *testing.T) {
	f := newTbPoolFixture(t)
	ctx := context.Background()
	store := poolpostgres.NewStore(f.h.pool, poolStageNames)
	tbSet(t, f.h, f.owner, "selected_users", f.listed.userID) // version 2
	etag := f.h.do(t, "GET", f.path, "", f.owner.token, nil).header.Get("ETag")
	hold, err := f.h.pool.Begin(ctx) // a concurrent writer of the same candidate
	if err != nil {
		t.Fatal(err)
	}
	defer hold.Rollback(ctx)
	if _, err = hold.Exec(ctx, `SELECT 1 FROM company_candidates WHERE id=$1 FOR UPDATE`, f.id); err != nil {
		t.Fatal(err)
	}
	editDone := make(chan error, 1)
	go func() {
		_, err := store.Edit(ctx, f.company.companyID, f.listed.userID, f.id, etag, []byte(`{"set":{"current_company":"Race Co"}}`))
		editDone <- err
	}()
	time.Sleep(300 * time.Millisecond)
	putDone := make(chan draftFlowResponse, 1)
	go func() { putDone <- tbPut(t, f.h, f.owner, `"2"`, tbBody("selected_users")) }()
	time.Sleep(300 * time.Millisecond)
	_ = hold.Rollback(ctx)
	var editErr error
	var put draftFlowResponse
	timeout := time.After(15 * time.Second)
	for got := 0; got < 2; got++ {
		select {
		case editErr = <-editDone:
		case put = <-putDone:
		case <-timeout:
			t.Fatal("hang")
		}
	}
	if editErr != nil || put.status != 200 {
		t.Fatalf("edit=%v put=%d %s", editErr, put.status, put.body)
	}
}

// The dashboard's pool count is the same aggregate as the gated summary: null for
// a user without access, the number for the owner and members with access.
func TestTalentBaseVisibility_DashboardHidesPoolCountWithoutAccess(t *testing.T) {
	f := newTbPoolFixture(t)
	ctx := context.Background()
	store := draftstore.NewDashboardStore(f.h.store, dashboardPoolAdded)
	count := func(actor draftFlowActor) *int64 {
		t.Helper()
		got, err := store.Dashboard(ctx, f.company.companyID, actor.userID)
		if err != nil {
			t.Fatal(err)
		}
		return got.PoolAddedLast7Days
	}
	for _, actor := range []draftFlowActor{f.owner, f.recruiter, f.listed} {
		if got := count(actor); got == nil || *got < 1 {
			t.Fatalf("default access %v", got)
		}
	}
	tbSet(t, f.h, f.owner, "selected_users", f.listed.userID)
	if got := count(f.recruiter); got != nil {
		t.Fatalf("restricted got %d", *got)
	}
	for _, actor := range []draftFlowActor{f.owner, f.listed} {
		if got := count(actor); got == nil || *got < 1 {
			t.Fatalf("with access %v", got)
		}
	}
}
