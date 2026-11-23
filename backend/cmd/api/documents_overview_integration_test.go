//go:build integration

package main

import (
	"context"
	"fmt"
	"reflect"
	"sort"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	documentspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// GET /v2/me/company/job-drafts/{id}/document-overview through the production router (docs/contracts/placement-vacancy-documents-v1.md,
// P7b, L20): the documents and links of the vacancy and of every participation of it as one table, plus the vacancy header and the
// participations. Real RequireAuth, real RequireDocumentReader, the real documents store over the draft authorization, isolated
// PostgreSQL. Drafts, teams and lifecycle states go through the existing routers and fixtures; documents, links and participations
// are seeded in SQL (their write routes have their own suites). The documents storage is disabled: the overview reads only rows.

func (f *docsFlow) overview(token, draft, query string) draftFlowResponse {
	f.t.Helper()
	path := draftFlowV2Path + "/" + draft + "/document-overview"
	if query != "" {
		path += "?" + query
	}
	return f.docs.do(f.t, "GET", path, "", token, nil)
}

func (f *docsFlow) overviewOK(token, draft, query string) map[string]any {
	f.t.Helper()
	got := f.overview(token, draft, query)
	draftFlowAssertNoStore(f.t, got)
	if got.status != 200 {
		f.t.Fatalf("GET document-overview %s?%s: %d %s", draft, query, got.status, got.body)
	}
	return draftFlowObject(f.t, got.body)
}

func ovRows(body map[string]any, key string) []map[string]any {
	out := []map[string]any{}
	for _, raw := range body[key].([]any) {
		out = append(out, raw.(map[string]any))
	}
	return out
}

func ovNames(body map[string]any) []string {
	return docItemNames(map[string]any{"items": body["items"]})
}

func ovIDs(rows []map[string]any, key string) []string {
	out := []string{}
	for _, r := range rows {
		out = append(out, r[key].(string))
	}
	return out
}

// withoutOwner is a row as GET P/documents shows it: the overview row minus `owner`.
func withoutOwner(row map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range row {
		if k != "owner" {
			out[k] = v
		}
	}
	return out
}

// ownedBy keeps the rows whose owner is the vacancy (pid "") or the participation pid, without their owner.
func ownedBy(rows []map[string]any, pid string) []any {
	out := []any{}
	for _, row := range rows {
		owner := row["owner"].(map[string]any)
		if (pid == "" && owner["kind"] == "vacancy") || (pid != "" && owner["participation_id"] == pid) {
			out = append(out, withoutOwner(row))
		}
	}
	return out
}

func ownerVacancy() map[string]any { return map[string]any{"kind": "vacancy"} }

func (f *docsFlow) ownerOfParticipation(pid string, discarded bool) map[string]any {
	kind, id, name := f.candidateOf(pid)
	return map[string]any{"kind": "participation", "participation_id": pid, "discarded": discarded,
		"candidate": map[string]any{"kind": kind, "id": id, "full_name": name}}
}

// candidateOf is the {kind, id} identity of a participation's candidate and the company's view of the name (the board's: a
// correction of an organic candidate wins over the account's).
func (f *docsFlow) candidateOf(pid string) (kind, id, name string) {
	f.t.Helper()
	var manual, organic *string
	var corrected, account *string
	if err := f.h.pool.QueryRow(context.Background(), `
SELECT p.company_candidate_id::text, p.candidate_id::text, o.corrections->>'full_name', COALESCE(cc.full_name, u.full_name)
  FROM process_participations p
  LEFT JOIN users u ON u.id = p.candidate_id
  LEFT JOIN company_candidates cc ON cc.id = p.company_candidate_id
  LEFT JOIN company_candidate_corrections o ON o.user_id = p.candidate_id
 WHERE p.id = $1`, pid).Scan(&manual, &organic, &corrected, &account); err != nil {
		f.t.Fatal(err)
	}
	name = *account
	if corrected != nil {
		name = *corrected
	}
	if manual != nil {
		return "manual", *manual, name
	}
	return "organic", *organic, name
}

func (f *docsFlow) nameOrganic(pid, name string) {
	f.exec(`UPDATE users SET full_name=$2 WHERE id=(SELECT candidate_id FROM process_participations WHERE id=$1)`, pid, name)
}

// correctName sets the company's correction of an organic candidate's name.
func (f *docsFlow) correctName(pid, name string) {
	f.exec(`INSERT INTO company_candidate_corrections(company_id,user_id,corrections) SELECT $1,candidate_id,jsonb_build_object('full_name',$3::text) FROM process_participations WHERE id=$2`,
		f.company.companyID, pid, name)
	f.t.Cleanup(func() {
		f.exec(`DELETE FROM company_candidate_corrections WHERE company_id=$1 AND corrections->>'full_name'=$2`, f.company.companyID, name)
	})
}

// manualParticipation seeds a participation of a manual candidate (a company candidate) of draft at stage.
func (f *docsFlow) manualParticipation(draft, stage, name string) string {
	f.t.Helper()
	candidate, cv, pid := uuid.NewString(), uuid.NewString(), uuid.NewString()
	f.t.Cleanup(func() { // registered first, so it runs after the participation cleanup below
		f.exec(`DELETE FROM company_candidate_cvs WHERE company_candidate_id=$1`, candidate)
		f.exec(`DELETE FROM company_candidates WHERE id=$1`, candidate)
	})
	f.exec(`INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,professional_title,created_by) VALUES($1,$2,$3,$4,$4,'US','Title',$5)`,
		candidate, f.company.companyID, name, "c-"+candidate+"@example.test", f.owner.userID)
	f.exec(`INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,6,'application/pdf','cv.pdf')`,
		cv, f.company.companyID, candidate, carryKey())
	f.exec(`INSERT INTO process_participations(id,process_id,company_candidate_id,company_candidate_cv_id,stage_id,source,added_by,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel) VALUES($1,$2,$3,$4,$5,'manual',$6,'{`+snapshot00061Fields+`,"professional_title":"Frozen"}','[]','[]','manual')`,
		pid, draft, candidate, cv, stage, f.owner.userID)
	f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,from_stage_id,hire,departure,actor_kind,event_kind) VALUES($1,$2,$3,$4,NULL,false,false,'recruiter','intake')`,
		uuid.New(), pid, stage, f.owner.userID)
	f.t.Cleanup(func() {
		for _, q := range []string{`DELETE FROM placement_document_links WHERE participation_id=$1`, `DELETE FROM placement_documents WHERE participation_id=$1`,
			`DELETE FROM participation_stage_history WHERE participation_id=$1`, `DELETE FROM process_participations WHERE id=$1`} {
			f.exec(q, pid)
		}
	})
	return pid
}

// linkParticipationDoc seeds a link owned by the participation pid of target, pinned to a source version.
func (f *docsFlow) linkParticipationDoc(target, pid, sourceDoc, sourceVersion string, by draftFlowActor, hours int) string {
	f.t.Helper()
	id := uuid.NewString()
	f.exec(`INSERT INTO placement_document_links(id,company_id,draft_id,participation_id,source_document_id,source_version_id,linked_at,linked_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
		id, f.company.companyID, target, pid, sourceDoc, sourceVersion, docsAt(hours), by.userID)
	f.t.Cleanup(func() { f.exec(`DELETE FROM placement_document_links WHERE id=$1`, id) })
	return id
}

func (f *docsFlow) carry(child, parent string) {
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, child, parent)
}

func (f *docsFlow) title(draft string) *string {
	f.t.Helper()
	var title *string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT convert_from(fields,'UTF8')::jsonb->'fields'->>'title' FROM job_drafts WHERE id=$1`, draft).Scan(&title); err != nil {
		f.t.Fatal(err)
	}
	return title
}

func (f *docsFlow) pdfVersion(hours int, by draftFlowActor) docVersion {
	return docVersion{docPDF, int64(100 + hours), docsAt(hours), by}
}

var (
	overviewKeys       = []string{"items", "links", "participations", "scope", "truncated", "vacancy"}
	overviewItemKeys   = append(append([]string{}, docItemKeys...), "owner")
	overviewLinkKeys   = []string{"allowed_actions", "id", "linked_at", "linked_by", "owner", "source", "state"}
	overviewPartKeys   = []string{"candidate", "discarded", "participation_id", "scope_allowed_actions", "stage", "upload_blocked_reason"}
	overviewHeaderKeys = []string{"id", "kind", "process", "publication", "title", "visibility"}
)

func init() {
	for _, keys := range [][]string{overviewKeys, overviewItemKeys, overviewLinkKeys, overviewPartKeys, overviewHeaderKeys} {
		sort.Strings(keys)
	}
}

// --- the table ---------------------------------------------------------------------------------------------------------

// L20: the vacancy's documents and those of every participation (any stage, discarded included) in one newest-first table, each row
// with its owner; the participations with the candidate name as the board's company view shows it, the stage by kind and name
// (a discarded participation shows the stage it was discarded from) and the flags of their own scope. Every row equals what the
// list of its own scope answers, so the overview can never disagree with GET P/documents.
func TestDocumentOverview_OwnerSeesTheVacancyAndEveryParticipationInOneTable(t *testing.T) {
	f := newDocsFlow(t)
	rita := f.name(f.member("recruiter"), "Rita Responsable")
	draft := f.published()
	stages := replStages(draft)

	p1 := f.participation(draft, stages["new"])
	f.nameOrganic(p1, "Zoe Zapata")
	p2 := f.participation(draft, stages["in_process"])
	f.nameOrganic(p2, "Original Account")
	f.correctName(p2, "Nombre Corregido") // the company's correction wins over the account's name
	p3 := f.manualParticipation(draft, stages["placement"], "Ana Manual")
	p4 := f.participation(draft, stages["screening"])
	f.nameOrganic(p4, "Beto Descartado")
	f.discarded(draft, p4)

	f.insertDocument(draft, "", "Contrato marco", f.owner, f.pdfVersion(1, f.owner), f.pdfVersion(6, rita)) // current version at +6h
	f.insertDocument(draft, "", "Anexo", rita, docVersion{docDOCX, 20, docsAt(2), rita})
	f.insertDocument(draft, p1, "CV Zoe", f.owner, f.pdfVersion(4, f.owner))
	f.insertDocument(draft, p3, "Contrato Ana", rita, docVersion{docXLSX, 77, docsAt(8), rita})
	f.insertDocument(draft, p4, "Carta descarte", f.owner, f.pdfVersion(3, f.owner))

	snapshot, audits := f.vacancySnapshot(draft), auditCompanyCount(t, f.h.pool, f.company.companyID)
	body := f.overviewOK(f.owner.token, draft, "")
	if !reflect.DeepEqual(docsSorted(body), overviewKeys) {
		t.Fatalf("keys: %v", docsSorted(body))
	}

	// header: the lifecycle vocabulary of GET V/lifecycle
	wantHeader := map[string]any{"id": draft, "title": nil, "publication": "published", "process": "active", "kind": "original", "visibility": "public"}
	if title := f.title(draft); title != nil {
		wantHeader["title"] = *title
	}
	if got := body["vacancy"].(map[string]any); !reflect.DeepEqual(got, wantHeader) || !reflect.DeepEqual(docsSorted(got), overviewHeaderKeys) {
		t.Fatalf("vacancy header %v, want %v", got, wantHeader)
	}

	// scope: the vacancy scope exactly as GET V/documents answers it (the counts are the vacancy's own)
	list := f.ok(f.owner.token, draft)
	if !reflect.DeepEqual(body["scope"], list["scope"]) || !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(2), "links": float64(0)}) {
		t.Fatalf("scope %v, list scope %v", body["scope"], list["scope"])
	}

	// items: newest current version first, across the vacancy and the participations, each with its owner
	items := ovRows(body, "items")
	if got := ovNames(body); !reflect.DeepEqual(got, []string{"Contrato Ana", "Contrato marco", "CV Zoe", "Carta descarte", "Anexo"}) {
		t.Fatalf("order: %v", got)
	}
	wantOwners := []map[string]any{f.ownerOfParticipation(p3, false), ownerVacancy(), f.ownerOfParticipation(p1, false), f.ownerOfParticipation(p4, true), ownerVacancy()}
	for i, item := range items {
		if !reflect.DeepEqual(docsSorted(item), overviewItemKeys) {
			t.Fatalf("item keys: %v", docsSorted(item))
		}
		if !reflect.DeepEqual(item["owner"], wantOwners[i]) {
			t.Fatalf("owner of %s: %v, want %v", item["name"], item["owner"], wantOwners[i])
		}
		if !reflect.DeepEqual(strs(item["allowed_actions"]), []string{"download", "replace", "delete"}) {
			t.Fatalf("actions of %s: %v", item["name"], item["allowed_actions"])
		}
	}
	if items[1]["version"] != float64(2) || items[1]["version_count"] != float64(2) || items[1]["updated_at"] != "2026-11-20T21:02:11.482910Z" {
		t.Fatalf("the row shows the current version: %v", items[1])
	}
	if got := body["links"]; !reflect.DeepEqual(got, []any{}) || body["truncated"] != false {
		t.Fatalf("links %v truncated %v", got, body["truncated"])
	}

	// every row equals the list of its own scope (the same projection, the same actions)
	if got, want := ownedBy(items, ""), list["items"].([]any); !reflect.DeepEqual(got, want) {
		t.Fatalf("vacancy rows differ from GET V/documents:\n%v\n%v", got, want)
	}
	for _, pid := range []string{p1, p3, p4} {
		if got, want := ownedBy(items, pid), f.ok(f.owner.token, pscope(draft, pid))["items"].([]any); !reflect.DeepEqual(got, want) {
			t.Fatalf("participation %s rows differ from its list:\n%v\n%v", pid, got, want)
		}
	}

	// participations: every one (discarded included), by candidate name then id
	parts := ovRows(body, "participations")
	if got := ovIDs(parts, "participation_id"); !reflect.DeepEqual(got, []string{p3, p4, p2, p1}) {
		t.Fatalf("participations order: %v (want %v)", got, []string{p3, p4, p2, p1})
	}
	for i, want := range []struct {
		pid       string
		stage     map[string]any
		discarded bool
	}{
		{p3, map[string]any{"kind": "placement", "name": "Placement"}, false},
		{p4, map[string]any{"kind": "screening", "name": "Screening"}, true},
		{p2, map[string]any{"kind": "in_process", "name": "En proceso"}, false},
		{p1, map[string]any{"kind": "new", "name": "Nuevos"}, false},
	} {
		kind, id, name := f.candidateOf(want.pid)
		wantPart := map[string]any{
			"participation_id": want.pid, "candidate": map[string]any{"kind": kind, "id": id, "full_name": name}, "discarded": want.discarded,
			"stage": want.stage, "scope_allowed_actions": []any{"upload"}, "upload_blocked_reason": nil,
		}
		if !reflect.DeepEqual(parts[i], wantPart) || !reflect.DeepEqual(docsSorted(parts[i]), overviewPartKeys) {
			t.Fatalf("participation %d:\n got %v\nwant %v", i, parts[i], wantPart)
		}
	}
	if parts[0]["candidate"].(map[string]any)["kind"] != "manual" || parts[2]["candidate"].(map[string]any)["full_name"] != "Nombre Corregido" ||
		parts[1]["candidate"].(map[string]any)["full_name"] != "Beto Descartado" {
		t.Fatalf("candidates: %v", parts)
	}

	// reading writes nothing: the vacancy, its processes and the audit trail are byte-identical
	if f.vacancySnapshot(draft) != snapshot || auditCompanyCount(t, f.h.pool, f.company.companyID) != audits {
		t.Fatal("the overview changed the vacancy or the audit trail")
	}
}

// A vacancy with nothing: every array is empty (never null), the header and the scope are still there.
func TestDocumentOverview_EmptyVacancy(t *testing.T) {
	f := newDocsFlow(t)
	draft := f.published()
	body := f.overviewOK(f.owner.token, draft, "")
	for _, key := range []string{"items", "links", "participations"} {
		if !reflect.DeepEqual(body[key], []any{}) {
			t.Fatalf("%s = %v", key, body[key])
		}
	}
	if body["truncated"] != false || !reflect.DeepEqual(body["scope"], f.ok(f.owner.token, draft)["scope"]) {
		t.Fatalf("%v", body)
	}
}

// --- authorization ------------------------------------------------------------------------------------------------------

// The matrix of «Authorization», on a NEVER-PUBLISHED draft (no process row, so no participations): owner, responsible and a
// collaborator manage; the stakeholder reads read-only with the header present; everyone else is 404.
func TestDocumentOverview_AuthorizationMatrix(t *testing.T) {
	f := newDocsFlow(t)
	responsible := f.name(f.member("recruiter"), "Rita Responsable")
	draft := publicationFlowReady(t, f.h, responsible)
	if f.count(`SELECT count(*) FROM vacancy_processes WHERE id=$1`, draft) != 0 {
		t.Fatal("the fixture draft must have no process row")
	}
	f.insertDocument(draft, "", "Contrato", responsible, docVersion{docPDF, 1000, docsAt(0), responsible})

	collaborator := f.member("recruiter")
	assignment := teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	outsider := f.member("recruiter")
	former := f.member("recruiter")
	endedAssignment := teamAccessCollaborator(t, f.h, draft, f.company.companyID, former.userID, f.owner.userID)
	teamAccessEndCollaborator(t, f.h, endedAssignment, f.owner.userID)
	stakeholder := f.member("stakeholder")

	otherCompany, otherOwnerID, otherSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	otherOwner := f.h.actor(t, otherOwnerID, otherSub)
	otherRecruiterID, otherRecruiterSub := otherCompany.addUser(t, "recruiter")
	otherRecruiter := f.h.actor(t, otherRecruiterID, otherRecruiterSub)
	otherStakeholderID, otherStakeholderSub := otherCompany.addUser(t, "stakeholder")
	otherStakeholder := f.h.actor(t, otherStakeholderID, otherStakeholderSub)

	wantHeader := map[string]any{"id": draft, "title": nil, "publication": nil, "process": nil, "kind": "original", "visibility": nil}
	if title := f.title(draft); title != nil {
		wantHeader["title"] = *title
	}
	for _, tc := range []struct {
		name      string
		actor     draftFlowActor
		canManage bool
	}{
		{"owner", f.owner, true},
		{"responsible recruiter", responsible, true},
		{"active collaborator", collaborator, true},
		{"stakeholder of the company, never-published draft", stakeholder, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := f.overviewOK(tc.actor.token, draft, "")
			if got := body["vacancy"]; !reflect.DeepEqual(got, wantHeader) {
				t.Fatalf("header %v, want %v", got, wantHeader)
			}
			items, scope := ovRows(body, "items"), docsScope(body)
			if len(items) != 1 || scope["can_manage"] != tc.canManage || len(body["participations"].([]any)) != 0 {
				t.Fatalf("%s: %v", tc.name, body)
			}
			wantItem, wantScope := []string{"download"}, []string{}
			if tc.canManage {
				wantItem, wantScope = []string{"download", "replace", "delete"}, []string{"upload"}
			}
			if !reflect.DeepEqual(strs(items[0]["allowed_actions"]), wantItem) || !reflect.DeepEqual(strs(scope["allowed_actions"]), wantScope) ||
				scope["upload_blocked_reason"] != nil || !reflect.DeepEqual(items[0]["owner"], ownerVacancy()) {
				t.Fatalf("%s: item %v scope %v", tc.name, items[0], scope)
			}
		})
	}

	for _, tc := range []struct {
		name   string
		actor  draftFlowActor
		status int
		code   string
	}{
		{"recruiter never on the team", outsider, 404, "not_found"},
		{"former member", former, 404, "team_access_ended"},
		{"owner of another company", otherOwner, 404, "not_found"},
		{"recruiter of another company", otherRecruiter, 404, "not_found"},
		{"stakeholder of another company", otherStakeholder, 404, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draftFlowAssertError(t, f.overview(tc.actor.token, draft, ""), tc.status, tc.code)
		})
	}

	// D5: pool access grants nothing. The outsider holds it in this fixture and still gets the vacancy's 404.
	if got := f.h.do(t, "GET", "/v2/me/company/candidates?limit=1", "", outsider.token, nil); got.status != 200 {
		t.Fatalf("the outsider should hold pool access in this fixture: %d %s", got.status, got.body)
	}
	draftFlowAssertError(t, f.overview(outsider.token, draft, ""), 404, "not_found")

	// A collaborator whose tramo ends loses the table at once.
	teamAccessEndCollaborator(t, f.h, assignment, f.owner.userID)
	draftFlowAssertError(t, f.overview(collaborator.token, draft, ""), 404, "team_access_ended")

	t.Run("general gates", func(t *testing.T) {
		draftFlowAssertError(t, f.docs.do(t, "GET", draftFlowV2Path+"/"+draft+"/document-overview", "", "", nil), 401, "unauthenticated")
		noMembership, sub := draftFlowInsertUser(t, f.h.pool)
		t.Cleanup(func() { _, _ = f.h.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, noMembership) })
		draftFlowAssertError(t, f.overview(f.h.actor(t, noMembership, sub).token, draft, ""), 403, "forbidden")
		draftFlowAssertError(t, f.docs.do(t, "GET", draftFlowV2Path+"/not-a-uuid/document-overview", "", f.owner.token, nil), 400, "invalid_request")
		draftFlowAssertError(t, f.overview(f.owner.token, uuid.NewString(), ""), 404, "not_found")
	})
	t.Run("a draft of the v1 schema is hidden like a missing one", func(t *testing.T) {
		id, _, _ := f.h.create(t, f.owner, uuid.NewString(), draftFlowMinimalCreate)
		for _, actor := range []draftFlowActor{f.owner, stakeholder} {
			draftFlowAssertError(t, f.overview(actor.token, id, ""), 404, "not_found")
		}
	})
	t.Run("read only: no other verb", func(t *testing.T) {
		for _, method := range []string{"POST", "PUT", "PATCH", "DELETE"} {
			if got := f.docs.do(t, method, draftFlowV2Path+"/"+draft+"/document-overview", "", f.owner.token, nil); got.status != 405 && got.status != 404 {
				t.Fatalf("%s: %d %s", method, got.status, got.body)
			}
		}
	})
}

// A stakeholder of the company reads the whole table of a published vacancy read-only: downloads only, no scope action, no
// upload_blocked_reason even where the manager is blocked by the 20-document limit of a participation.
func TestDocumentOverview_StakeholderReadsEverythingReadOnly(t *testing.T) {
	f := newDocsFlow(t)
	draft := f.published()
	stages := replStages(draft)
	p := f.participation(draft, stages["in_process"])
	full := f.participation(draft, stages["new"])
	for i := 0; i < documents.MaxParticipationDocuments; i++ {
		f.insertDocument(draft, full, fmt.Sprintf("Doc %02d", i), f.owner, f.pdfVersion(i, f.owner))
	}
	f.insertDocument(draft, p, "Contrato", f.owner, f.pdfVersion(30, f.owner))
	f.insertDocument(draft, "", "Vacante", f.owner, f.pdfVersion(31, f.owner))
	// files plus links count against the participation limit: 15 + 5 = 20
	mixed := f.participation(draft, stages["screening"])
	for i := 0; i < 15; i++ {
		f.insertDocument(draft, mixed, fmt.Sprintf("Mixto %02d", i), f.owner, f.pdfVersion(40+i, f.owner))
	}
	for i := 0; i < 5; i++ {
		source, versions := f.insertDocument(draft, "", fmt.Sprintf("Fuente %d", i), f.owner, f.pdfVersion(60+i, f.owner))
		f.linkParticipationDoc(draft, mixed, source, versions[0], f.owner, 70+i)
	}
	stakeholder := f.member("stakeholder")

	asOwner := f.overviewOK(f.owner.token, draft, "")
	asStakeholder := f.overviewOK(stakeholder.token, draft, "")
	if len(ovRows(asStakeholder, "items")) != documents.MaxParticipationDocuments+2+15+5 || asStakeholder["truncated"] != false {
		t.Fatalf("stakeholder rows: %d", len(ovRows(asStakeholder, "items")))
	}
	for _, item := range ovRows(asStakeholder, "items") {
		if !reflect.DeepEqual(strs(item["allowed_actions"]), []string{"download"}) {
			t.Fatalf("a stakeholder only downloads: %v", item)
		}
	}
	if scope := docsScope(asStakeholder); scope["can_manage"] != false || len(scope["allowed_actions"].([]any)) != 0 || scope["upload_blocked_reason"] != nil {
		t.Fatalf("scope: %v", scope)
	}
	byID := func(body map[string]any) map[string]map[string]any {
		out := map[string]map[string]any{}
		for _, part := range ovRows(body, "participations") {
			out[part["participation_id"].(string)] = part
		}
		return out
	}
	owner, reader := byID(asOwner), byID(asStakeholder)
	if got := owner[full]; !reflect.DeepEqual(got["scope_allowed_actions"], []any{}) || got["upload_blocked_reason"] != "limit_reached" {
		t.Fatalf("a manager at the participation limit: %v", got)
	}
	if got := owner[mixed]; !reflect.DeepEqual(got["scope_allowed_actions"], []any{}) || got["upload_blocked_reason"] != "limit_reached" {
		t.Fatalf("files plus links count against the limit: %v", got)
	}
	if got := owner[p]; !reflect.DeepEqual(got["scope_allowed_actions"], []any{"upload"}) || got["upload_blocked_reason"] != nil {
		t.Fatalf("a manager below the limit: %v", got)
	}
	for pid, part := range reader {
		if !reflect.DeepEqual(part["scope_allowed_actions"], []any{}) || part["upload_blocked_reason"] != nil {
			t.Fatalf("stakeholder flags of %s: %v", pid, part)
		}
	}
	// the same rows, the same order: only the caller-dependent flags differ
	if !reflect.DeepEqual(ovIDs(ovRows(asOwner, "items"), "id"), ovIDs(ovRows(asStakeholder, "items"), "id")) {
		t.Fatal("owner and stakeholder see different rows")
	}
}

// --- the filter ---------------------------------------------------------------------------------------------------------

func TestDocumentOverview_ParticipationFilter(t *testing.T) {
	f := newDocsFlow(t)
	draft := f.published()
	stages := replStages(draft)
	p1 := f.participation(draft, stages["new"])
	p2 := f.participation(draft, stages["placement"])
	f.insertDocument(draft, "", "Vacante", f.owner, f.pdfVersion(1, f.owner))
	f.insertDocument(draft, p1, "Uno", f.owner, f.pdfVersion(2, f.owner))
	f.insertDocument(draft, p2, "Dos", f.owner, f.pdfVersion(3, f.owner))
	f.insertDocument(draft, p2, "Dos bis", f.owner, f.pdfVersion(4, f.owner))
	stakeholder := f.member("stakeholder")

	for _, actor := range []draftFlowActor{f.owner, stakeholder} {
		all := f.overviewOK(actor.token, draft, "")
		only := f.overviewOK(actor.token, draft, "participation_id="+p2)
		if got := ovNames(only); !reflect.DeepEqual(got, []string{"Dos bis", "Dos"}) {
			t.Fatalf("filtered rows: %v", got)
		}
		for _, item := range ovRows(only, "items") {
			if item["owner"].(map[string]any)["participation_id"] != p2 {
				t.Fatalf("a row of another owner: %v", item)
			}
		}
		// the header, the vacancy scope and the participations do not depend on the filter
		for _, key := range []string{"vacancy", "scope", "participations"} {
			if !reflect.DeepEqual(only[key], all[key]) {
				t.Fatalf("%s changed with the filter:\n%v\n%v", key, only[key], all[key])
			}
		}
		if len(ovRows(only, "participations")) != 2 || only["truncated"] != false {
			t.Fatalf("filtered body: %v", only)
		}
	}

	// A participation without rows: empty arrays, not an error.
	empty := f.participation(draft, stages["screening"])
	if body := f.overviewOK(f.owner.token, draft, "participation_id="+empty); len(body["items"].([]any)) != 0 || len(body["links"].([]any)) != 0 {
		t.Fatalf("participation without rows: %v", body)
	}

	// Foreign filters are 404 not_found, owner and stakeholder alike: another vacancy of the same company, a participation of another
	// company, a random id, the vacancy id itself.
	otherDraft := f.published()
	foreign := f.participation(otherDraft, replStages(otherDraft)["new"])
	_, otherOwnerID, otherSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	otherOwner := f.h.actor(t, otherOwnerID, otherSub)
	otherDraftID := publicationFlowReady(t, f.h, otherOwner)
	publicFlowPublish(t, f.h, otherDraftID, otherOwner)
	foreignCompany := draftListCandidateSeed(t, f.h, otherDraftID, replStages(otherDraftID)["new"])
	for _, actor := range []draftFlowActor{f.owner, stakeholder} {
		for name, pid := range map[string]string{"other vacancy": foreign, "other company": foreignCompany, "random": uuid.NewString(), "the vacancy id": draft} {
			t.Run(name, func(t *testing.T) {
				draftFlowAssertError(t, f.overview(actor.token, draft, "participation_id="+pid), 404, "not_found")
			})
		}
	}

	// Malformed filters are 400 invalid_request.
	for name, query := range map[string]string{
		"not a uuid": "participation_id=nope", "empty": "participation_id=", "twice": "participation_id=" + p1 + "&participation_id=" + p2,
		"no dashes": "participation_id=" + uuid.NewString()[:8], "braces": "participation_id=%7B" + p1 + "%7D",
	} {
		t.Run(name, func(t *testing.T) {
			draftFlowAssertError(t, f.overview(f.owner.token, draft, query), 400, "invalid_request")
		})
	}

	// The filter never leaks across the vacancy gates: whoever may not read the vacancy gets the vacancy's answer, for any filter.
	outsider := f.member("recruiter")
	draftFlowAssertError(t, f.overview(outsider.token, draft, "participation_id="+p1), 404, "not_found")
	draftFlowAssertError(t, f.overview(outsider.token, draft, "participation_id="+uuid.NewString()), 404, "not_found")
	former := f.member("recruiter")
	ended := teamAccessCollaborator(t, f.h, draft, f.company.companyID, former.userID, f.owner.userID)
	teamAccessEndCollaborator(t, f.h, ended, f.owner.userID)
	draftFlowAssertError(t, f.overview(former.token, draft, "participation_id="+uuid.NewString()), 404, "team_access_ended")
	// a team recruiter filters like the owner
	team := f.member("recruiter")
	teamAccessCollaborator(t, f.h, draft, f.company.companyID, team.userID, f.owner.userID)
	if got := ovNames(f.overviewOK(team.token, draft, "participation_id="+p1)); !reflect.DeepEqual(got, []string{"Uno"}) {
		t.Fatalf("team recruiter: %v", got)
	}

	// A never-published draft has no participations: every filter is 404 for the stakeholder and the owner.
	never := f.draft()
	for _, actor := range []draftFlowActor{f.owner, stakeholder} {
		draftFlowAssertError(t, f.overview(actor.token, never, "participation_id="+p1), 404, "not_found")
	}
}

// --- the header ---------------------------------------------------------------------------------------------------------

// «lifecycle enum values — read them, do not invent»: for every state the header's publication, process, kind and visibility are
// exactly what GET V/lifecycle answers for the same vacancy.
func TestDocumentOverview_HeaderEqualsTheLifecycleVocabularyInEveryState(t *testing.T) {
	f := newDocsFlow(t)
	original, replacement := f.chain2() // the original is closed with the process finished; the replacement is published
	private := f.published()
	f.link(private, original, original, 2)
	f.exec(`DELETE FROM vacancy_public_projections WHERE id=$1`, private) // a replacement without a public ad is private

	states := map[string]string{
		"never published":    f.draft(),
		"published original": f.published(),
		"paused": func() string {
			id := f.published()
			if got := f.transition(id, "pause", `{}`); got.status != 200 {
				t.Fatalf("pause: %d %s", got.status, got.body)
			}
			return id
		}(),
		"closed, process continues": func() string { id := f.published(); f.closeIt(id, "continue"); return id }(),
		"closed, finished":          original,
		"public replacement":        replacement,
		"private replacement":       private,
	}
	want := map[string]map[string]any{
		"never published":           {"publication": nil, "process": nil, "kind": "original", "visibility": nil},
		"published original":        {"publication": "published", "process": "active", "kind": "original", "visibility": "public"},
		"paused":                    {"publication": "paused", "process": "active", "kind": "original", "visibility": "public"},
		"closed, process continues": {"publication": "closed", "process": "active", "kind": "original", "visibility": "public"},
		"closed, finished":          {"publication": "closed", "process": "finished", "kind": "original", "visibility": "public"},
		"public replacement":        {"publication": "published", "process": "active", "kind": "replacement", "visibility": "public"},
		"private replacement":       {"publication": "published", "process": "active", "kind": "replacement", "visibility": "private"},
	}
	for name, id := range states {
		t.Run(name, func(t *testing.T) {
			header := f.overviewOK(f.owner.token, id, "")["vacancy"].(map[string]any)
			_, life := f.view(id)
			for _, key := range []string{"publication", "process", "kind", "visibility"} {
				if header[key] != life[key] || header[key] != want[name][key] {
					t.Errorf("%s: header %v, lifecycle %v, want %v", key, header[key], life[key], want[name][key])
				}
			}
			if header["id"] != id {
				t.Errorf("id %v", header["id"])
			}
		})
	}
}

// --- links of a replacement ---------------------------------------------------------------------------------------------

// replacementFixture is an original (finished) with documents and a replacement that links some of them: vacancy-level and on a
// carried participation.
type replacementFixture struct {
	original, replacement string
	s1, s2, s3, s4        string // source documents: three of the original's vacancy, one of its participation
	v1, v2, v3, v4        string // their pinned versions
	porig, prepl          string // the original's participation and the replacement's carried one
	l9, l7, l5, l4        string // links: vacancy at +9h and +7h, on prepl at +5h, vacancy at +4h
}

func (f *docsFlow) replacementFixture() replacementFixture {
	f.t.Helper()
	var x replacementFixture
	x.original, x.replacement = f.chain2()
	so, sr := replStages(x.original), replStages(x.replacement)
	x.porig = f.participation(x.original, so["new"])
	f.nameOrganic(x.porig, "Carmen Carry")
	x.prepl = f.participation(x.replacement, sr["screening"])
	f.carry(x.prepl, x.porig)
	var vs []string
	x.s1, vs = f.insertDocument(x.original, "", "Fuente 1", f.owner, f.pdfVersion(1, f.owner))
	x.v1 = vs[0]
	x.s2, vs = f.insertDocument(x.original, "", "Fuente 2", f.owner, f.pdfVersion(1, f.owner))
	x.v2 = vs[0]
	x.s3, vs = f.insertDocument(x.original, "", "Fuente 3", f.owner, f.pdfVersion(1, f.owner))
	x.v3 = vs[0]
	x.s4, vs = f.insertDocument(x.original, x.porig, "Fuente participación", f.owner, f.pdfVersion(1, f.owner))
	x.v4 = vs[0]
	x.l9 = f.linkDocument(x.replacement, x.s1, x.v1, f.owner, docsAt(9))
	x.l7 = f.linkDocument(x.replacement, x.s2, x.v2, f.owner, docsAt(7))
	x.l5 = f.linkParticipationDoc(x.replacement, x.prepl, x.s4, x.v4, f.owner, 5)
	x.l4 = f.linkDocument(x.replacement, x.s3, x.v3, f.owner, docsAt(4))
	return x
}

// The links of a replacement carry the shapes of GET P/documents plus their owner (the vacancy, or the carried participation with its
// candidate), with the link states of the list: available, removed (the source was deleted) and inaccessible (the viewer has no
// access to the source's vacancy). The header is a replacement's.
func TestDocumentOverview_LinksOfAReplacementWithOwnerAndStates(t *testing.T) {
	f := newDocsFlow(t)
	x := f.replacementFixture()
	f.insertDocument(x.replacement, "", "Propio", f.owner, f.pdfVersion(10, f.owner))
	f.insertDocument(x.replacement, x.prepl, "Propio participación", f.owner, f.pdfVersion(8, f.owner))
	f.exec(`DELETE FROM placement_documents WHERE id=$1`, x.s3) // the source of l4 is gone: removed
	stakeholder := f.member("stakeholder")
	ana := f.name(f.member("recruiter"), "Ana Equipo") // on the replacement's team only
	teamAccessCollaborator(t, f.h, x.replacement, f.company.companyID, ana.userID, f.owner.userID)

	body := f.overviewOK(f.owner.token, x.replacement, "")
	if got := body["vacancy"].(map[string]any); got["kind"] != "replacement" || got["publication"] != "published" {
		t.Fatalf("header: %v", got)
	}
	links := ovRows(body, "links")
	if got := ovIDs(links, "id"); !reflect.DeepEqual(got, []string{x.l9, x.l7, x.l5, x.l4}) {
		t.Fatalf("links order: %v", got)
	}
	wantState := []string{"available", "available", "available", "removed"}
	wantOwner := []map[string]any{ownerVacancy(), ownerVacancy(), f.ownerOfParticipation(x.prepl, false), ownerVacancy()}
	for i, link := range links {
		if !reflect.DeepEqual(docsSorted(link), overviewLinkKeys) || link["state"] != wantState[i] || !reflect.DeepEqual(link["owner"], wantOwner[i]) {
			t.Fatalf("link %d: %v", i, link)
		}
	}
	wantActions := [][]string{{"download", "unlink"}, {"download", "unlink"}, {"download", "unlink"}, {"unlink"}}
	for i, link := range links {
		if !reflect.DeepEqual(strs(link["allowed_actions"]), wantActions[i]) {
			t.Fatalf("link %d actions: %v", i, link["allowed_actions"])
		}
	}
	if links[3]["source"] != nil {
		t.Fatalf("a removed link has no source: %v", links[3])
	}
	src := links[2]["source"].(map[string]any)
	if src["document_id"] != x.s4 || src["participation_id"] != x.porig || src["process_id"] != x.original || src["sequence"] != float64(0) || src["name"] != "Fuente participación" {
		t.Fatalf("the participation link's source: %v", src)
	}
	if got := ovNames(body); !reflect.DeepEqual(got, []string{"Propio", "Propio participación"}) {
		t.Fatalf("items: %v", got)
	}
	if scope := docsScope(body); !reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(1), "links": float64(3)}) ||
		!reflect.DeepEqual(strs(scope["allowed_actions"]), []string{"upload", "link"}) {
		t.Fatalf("the vacancy scope counts its own rows only: %v", scope)
	}
	// the carried participation can receive links (its scope action says so); a manager only
	for _, part := range ovRows(body, "participations") {
		if part["participation_id"] == x.prepl && !reflect.DeepEqual(part["scope_allowed_actions"], []any{"upload", "link"}) {
			t.Fatalf("carried participation: %v", part)
		}
	}

	// every link equals the list of its own scope, for each kind of viewer
	for name, actor := range map[string]draftFlowActor{"owner": f.owner, "team recruiter": ana, "stakeholder": stakeholder} {
		got := f.overviewOK(actor.token, x.replacement, "")
		rows := ovRows(got, "links")
		if want := f.ok(actor.token, x.replacement)["links"].([]any); !reflect.DeepEqual(ownedBy(rows, ""), want) {
			t.Fatalf("%s: vacancy links differ from GET V/documents:\n%v\n%v", name, ownedBy(rows, ""), want)
		}
		if want := f.ok(actor.token, pscope(x.replacement, x.prepl))["links"].([]any); !reflect.DeepEqual(ownedBy(rows, x.prepl), want) {
			t.Fatalf("%s: participation links differ from GET P/documents:\n%v\n%v", name, ownedBy(rows, x.prepl), want)
		}
	}
	// the team recruiter holds no tramo on the original: the available links are inaccessible to her, without source data
	ours := ovRows(f.overviewOK(ana.token, x.replacement, ""), "links")
	for i, want := range []string{"inaccessible", "inaccessible", "inaccessible", "removed"} {
		if ours[i]["state"] != want || ours[i]["source"] != nil || !reflect.DeepEqual(strs(ours[i]["allowed_actions"]), []string{"unlink"}) {
			t.Fatalf("recruiter link %d: %v", i, ours[i])
		}
	}
	// the stakeholder reads every source; read-only
	theirs := ovRows(f.overviewOK(stakeholder.token, x.replacement, ""), "links")
	for i, want := range [][]string{{"download"}, {"download"}, {"download"}, {}} {
		if !reflect.DeepEqual(strs(theirs[i]["allowed_actions"]), want) {
			t.Fatalf("stakeholder link %d: %v", i, theirs[i]["allowed_actions"])
		}
	}

	// the filter keeps the carried participation's rows (its link and its document)
	only := f.overviewOK(f.owner.token, x.replacement, "participation_id="+x.prepl)
	if got := ovIDs(ovRows(only, "links"), "id"); !reflect.DeepEqual(got, []string{x.l5}) || !reflect.DeepEqual(ovNames(only), []string{"Propio participación"}) {
		t.Fatalf("filtered: links %v items %v", got, ovNames(only))
	}
	// the original (a different vacancy) lists its own rows only, with their owners
	orig := f.overviewOK(f.owner.token, x.original, "")
	// (Fuente 3 was deleted above)
	got := ovNames(orig)
	sort.Strings(got) // the three share one timestamp: their order is by id
	if !reflect.DeepEqual(got, []string{"Fuente 1", "Fuente 2", "Fuente participación"}) || len(ovRows(orig, "links")) != 0 {
		t.Fatalf("original: %v", got)
	}
	for _, item := range ovRows(orig, "items") {
		want := ownerVacancy()
		if item["name"] == "Fuente participación" {
			want = f.ownerOfParticipation(x.porig, false)
		}
		if !reflect.DeepEqual(item["owner"], want) {
			t.Fatalf("original row %v: owner %v, want %v", item["name"], item["owner"], want)
		}
	}
}

// --- the cap ------------------------------------------------------------------------------------------------------------

// «cap 2000 rows across items+links, `truncated` keeping the newest» with a small cap: the cap is shared by documents and links of
// the vacancy and of every participation, the newest rows of either kind survive, both arrays stay newest first, and the vacancy scope
// still counts the real rows.
func TestDocumentOverview_TruncationKeepsTheNewestAcrossItemsAndLinks(t *testing.T) {
	var store *documentspostgres.Store
	f := newDocsFlowWith(t, nil, func(s *documentspostgres.Store) { store = s })
	x := f.replacementFixture()
	i10, _ := f.insertDocument(x.replacement, "", "Item 10", f.owner, f.pdfVersion(10, f.owner))
	p8, _ := f.insertDocument(x.replacement, x.prepl, "Item 8 participación", f.owner, f.pdfVersion(8, f.owner))
	i6, _ := f.insertDocument(x.replacement, "", "Item 6", f.owner, f.pdfVersion(6, f.owner))
	i2, _ := f.insertDocument(x.replacement, "", "Item 2", f.owner, f.pdfVersion(2, f.owner))

	// newest first: item 10, link 9, item 8 (participation), link 7, item 6, link 5 (participation), link 4, item 2
	cases := []struct {
		cap       int
		items     []string
		links     []string
		truncated bool
	}{
		{5, []string{i10, p8, i6}, []string{x.l9, x.l7}, true},
		{7, []string{i10, p8, i6}, []string{x.l9, x.l7, x.l5, x.l4}, true},
		{8, []string{i10, p8, i6, i2}, []string{x.l9, x.l7, x.l5, x.l4}, false},
		{1, []string{i10}, []string{}, true},
		{2000, []string{i10, p8, i6, i2}, []string{x.l9, x.l7, x.l5, x.l4}, false},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("cap %d", tc.cap), func(t *testing.T) {
			store.WithOverviewCap(tc.cap)
			body := f.overviewOK(f.owner.token, x.replacement, "")
			if got := ovIDs(ovRows(body, "items"), "id"); !reflect.DeepEqual(got, tc.items) {
				t.Errorf("items %v, want %v", got, tc.items)
			}
			if got := ovIDs(ovRows(body, "links"), "id"); !reflect.DeepEqual(got, tc.links) {
				t.Errorf("links %v, want %v", got, tc.links)
			}
			if body["truncated"] != tc.truncated {
				t.Errorf("truncated = %v, want %v", body["truncated"], tc.truncated)
			}
			// the scope and the participations are the real ones, never the capped rows
			if !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(3), "links": float64(3)}) || len(ovRows(body, "participations")) != 1 {
				t.Errorf("scope %v participations %v", docsScope(body)["counts"], body["participations"])
			}
		})
	}
	// the filter narrows first, then the cap applies to what is left
	store.WithOverviewCap(1)
	only := f.overviewOK(f.owner.token, x.replacement, "participation_id="+x.prepl)
	if got := ovIDs(ovRows(only, "items"), "id"); !reflect.DeepEqual(got, []string{p8}) || len(ovRows(only, "links")) != 0 || only["truncated"] != true {
		t.Fatalf("filtered and capped: %v %v %v", got, only["links"], only["truncated"])
	}
	// the default cap is the contract's
	store.WithOverviewCap(documents.MaxOverviewRows)
	if documents.MaxOverviewRows != 2000 {
		t.Fatalf("the cap is %d", documents.MaxOverviewRows)
	}
}

// --- batching -----------------------------------------------------------------------------------------------------------

type countingTx struct {
	pgx.Tx
	n *int
}

func (c countingTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	*c.n++
	return c.Tx.Query(ctx, sql, args...)
}
func (c countingTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	*c.n++
	return c.Tx.QueryRow(ctx, sql, args...)
}
func (c countingTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	*c.n++
	return c.Tx.Exec(ctx, sql, args...)
}

type countingPool struct {
	pool *pgxpool.Pool
	n    *int
}

func (p countingPool) BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
	tx, err := p.pool.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return countingTx{Tx: tx, n: p.n}, nil
}

// «no N+1»: the statements the overview runs do not grow with the participations, documents or links of the vacancy.
func TestDocumentOverview_RunsAFixedNumberOfStatements(t *testing.T) {
	f := newDocsFlow(t)
	x := f.replacementFixture()
	var n int
	store := documentspostgres.NewStore(countingPool{pool: f.h.pool, n: &n}, documentAccess{drafts: f.h.store}, nil, nil, nil).WithStages(documentStages)
	count := func() int {
		t.Helper()
		n = 0
		got, err := store.Overview(context.Background(), f.company.companyID, f.owner.userID, uuid.MustParse(x.replacement), nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(got.Participations) == 0 {
			t.Fatal("fixture without participations")
		}
		return n
	}
	small := count()
	stages := replStages(x.replacement)
	for i := 0; i < 12; i++ {
		pid := f.participation(x.replacement, stages["in_process"])
		f.insertDocument(x.replacement, pid, fmt.Sprintf("Doc %d", i), f.owner, f.pdfVersion(i, f.owner))
		f.insertDocument(x.replacement, "", fmt.Sprintf("Vacante %d", i), f.owner, f.pdfVersion(i, f.owner))
		f.linkParticipationDoc(x.replacement, pid, x.s4, x.v4, f.owner, i)
	}
	large := count()
	if small != large {
		t.Fatalf("statements grew with the data: %d with 1 participation, %d with 13", small, large)
	}
	if large > 16 {
		t.Fatalf("too many statements for one read: %d", large)
	}
	t.Logf("statements per overview, authorization included: %d", large)
}

// --- real writes --------------------------------------------------------------------------------------------------------

// What the upload routes wrote is what the overview reads: the 201 item of a vacancy document and of a participation document
// equal their overview rows (minus owner).
func TestDocumentOverview_ReadsWhatTheUploadRoutesWrote(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	pid := f.participation(draft, replStages(draft)["in_process"])
	vacancy := f.uploadOK(f.owner.token, draft, "Contrato vacante.pdf", bytesPDF(400))["item"].(map[string]any)
	participation := f.uploadOK(f.owner.token, pscope(draft, pid), "Contrato candidato.pdf", bytesPDF(500))["item"].(map[string]any)

	body := f.overviewOK(f.owner.token, draft, "")
	items := ovRows(body, "items")
	if len(items) != 2 {
		t.Fatalf("items: %v", items)
	}
	byID := map[string]map[string]any{}
	for _, item := range items {
		byID[item["id"].(string)] = item
	}
	if got := withoutOwner(byID[vacancy["id"].(string)]); !reflect.DeepEqual(got, vacancy) {
		t.Fatalf("vacancy row:\n%v\n%v", got, vacancy)
	}
	if got := withoutOwner(byID[participation["id"].(string)]); !reflect.DeepEqual(got, participation) {
		t.Fatalf("participation row:\n%v\n%v", got, participation)
	}
	if !reflect.DeepEqual(byID[participation["id"].(string)]["owner"], f.ownerOfParticipation(pid, false)) || !reflect.DeepEqual(byID[vacancy["id"].(string)]["owner"], ownerVacancy()) {
		t.Fatal("owners")
	}
}
