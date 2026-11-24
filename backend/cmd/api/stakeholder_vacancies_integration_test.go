//go:build integration

package main

import (
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
)

// GET /v2/me/company/stakeholder/vacancies through the production router (docs/contracts/placement-vacancy-documents-v1.md,
// P7c, L20): the stakeholder's own list of vacancies, never-published drafts included, with the lifecycle header values, the
// job-drafts list's coverage and the number of documents. Real RequireAuth, real RequireMetricsViewer, the real draftstore, isolated
// PostgreSQL. The job-drafts list is mounted on the same router so every row is compared with the row the owner's list shows.

var svCountKeys = []string{"active", "all", "closed", "draft", "paused"}

var stakeholderRowKeys = []string{"close_reason", "coverage", "documents_count", "id", "kind", "process", "publication", "title", "visibility"}

type svFlow struct {
	*docsFlow
	sv *draftFlowHarness
}

func newSVFlow(t *testing.T) *svFlow {
	t.Helper()
	f := &svFlow{docsFlow: newDocsFlow(t)}
	h := f.h
	queries := db.New(h.pool)
	users := identitypostgres.NewUserRepository(queries)
	members := companiespostgres.NewCompanyMemberRepository(h.pool, auditpostgres.NewAuditEventRepository())
	companies := companiespostgres.NewCompanyRepository(h.pool, auditpostgres.NewAuditEventRepository())
	router := newRouter(routerDeps{
		requireAuth:                 identityhttp.RequireAuth(h.signer.verifier),
		requireRecruiter:            identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.RecruiterRole),
		requireOwner:                identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.OwnerRole),
		requireMetricsViewer:        identityhttp.RequireMetricsViewer(users, members, companies),
		draftListHandler:            jobshttp.NewDraftListHandler(h.store),
		stakeholderVacanciesHandler: jobshttp.NewStakeholderVacanciesHandler(h.store),
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	copied := *h
	copied.server, copied.client = server, server.Client()
	f.sv = &copied
	return f
}

func (f *svFlow) get(token, query string) draftFlowResponse {
	f.t.Helper()
	path := stakeholderVacanciesURL
	if query != "" {
		path += "?" + query
	}
	return f.sv.do(f.t, "GET", path, "", token, nil)
}

func (f *svFlow) page(token, query string) map[string]any {
	f.t.Helper()
	got := f.get(token, query)
	draftFlowAssertNoStore(f.t, got)
	if got.status != 200 {
		f.t.Fatalf("GET stakeholder/vacancies?%s: %d %s", query, got.status, got.body)
	}
	body := draftFlowObject(f.t, got.body)
	if !reflect.DeepEqual(docsSorted(body), []string{"counts_by_status", "items", "next_cursor"}) {
		f.t.Fatalf("envelope keys: %v", docsSorted(body))
	}
	// counts_by_status is an object on the first page and null on every cursor page.
	if counts, ok := body["counts_by_status"].(map[string]any); strings.Contains(query, "cursor=") {
		if body["counts_by_status"] != nil {
			f.t.Fatalf("cursor page counts_by_status = %v, want null", body["counts_by_status"])
		}
	} else if !ok || !reflect.DeepEqual(docsSorted(counts), svCountKeys) {
		f.t.Fatalf("first page counts_by_status = %v", body["counts_by_status"])
	}
	return body
}

func svRows(body map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, raw := range body["items"].([]any) {
		out = append(out, raw.(map[string]any))
	}
	return out
}

// all follows the cursor until the end with the given page size and returns every row in the order served.
func (f *svFlow) all(token string, limit string) []map[string]any {
	f.t.Helper()
	out := []map[string]any{}
	query := "limit=" + limit
	for pages := 0; pages < 100; pages++ {
		body := f.page(token, query)
		out = append(out, svRows(body)...)
		next, _ := body["next_cursor"].(string)
		if next == "" {
			return out
		}
		query = "limit=" + limit + "&cursor=" + next
	}
	f.t.Fatal("pagination did not end")
	return nil
}

// list is the owner's job-drafts list: every row, in its order.
func (f *svFlow) list(token string) []map[string]any {
	f.t.Helper()
	got := f.sv.do(f.t, "GET", draftFlowV2Path+"?limit=50", "", token, nil)
	if got.status != 200 {
		f.t.Fatalf("job-drafts list: %d %s", got.status, got.body)
	}
	return svRows(draftFlowObject(f.t, got.body))
}

func svIDs(rows []map[string]any) []string {
	out := []string{}
	for _, r := range rows {
		out = append(out, r["id"].(string))
	}
	return out
}

func svByID(rows []map[string]any) map[string]map[string]any {
	out := map[string]map[string]any{}
	for _, r := range rows {
		out[r["id"].(string)] = r
	}
	return out
}

func (f *svFlow) setUpdated(draft string, at time.Time) {
	f.exec(`UPDATE job_drafts SET updated_at=$2 WHERE id=$1`, draft, at)
}

// The list of the owner and of the stakeholder: every vacancy of the company in seven lifecycle states, never-published draft
// included, each row with the lifecycle's own values (read from GET V/lifecycle and from the job-drafts list), identical for both.
func TestStakeholderVacancies_OwnerAndStakeholderSeeEveryVacancyIncludingNeverPublished(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")

	never := f.draft()
	published := f.published()
	paused := f.published()
	if got := f.transition(paused, "pause", `{}`); got.status != 200 {
		t.Fatalf("pause: %d %s", got.status, got.body)
	}
	closedContinue := f.published()
	f.closeIt(closedContinue, "continue") // reason cancelled
	finished, replacement := f.chain2()   // the original closed with the process finished; the replacement published
	f.cover(finished)                     // its close reason is filled
	private := f.published()
	f.link(private, finished, finished, 2)
	f.exec(`DELETE FROM vacancy_public_projections WHERE id=$1`, private)

	type want struct {
		publication, process, kind, visibility, closeReason any
	}
	wants := map[string]want{
		never:          {nil, nil, "original", nil, nil},
		published:      {"published", "active", "original", "public", nil},
		paused:         {"paused", "active", "original", "public", nil},
		closedContinue: {"closed", "active", "original", "public", "cancelled"},
		finished:       {"closed", "finished", "original", "public", "filled"},
		replacement:    {"published", "active", "replacement", "public", nil},
		private:        {"published", "active", "replacement", "private", nil},
	}

	owner := f.all(f.owner.token, "50")
	stake := f.all(stakeholder.token, "50")
	if !reflect.DeepEqual(owner, stake) {
		t.Fatalf("the owner and the stakeholder see different lists:\n%v\n%v", owner, stake)
	}
	got := svByID(owner)
	if len(owner) != len(wants) || len(got) != len(wants) {
		t.Fatalf("rows: %d, want %d: %v", len(owner), len(wants), svIDs(owner))
	}
	listRows := f.list(f.owner.token)
	if !reflect.DeepEqual(svIDs(owner), svIDs(listRows)) {
		t.Fatalf("order %v differs from the job-drafts list %v", svIDs(owner), svIDs(listRows))
	}
	listed := svByID(listRows)
	for id, w := range wants {
		row, ok := got[id]
		if !ok {
			t.Fatalf("vacancy %s missing", id)
		}
		if !reflect.DeepEqual(docsSorted(row), stakeholderRowKeys) {
			t.Fatalf("row keys: %v", docsSorted(row))
		}
		for key, value := range map[string]any{"publication": w.publication, "process": w.process, "kind": w.kind, "visibility": w.visibility, "close_reason": w.closeReason} {
			if row[key] != value {
				t.Errorf("%s: %s = %v, want %v", id, key, row[key], value)
			}
		}
		// the same values GET V/lifecycle answers, and the job-drafts list row's
		if _, life := f.view(id); id != never {
			for _, key := range []string{"publication", "process", "kind", "visibility", "close_reason"} {
				if row[key] != life[key] {
					t.Errorf("%s: %s = %v, lifecycle says %v", id, key, row[key], life[key])
				}
			}
		}
		l := listed[id]
		if row["title"] != l["title"] || row["kind"] != l["kind"] || row["visibility"] != l["visibility"] || row["process"] != l["process"] || row["close_reason"] != l["close_reason"] {
			t.Errorf("%s: row %v differs from the list row %v", id, row, l)
		}
		if row["publication"] != nil && row["publication"] != l["status"] || row["publication"] == nil && l["status"] != "draft" {
			t.Errorf("%s: publication %v, list status %v", id, row["publication"], l["status"])
		}
		if row["documents_count"] != float64(0) {
			t.Errorf("%s: documents_count = %v, want 0", id, row["documents_count"])
		}
	}
	if got[never]["coverage"] != nil {
		t.Errorf("never published: coverage = %v, want null", got[never]["coverage"])
	}
	if got[published]["title"] != "Backend Go" {
		t.Errorf("title = %v", got[published]["title"])
	}
}

// Only the owner and the stakeholder: a recruiter is refused exactly like on the metrics routes, on the team or not.
func TestStakeholderVacancies_RecruiterAndStrangersAreRefused(t *testing.T) {
	f := newSVFlow(t)
	responsible := f.member("recruiter")
	draft := publicationFlowReady(t, f.h, responsible)
	recruiter := f.member("recruiter")
	stranger, strangerSub := draftFlowInsertUser(t, f.h.pool) // a user of no company
	strangerActor := f.h.actor(t, stranger, strangerSub)

	metrics := f.sv.do(t, "GET", "/v2/me/company/metrics/vacancies", "", responsible.token, nil)
	if metrics.status != 403 {
		t.Fatalf("precondition: a recruiter on the metrics route: %d %s", metrics.status, metrics.body)
	}
	for name, actor := range map[string]draftFlowActor{"responsible recruiter": responsible, "other recruiter": recruiter, "user of no company": strangerActor} {
		t.Run(name, func(t *testing.T) {
			got := f.get(actor.token, "")
			if got.status != metrics.status || draftFlowCatalogCode(t, got.body) != draftFlowCatalogCode(t, metrics.body) {
				t.Fatalf("%d %s, want what the metrics routes answer: %d %s", got.status, got.body, metrics.status, metrics.body)
			}
			draftFlowAssertNoStore(t, got)
			if strings.Contains(string(got.body), draft) {
				t.Fatal("a refused answer leaked the vacancy")
			}
		})
	}
	anonymous := f.sv.do(t, "GET", stakeholderVacanciesURL, "", "", nil)
	draftFlowAssertError(t, anonymous, 401, "unauthenticated")
	for _, verb := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		if got := f.sv.do(t, verb, stakeholderVacanciesURL, "{}", f.owner.token, nil); got.status != 405 && got.status != 404 {
			t.Fatalf("%s: %d %s", verb, got.status, got.body)
		}
	}
}

// Another company's vacancies never show, for the owner, the stakeholder or their counts; and each company sees only its own.
func TestStakeholderVacancies_OtherCompanyIsInvisible(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")
	mine := f.published()
	f.insertDocument(mine, "", "Mi contrato", f.owner, f.pdfVersion(1, f.owner))

	other, otherOwnerID, otherSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	otherOwner := f.h.actor(t, otherOwnerID, otherSub)
	otherStakeholderID, otherStakeholderSub := other.addUser(t, "stakeholder")
	otherStakeholder := f.h.actor(t, otherStakeholderID, otherStakeholderSub)
	theirs := publicationFlowReady(t, f.h, otherOwner)
	publicFlowPublish(t, f.h, theirs, otherOwner)
	f.exec(`INSERT INTO placement_documents(id,company_id,draft_id,participation_id,name,created_at,created_by) VALUES(gen_random_uuid(),$1,$2,NULL,'Ajeno',now(),$3)`, other.companyID, theirs, otherOwnerID)
	t.Cleanup(func() { f.exec(`DELETE FROM placement_documents WHERE company_id=$1`, other.companyID) })

	for name, actor := range map[string]draftFlowActor{"owner": f.owner, "stakeholder": stakeholder} {
		rows := f.all(actor.token, "50")
		if !reflect.DeepEqual(svIDs(rows), []string{mine}) || rows[0]["documents_count"] != float64(1) {
			t.Fatalf("%s sees %v", name, rows)
		}
	}
	for name, actor := range map[string]draftFlowActor{"owner": otherOwner, "stakeholder": otherStakeholder} {
		rows := f.all(actor.token, "50")
		if !reflect.DeepEqual(svIDs(rows), []string{theirs}) || rows[0]["documents_count"] != float64(1) {
			t.Fatalf("the other company's %s sees %v", name, rows)
		}
	}
	// a cursor of one company is no key to another's list
	if cursor, _ := f.page(f.owner.token, "limit=1")["next_cursor"].(string); cursor != "" {
		t.Fatal("one vacancy and limit 1 must not give a cursor")
	}
	f.published()
	next := f.page(f.owner.token, "limit=1")["next_cursor"].(string)
	draftFlowAssertError(t, f.get(otherOwner.token, "limit=1&cursor="+next), 400, "invalid_request")
	draftFlowAssertError(t, f.get(otherStakeholder.token, "limit=1&cursor="+next), 400, "invalid_request")
}

// Keyset pagination as the job-drafts list: updated_at DESC, id DESC; the same query parameters, limit bounds and cursor; stable
// over more rows than the limit, with ties on updated_at and a vacancy created in the middle.
func TestStakeholderVacancies_PaginationIsStableWithoutDuplicates(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")
	ids := []string{}
	for i := 0; i < 7; i++ {
		ids = append(ids, f.draft())
	}
	for i, hours := range []int{0, 1, 1, 1, 2, 2, 3} { // ties on updated_at are broken by id
		f.setUpdated(ids[i], docsAt(hours))
	}
	full := f.all(stakeholder.token, "50")
	if len(full) != 7 {
		t.Fatalf("rows: %d", len(full))
	}
	if got := svIDs(full); !reflect.DeepEqual(svIDs(f.list(f.owner.token)), got) {
		t.Fatalf("order %v differs from the job-drafts list %v", got, svIDs(f.list(f.owner.token)))
	}

	for _, limit := range []string{"1", "2", "3", "6", "7", "8"} {
		got := f.all(stakeholder.token, limit)
		if !reflect.DeepEqual(svIDs(got), svIDs(full)) {
			t.Fatalf("limit %s: %v, want %v", limit, svIDs(got), svIDs(full))
		}
	}
	// a page of exactly `limit` rows with nothing after it has no cursor, one with more has it
	if body := f.page(stakeholder.token, "limit=7"); body["next_cursor"] != nil || len(svRows(body)) != 7 {
		t.Fatalf("limit 7: %v", body["next_cursor"])
	}
	first := f.page(stakeholder.token, "limit=3")
	if len(svRows(first)) != 3 || first["next_cursor"] == nil {
		t.Fatalf("limit 3: %v", first)
	}

	// a vacancy created between two pages sorts before the cursor: the rest of the walk neither repeats nor loses a row
	created := f.draft()
	second := f.page(stakeholder.token, "limit=3&cursor="+first["next_cursor"].(string))
	third := f.page(stakeholder.token, "limit=3&cursor="+second["next_cursor"].(string))
	walked := append(append(svIDs(svRows(first)), svIDs(svRows(second))...), svIDs(svRows(third))...)
	if !reflect.DeepEqual(walked, svIDs(full)) || third["next_cursor"] != nil {
		t.Fatalf("walk %v, want %v", walked, svIDs(full))
	}
	if again := f.all(stakeholder.token, "50"); svIDs(again)[0] != created || len(again) != 8 {
		t.Fatalf("a restarted walk must show the new vacancy first: %v", svIDs(again))
	}

	// limit bounds and parameters as the job-drafts list
	for _, query := range []string{"limit=0", "limit=51", "limit=abc", "limit=1&limit=2", "cursor=", "cursor=%25%25", "cursor=%zz"} {
		draftFlowAssertError(t, f.get(stakeholder.token, query), 400, "invalid_request")
	}
	if got := f.page(stakeholder.token, "unknown=1"); len(svRows(got)) != 8 {
		t.Fatalf("default limit with an unknown parameter: %d rows", len(svRows(got)))
	}
	// no filters in v1: the job-drafts filter is just an unknown parameter here
	if got := f.page(stakeholder.token, "root_process_id="+ids[0]+"&status=closed"); len(svRows(got)) != 8 {
		t.Fatalf("a filter must be ignored: %d rows", len(svRows(got)))
	}
	// the cursor is the job-drafts list's own: a cursor issued for another actor is refused
	next := first["next_cursor"].(string)
	draftFlowAssertError(t, f.get(f.owner.token, "limit=3&cursor="+next), 400, "invalid_request")
}

// The coverage of a row is the job-drafts list row's: null without a process, {covered, required} with one, live.
func TestStakeholderVacancies_CoverageEqualsTheJobDraftsListRow(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")
	never := f.draft()
	empty := f.published()
	staffed := f.published()
	stages := replStages(staffed)
	f.participation(staffed, stages["placement"])
	f.participation(staffed, stages["new"])
	gone := f.participation(staffed, stages["placement"])
	f.discarded(staffed, gone) // a discarded participation is no longer in Placement
	closed := f.published()
	f.participation(closed, replStages(closed)["placement"])
	f.closeIt(closed, "continue")
	noHeadcount := f.published()
	f.exec(`DELETE FROM job_draft_management_configs WHERE draft_id=$1`, noHeadcount)

	check := func(label string, want map[string]map[string]any) {
		t.Helper()
		rows := svByID(f.all(stakeholder.token, "50"))
		listed := svByID(f.list(f.owner.token))
		for id, coverage := range want {
			if !reflect.DeepEqual(rows[id]["coverage"], listed[id]["coverage"]) {
				t.Fatalf("%s %s: stakeholder %v, job-drafts list %v", label, id, rows[id]["coverage"], listed[id]["coverage"])
			}
			if !reflect.DeepEqual(rows[id]["coverage"], coverage["want"]) && coverage["want"] != "any" {
				t.Fatalf("%s %s: coverage %v, want %v", label, id, rows[id]["coverage"], coverage["want"])
			}
		}
	}
	var headcount float64
	if err := f.h.pool.QueryRow(t.Context(), `SELECT hiring_headcount FROM job_draft_management_configs WHERE draft_id=$1`, empty).Scan(&headcount); err != nil {
		t.Fatal(err)
	}
	check("first", map[string]map[string]any{
		never:       {"want": nil},
		empty:       {"want": map[string]any{"covered": float64(0), "required": headcount}},
		staffed:     {"want": map[string]any{"covered": float64(1), "required": headcount}},
		closed:      {"want": map[string]any{"covered": float64(1), "required": headcount}},
		noHeadcount: {"want": map[string]any{"covered": float64(0), "required": nil}},
	})

	// live: a second hire reaches Placement
	f.participation(staffed, stages["placement"])
	check("after a hire", map[string]map[string]any{
		staffed: {"want": map[string]any{"covered": float64(2), "required": headcount}},
		empty:   {"want": map[string]any{"covered": float64(0), "required": headcount}},
	})
}

// documents_count is the vacancy's documents plus those of its participations, counted once however many versions they have;
// a link is not a document, and nothing of another vacancy leaks in.
func TestStakeholderVacancies_DocumentsCountExcludesLinksAndCountsParticipations(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")

	solo := f.published()
	stages := replStages(solo)
	p1 := f.participation(solo, stages["new"])
	p2 := f.participation(solo, stages["screening"])
	f.discarded(solo, p2) // a discarded participation's documents still belong to the vacancy
	f.insertDocument(solo, "", "Contrato marco", f.owner, f.pdfVersion(1, f.owner), f.pdfVersion(2, f.owner), f.pdfVersion(3, f.owner))
	f.insertDocument(solo, "", "Anexo", f.owner, f.pdfVersion(4, f.owner))
	f.insertDocument(solo, p1, "CV", f.owner, f.pdfVersion(5, f.owner))
	f.insertDocument(solo, p2, "Carta", f.owner, f.pdfVersion(6, f.owner))
	f.insertDocument(solo, p2, "Otra carta", f.owner, f.pdfVersion(7, f.owner))
	quiet := f.published()

	original, replacement := f.chain2()
	d1, v1 := f.insertDocument(original, "", "Origen 1", f.owner, f.pdfVersion(1, f.owner))
	d2, v2 := f.insertDocument(original, "", "Origen 2", f.owner, f.pdfVersion(2, f.owner))
	f.linkDocument(replacement, d1, v1[0], f.owner, docsAt(3))
	f.linkDocument(replacement, d2, v2[0], f.owner, docsAt(4))
	carried := f.participation(replacement, replStages(replacement)["new"])
	f.linkParticipationDoc(replacement, carried, d1, v1[0], f.owner, 5)

	rows := svByID(f.all(stakeholder.token, "50"))
	for id, want := range map[string]float64{solo: 5, quiet: 0, original: 2, replacement: 0} {
		if rows[id]["documents_count"] != want {
			t.Errorf("%s: documents_count = %v, want %v", id, rows[id]["documents_count"], want)
		}
	}
	// the replacement gains a document of its own and a participation document: links still add nothing
	f.insertDocument(replacement, "", "Propio", f.owner, f.pdfVersion(8, f.owner))
	f.insertDocument(replacement, carried, "Del candidato", f.owner, f.pdfVersion(9, f.owner))
	if got := svByID(f.all(stakeholder.token, "50"))[replacement]["documents_count"]; got != float64(2) {
		t.Errorf("replacement with 3 links and 2 own documents: %v, want 2", got)
	}
	// the count follows a delete
	f.exec(`DELETE FROM placement_documents WHERE draft_id=$1 AND name='Anexo'`, solo)
	if got := svByID(f.all(stakeholder.token, "50"))[solo]["documents_count"]; got != float64(4) {
		t.Errorf("after a delete: %v, want 4", got)
	}
}

// A read changes nothing: no row, no version, no audit event (the metrics reads that audit are the ones with candidate names;
// this list has none).
func TestStakeholderVacancies_ReadLeavesRowsAndAuditUnchanged(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")
	draft := f.published()
	f.insertDocument(draft, "", "Contrato", f.owner, f.pdfVersion(1, f.owner))
	f.participation(draft, replStages(draft)["placement"])
	never := f.draft()

	snapshot, neverSnapshot := f.vacancySnapshot(draft), f.vacancySnapshot(never)
	audits := auditCompanyCount(t, f.h.pool, f.company.companyID)
	documentsRows := f.count(`SELECT count(*) FROM placement_documents WHERE company_id=$1`, f.company.companyID)
	versions := f.count(`SELECT count(*) FROM placement_document_versions WHERE document_id IN (SELECT id FROM placement_documents WHERE company_id=$1)`, f.company.companyID)
	idempotency := f.count(`SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1`, f.company.companyID)

	for _, actor := range []draftFlowActor{f.owner, stakeholder, f.owner, stakeholder} {
		f.all(actor.token, "1")
	}
	if f.vacancySnapshot(draft) != snapshot || f.vacancySnapshot(never) != neverSnapshot {
		t.Fatal("the list changed a vacancy")
	}
	if got := auditCompanyCount(t, f.h.pool, f.company.companyID); got != audits {
		t.Fatalf("audit events %d -> %d", audits, got)
	}
	if f.count(`SELECT count(*) FROM placement_documents WHERE company_id=$1`, f.company.companyID) != documentsRows ||
		f.count(`SELECT count(*) FROM placement_document_versions WHERE document_id IN (SELECT id FROM placement_documents WHERE company_id=$1)`, f.company.companyID) != versions ||
		f.count(`SELECT count(*) FROM job_draft_idempotency WHERE company_id=$1`, f.company.companyID) != idempotency {
		t.Fatal("the list changed documents or idempotency rows")
	}
}

// A company with nothing: an empty array, never null.
func TestStakeholderVacancies_EmptyCompany(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")
	got := f.get(stakeholder.token, "")
	draftFlowAssertNoStore(t, got)
	if got.status != 200 || string(got.body) != `{"items":[],"next_cursor":null,"counts_by_status":{"all":0,"draft":0,"active":0,"paused":0,"closed":0}}`+"\n" {
		t.Fatalf("%d %s", got.status, got.body)
	}
}

// counts_by_status (audit gap D20): exact counts over the list's whole scope on the first page, bucketed by `publication`
// exactly as the tabs bucket the rows (null → draft, published → active, paused → paused, closed → closed, whatever the
// process); null on cursor pages. Owner and stakeholder read the same numbers; another company's vacancies never count.
func TestStakeholderVacancies_CountsByStatusOnTheFirstPage(t *testing.T) {
	f := newSVFlow(t)
	stakeholder := f.member("stakeholder")
	f.draft()
	f.draft()
	f.published()
	f.published()
	paused := f.published()
	if got := f.transition(paused, "pause", `{}`); got.status != 200 {
		t.Fatalf("pause: %d %s", got.status, got.body)
	}
	closedActive := f.published()
	f.closeIt(closedActive, "continue")
	finished := f.published()
	f.closeIt(finished, "finish")
	other := newSVFlow(t)
	other.draft()
	other.published()

	want := map[string]any{"all": float64(7), "draft": float64(2), "active": float64(2), "paused": float64(1), "closed": float64(2)}
	for _, token := range []string{f.owner.token, stakeholder.token} {
		for _, limit := range []string{"1", "3", "50"} {
			first := f.page(token, "limit="+limit)
			if !reflect.DeepEqual(first["counts_by_status"], want) {
				t.Fatalf("limit %s: counts %v, want %v", limit, first["counts_by_status"], want)
			}
		}
		// Every row lands in exactly one bucket, and the buckets agree with the rows.
		rows := f.all(token, "2")
		got := map[string]float64{"all": float64(len(rows))}
		for _, row := range rows {
			switch row["publication"] {
			case nil:
				got["draft"]++
			case "published":
				got["active"]++
			case "paused":
				got["paused"]++
			case "closed":
				got["closed"]++
			}
		}
		editJSONEqual(t, got, want)
	}
	// Writes move the counts on the next first page: pausing an active vacancy.
	active := f.published()
	if got := f.transition(active, "pause", `{}`); got.status != 200 {
		t.Fatalf("pause: %d %s", got.status, got.body)
	}
	want["all"], want["paused"] = float64(8), float64(2)
	if got := f.page(stakeholder.token, "")["counts_by_status"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("after pause %v, want %v", got, want)
	}
}
