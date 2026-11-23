//go:build integration

package main

import (
	"context"
	"fmt"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// GET /v2/me/company/job-drafts/{id}/documents through the production router
// (docs/contracts/placement-vacancy-documents-v1.md, P3): real RequireAuth, real
// RequireDocumentReader, real documents store over the draft authorization, isolated
// PostgreSQL. The drafts, team and lifecycle are built through the existing routers
// (the documents router only adds the new route); documents and links are seeded in SQL
// because the write routes arrive in later slices.

const (
	docPDF  = "application/pdf"
	docDOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	docXLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

type docsFlow struct {
	*replFlow
	docs *draftFlowHarness
}

// newDocsFlow builds the drafts harness plus a second server over the SAME pool and signer
// whose router carries the documents route wired exactly as main.go wires it.
func newDocsFlow(t *testing.T) *docsFlow {
	t.Helper()
	f := &docsFlow{replFlow: newReplFlow(t)}
	h := f.h
	queries := db.New(h.pool)
	users := identitypostgres.NewUserRepository(queries)
	members := companiespostgres.NewCompanyMemberRepository(h.pool, auditpostgres.NewAuditEventRepository())
	companies := companiespostgres.NewCompanyRepository(h.pool, auditpostgres.NewAuditEventRepository())
	router := newRouter(routerDeps{
		requireAuth:           identityhttp.RequireAuth(h.signer.verifier),
		requireRecruiter:      identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.RecruiterRole),
		requireOwner:          identityhttp.RequireCompanyRole(users, members, companies, companiesvalueobjects.OwnerRole),
		requireDocumentReader: identityhttp.RequireDocumentReader(users, members, companies),
		documentHandler:       newDocumentHandler(h.pool, h.store, nil), // the list works with storage disabled
	})
	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	copied := *h
	copied.server, copied.client = server, server.Client()
	f.docs = &copied
	return f
}

func (f *docsFlow) member(role string) draftFlowActor {
	f.t.Helper()
	id, sub := f.company.addUser(f.t, role)
	return f.h.actor(f.t, id, sub)
}

func (f *docsFlow) name(actor draftFlowActor, name string) draftFlowActor {
	f.exec(`UPDATE users SET full_name=$2 WHERE id=$1`, actor.userID, name)
	return actor
}

func (f *docsFlow) get(token, draft string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "GET", draftFlowV2Path+"/"+draft+"/documents", "", token, nil)
}

func (f *docsFlow) ok(token, draft string) map[string]any {
	f.t.Helper()
	got := f.get(token, draft)
	draftFlowAssertNoStore(f.t, got)
	if got.status != 200 {
		f.t.Fatalf("GET documents %s: %d %s", draft, got.status, got.body)
	}
	return draftFlowObject(f.t, got.body)
}

type docVersion struct {
	contentType string
	size        int64
	at          time.Time
	by          draftFlowActor
}

// insertDocument seeds a document with its versions (version numbers 1..n in the order given) and returns the
// document id and its version ids. participation is "" for a vacancy document.
func (f *docsFlow) insertDocument(draft, participation, name string, creator draftFlowActor, versions ...docVersion) (string, []string) {
	f.t.Helper()
	doc := uuid.NewString()
	var part any
	if participation != "" {
		part = participation
	}
	f.exec(`INSERT INTO placement_documents(id,company_id,draft_id,participation_id,name,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)`,
		doc, f.company.companyID, draft, part, name, versions[0].at, creator.userID)
	ids := make([]string, len(versions))
	for i, v := range versions {
		ids[i] = uuid.NewString()
		f.exec(`INSERT INTO placement_document_versions(id,document_id,version,storage_key,content_type,size,uploaded_at,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
			ids[i], doc, i+1, strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", ""), v.contentType, v.size, v.at, v.by.userID)
	}
	f.t.Cleanup(func() { // before the participation, draft and user cleanups registered earlier
		// Versions cascade; links to it keep their row (SET NULL) and are removed by their own cleanup.
		if _, err := f.h.pool.Exec(context.Background(), `DELETE FROM placement_documents WHERE id=$1`, doc); err != nil {
			f.t.Errorf("document cleanup: %v", err)
		}
	})
	return doc, ids
}

// linkDocument seeds a vacancy-level link of target pinned to a source version.
func (f *docsFlow) linkDocument(target, sourceDoc, sourceVersion string, by draftFlowActor, at time.Time) string {
	f.t.Helper()
	id := uuid.NewString()
	f.exec(`INSERT INTO placement_document_links(id,company_id,draft_id,participation_id,source_document_id,source_version_id,linked_at,linked_by) VALUES($1,$2,$3,NULL,$4,$5,$6,$7)`,
		id, f.company.companyID, target, sourceDoc, sourceVersion, at, by.userID)
	f.t.Cleanup(func() { f.exec(`DELETE FROM placement_document_links WHERE id=$1`, id) })
	return id
}

var docsT0 = time.Date(2026, 11, 20, 15, 2, 11, 482910000, time.UTC)

func docsAt(hours int) time.Time { return docsT0.Add(time.Duration(hours) * time.Hour) }

func strs(v any) []string {
	out := []string{}
	for _, x := range v.([]any) {
		out = append(out, x.(string))
	}
	return out
}

func docsSorted(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func docsScope(body map[string]any) map[string]any { return body["scope"].(map[string]any) }

// The matrix of «Authorization»: owner, team recruiter, collaborator, a recruiter who was never on the team, a former
// member, a stakeholder on a NEVER-PUBLISHED draft, other companies, and pool access. Run on a draft that was never
// published: the read gate needs no process row.
func TestDocumentsList_AuthorizationMatrix(t *testing.T) {
	f := newDocsFlow(t)
	responsible := f.name(f.member("recruiter"), "Rita Responsable")
	draft := publicationFlowReady(t, f.h, responsible) // never published: no vacancy_processes row
	if f.count(`SELECT count(*) FROM vacancy_processes WHERE id=$1`, draft) != 0 {
		t.Fatal("the fixture draft must have no process row")
	}
	f.insertDocument(draft, "", "Contrato", responsible, docVersion{docPDF, 1000, docsAt(0), responsible})

	collaborator := f.member("recruiter")
	assignment := teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	outsider := f.member("recruiter") // a recruiter of the company who was never on the team
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
			body := f.ok(tc.actor.token, draft)
			scope := docsScope(body)
			if scope["can_manage"] != tc.canManage || len(body["items"].([]any)) != 1 {
				t.Fatalf("%s: %v", tc.name, body)
			}
			wantItem, wantScope := []string{"download"}, []string{}
			if tc.canManage {
				wantItem, wantScope = []string{"download", "replace", "delete"}, []string{"upload"}
			}
			item := body["items"].([]any)[0].(map[string]any)
			if !reflect.DeepEqual(strs(item["allowed_actions"]), wantItem) || !reflect.DeepEqual(strs(scope["allowed_actions"]), wantScope) {
				t.Fatalf("%s: item actions %v scope actions %v", tc.name, item["allowed_actions"], scope["allowed_actions"])
			}
			if scope["upload_blocked_reason"] != nil {
				t.Fatalf("%s: upload_blocked_reason = %v", tc.name, scope["upload_blocked_reason"])
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
		// A stakeholder reaches the whole organization, never another company.
		{"stakeholder of another company", otherStakeholder, 404, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draftFlowAssertError(t, f.get(tc.actor.token, draft), tc.status, tc.code)
		})
	}

	// A collaborator whose tramo ends loses the list at once.
	teamAccessEndCollaborator(t, f.h, assignment, f.owner.userID)
	draftFlowAssertError(t, f.get(collaborator.token, draft), 404, "team_access_ended")

	t.Run("general gates", func(t *testing.T) {
		draftFlowAssertError(t, f.docs.do(t, "GET", draftFlowV2Path+"/"+draft+"/documents", "", "", nil), 401, "unauthenticated")
		noMembership, sub := draftFlowInsertUser(t, f.h.pool)
		t.Cleanup(func() { _, _ = f.h.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, noMembership) })
		draftFlowAssertError(t, f.get(f.h.actor(t, noMembership, sub).token, draft), 403, "forbidden")
		draftFlowAssertError(t, f.docs.do(t, "GET", draftFlowV2Path+"/not-a-uuid/documents", "", f.owner.token, nil), 400, "invalid_request")
		draftFlowAssertError(t, f.get(f.owner.token, uuid.NewString()), 404, "not_found")
	})

	t.Run("a stakeholder never writes: no write verb exists yet and the recruiter gate refuses them", func(t *testing.T) {
		got := f.docs.do(t, "POST", draftFlowV2Path+"/"+draft+"/documents", "", stakeholder.token, nil)
		if got.status != 404 && got.status != 405 {
			t.Fatalf("POST documents answered %d %s", got.status, got.body)
		}
	})
}

// D5: the candidate pool grants nothing. A recruiter who can use the pool still cannot read a vacancy's documents they
// are not a member of, and no pool route serves documents.
func TestDocumentsList_PoolAccessGrantsNothing(t *testing.T) {
	f := newDocsFlow(t)
	responsible := f.member("recruiter")
	draft := publicationFlowReady(t, f.h, responsible)
	f.insertDocument(draft, "", "Contrato", responsible, docVersion{docPDF, 10, docsAt(0), responsible})
	outsider := f.member("recruiter")

	// The pool route is reachable for the outsider through the drafts harness (the documents server has no pool routes).
	if got := f.h.do(t, "GET", "/v2/me/company/candidates?limit=1", "", outsider.token, nil); got.status != 200 {
		t.Fatalf("the outsider should hold pool access in this fixture: %d %s", got.status, got.body)
	}
	draftFlowAssertError(t, f.get(outsider.token, draft), 404, "not_found")
	id, pid := uuid.NewString(), uuid.NewString()
	for _, path := range []string{
		"/v2/me/company/candidates/organic/" + id + "/documents",
		"/v2/me/company/candidates/organic/" + id + "/participations/" + pid + "/documents",
		"/v2/me/company/candidates/organic/" + id + "/participations/" + pid + "/documents/" + uuid.NewString() + "/file",
	} {
		for _, h := range []*draftFlowHarness{f.h, f.docs} {
			if got := h.do(t, "GET", path, "", outsider.token, nil); got.status != 404 {
				t.Fatalf("%s: %d %s", path, got.status, got.body)
			}
		}
	}
}

// A draft of the v1 schema is hidden like a missing one, as on every v2 draft route (A4).
func TestDocumentsList_V1DraftIsNotFound(t *testing.T) {
	f := newDocsFlow(t)
	id, _, _ := f.h.create(t, f.owner, uuid.NewString(), draftFlowMinimalCreate)
	stakeholder := f.member("stakeholder")
	for _, actor := range []draftFlowActor{f.owner, stakeholder} {
		draftFlowAssertError(t, f.get(actor.token, id), 404, "not_found")
	}
}

// Vacancy documents work in every lifecycle state, including draft, closed and finished (S2, S4), and reading never
// touches the vacancy: draft row, process row and lifecycle events stay byte-identical.
func TestDocumentsList_EveryLifecycleStateAndNoSideEffects(t *testing.T) {
	f := newDocsFlow(t)
	stakeholder := f.member("stakeholder")

	states := map[string]func() string{
		"draft":     f.draft,
		"published": f.published,
		"paused": func() string {
			id := f.published()
			if got := f.transition(id, "pause", `{}`); got.status != 200 {
				t.Fatalf("pause: %d %s", got.status, got.body)
			}
			return id
		},
		"closed, process continues": func() string { id := f.published(); f.closeIt(id, "continue"); return id },
		"closed, process finished":  func() string { id := f.published(); f.closeIt(id, "finish"); return id },
	}
	for name, build := range states {
		t.Run(name, func(t *testing.T) {
			id := build()
			f.insertDocument(id, "", "Contrato "+name, f.owner, docVersion{docPDF, 5, docsAt(1), f.owner})
			snapshot := func() string {
				var s string
				if err := f.h.pool.QueryRow(context.Background(), `SELECT json_build_array(
					(SELECT to_json(d) FROM job_drafts d WHERE id=$1),
					(SELECT to_json(p) FROM vacancy_processes p WHERE id=$1),
					(SELECT json_agg(e ORDER BY id) FROM vacancy_lifecycle_events e WHERE process_id=$1),
					(SELECT count(*) FROM audit_events WHERE company_id=$2))::text`, id, f.company.companyID).Scan(&s); err != nil {
					t.Fatal(err)
				}
				return s
			}
			before := snapshot()
			for _, actor := range []draftFlowActor{f.owner, stakeholder} {
				body := f.ok(actor.token, id)
				items := body["items"].([]any)
				if len(items) != 1 || items[0].(map[string]any)["name"] != "Contrato "+name {
					t.Fatalf("%s: %v", name, body)
				}
			}
			// After closure the owner still uploads (S4): the scope offers it, no process_finished.
			scope := docsScope(f.ok(f.owner.token, id))
			if !reflect.DeepEqual(strs(scope["allowed_actions"]), []string{"upload"}) {
				t.Fatalf("%s: scope actions %v", name, scope["allowed_actions"])
			}
			if after := snapshot(); after != before {
				t.Fatalf("%s: the read changed the vacancy\nbefore %s\nafter  %s", name, before, after)
			}
		})
	}
}

// The empty list and the populated shapes of the contract, key for key.
func TestDocumentsList_ShapeEmptyAndPopulated(t *testing.T) {
	f := newDocsFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	luis := f.name(f.member("recruiter"), "Luis Ortega")
	draft := publicationFlowReady(t, f.h, ana)

	empty := f.ok(f.owner.token, draft)
	if !reflect.DeepEqual(docsSorted(empty), []string{"items", "links", "scope"}) {
		t.Fatalf("keys: %v", docsSorted(empty))
	}
	if !reflect.DeepEqual(empty["items"], []any{}) || !reflect.DeepEqual(empty["links"], []any{}) {
		t.Fatalf("empty arrays must be [] not null: %s", f.get(f.owner.token, draft).body)
	}
	scope := docsScope(empty)
	if !reflect.DeepEqual(docsSorted(scope), []string{"allowed_actions", "can_manage", "counts", "limits", "upload_blocked_reason"}) {
		t.Fatalf("scope keys: %v", docsSorted(scope))
	}
	limits := scope["limits"].(map[string]any)
	if limits["max_bytes"] != float64(10485760) || limits["max_documents"] != float64(50) || limits["max_versions"] != float64(25) {
		t.Fatalf("limits: %v", limits)
	}
	formats := limits["formats"].([]any)
	var seen []string
	for _, raw := range formats {
		d := raw.(map[string]any)
		seen = append(seen, d["format"].(string)+":"+strings.Join(strs(d["extensions"]), ",")+":"+d["content_type"].(string))
	}
	if !reflect.DeepEqual(seen, []string{"pdf:.pdf:application/pdf", "docx:.docx:" + docDOCX, "xlsx:.xlsx:" + docXLSX, "jpg:.jpg,.jpeg:image/jpeg", "png:.png:image/png"}) {
		t.Fatalf("formats: %v", seen)
	}
	if !reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(0), "links": float64(0)}) {
		t.Fatalf("counts: %v", scope["counts"])
	}

	// Two documents: the one updated last comes first; a second version moves a document up and shows the newest uploader.
	older, _ := f.insertDocument(draft, "", "Oferta", ana, docVersion{docPDF, 100, docsAt(1), ana})
	newer, _ := f.insertDocument(draft, "", "Contrato marco", ana,
		docVersion{docDOCX, 90112, docsAt(2), ana}, docVersion{docXLSX, 183204, docsAt(5), luis})
	body := f.ok(f.owner.token, draft)
	items := body["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["id"] != newer || items[1].(map[string]any)["id"] != older {
		t.Fatalf("order: %v", items)
	}
	first := items[0].(map[string]any)
	if !reflect.DeepEqual(docsSorted(first), []string{"allowed_actions", "content_type", "created_at", "created_by", "format", "id", "name", "participation_id", "size", "updated_at", "updated_by", "version", "version_count"}) {
		t.Fatalf("item keys: %v", docsSorted(first))
	}
	if v, ok := first["participation_id"]; !ok || v != nil {
		t.Fatalf("participation_id must be present and null: %v %v", v, ok)
	}
	wantFirst := map[string]any{
		"name": "Contrato marco", "format": "xlsx", "content_type": docXLSX, "size": float64(183204), "version": float64(2), "version_count": float64(2),
		"created_at": "2026-11-20T17:02:11.482910Z", "updated_at": "2026-11-20T20:02:11.482910Z",
	}
	for k, v := range wantFirst {
		if first[k] != v {
			t.Errorf("%s = %v, want %v", k, first[k], v)
		}
	}
	if !reflect.DeepEqual(first["created_by"], map[string]any{"id": ana.userID.String(), "name": "Ana López"}) ||
		!reflect.DeepEqual(first["updated_by"], map[string]any{"id": luis.userID.String(), "name": "Luis Ortega"}) {
		t.Fatalf("people: %v %v", first["created_by"], first["updated_by"])
	}
	if !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(2), "links": float64(0)}) {
		t.Fatalf("counts: %v", docsScope(body)["counts"])
	}
}

// replace disappears at 25 versions; the scope is blocked at 50 documents for a manager and merely read-only for a stakeholder.
func TestDocumentsList_LimitsDriveAllowedActions(t *testing.T) {
	f := newDocsFlow(t)
	stakeholder := f.member("stakeholder")
	draft := publicationFlowReady(t, f.h, f.owner)

	versions := make([]docVersion, 25)
	for i := range versions {
		versions[i] = docVersion{docPDF, int64(i + 1), docsAt(i), f.owner}
	}
	f.insertDocument(draft, "", "Muchas versiones", f.owner, versions...)
	body := f.ok(f.owner.token, draft)
	item := body["items"].([]any)[0].(map[string]any)
	if item["version"] != float64(25) || item["version_count"] != float64(25) || !reflect.DeepEqual(strs(item["allowed_actions"]), []string{"download", "delete"}) {
		t.Fatalf("at 25 versions: %v", item)
	}
	if got := f.ok(stakeholder.token, draft)["items"].([]any)[0].(map[string]any)["allowed_actions"]; !reflect.DeepEqual(strs(got), []string{"download"}) {
		t.Fatalf("stakeholder at 25 versions: %v", got)
	}

	for i := 1; i < 50; i++ {
		f.insertDocument(draft, "", fmt.Sprintf("Documento %02d", i), f.owner, docVersion{docPDF, 1, docsAt(100 + i), f.owner})
	}
	owner := docsScope(f.ok(f.owner.token, draft))
	if owner["can_manage"] != true || len(strs(owner["allowed_actions"])) != 0 || owner["upload_blocked_reason"] != "limit_reached" {
		t.Fatalf("manager on a full scope: %v", owner)
	}
	reader := docsScope(f.ok(stakeholder.token, draft))
	if reader["can_manage"] != false || len(strs(reader["allowed_actions"])) != 0 || reader["upload_blocked_reason"] != nil {
		t.Fatalf("stakeholder on a full scope: %v", reader)
	}
	if !reflect.DeepEqual(owner["counts"], map[string]any{"documents": float64(50), "links": float64(0)}) {
		t.Fatalf("counts: %v", owner["counts"])
	}
}

// A participation document belongs to its participation (D5): the vacancy list never shows it nor counts it.
func TestDocumentsList_ExcludesParticipationDocuments(t *testing.T) {
	f := newDocsFlow(t)
	draft := f.published()
	stage := pipelineconfig.Defaults(uuid.MustParse(draft)).Stages[0].ID
	participation := draftListCandidateSeed(t, f.h, draft, stage)
	f.insertDocument(draft, "", "De la vacante", f.owner, docVersion{docPDF, 1, docsAt(0), f.owner})
	f.insertDocument(draft, participation, "Del candidato", f.owner, docVersion{docPDF, 1, docsAt(1), f.owner})
	body := f.ok(f.owner.token, draft)
	items := body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["name"] != "De la vacante" {
		t.Fatalf("items: %v", items)
	}
	if !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(1), "links": float64(0)}) {
		t.Fatalf("counts: %v", docsScope(body)["counts"])
	}
}

// links[]: states, pinned versions and allowed_actions per role; `link` appears in the scope only on a replacement.
func TestDocumentsList_ReplacementScopeAndLinks(t *testing.T) {
	f := newDocsFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	root := f.published()
	f.closeIt(root, "finish")
	replacement := f.published()
	f.link(replacement, root, root, 1)

	stakeholder := f.member("stakeholder")
	// A recruiter on the replacement's team but never on the original's.
	sourceless := f.member("recruiter")
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, sourceless.userID, f.owner.userID)
	// A recruiter on both teams.
	onBoth := f.member("recruiter")
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, onBoth.userID, f.owner.userID)
	teamAccessCollaborator(t, f.h, root, f.company.companyID, onBoth.userID, f.owner.userID)

	source, versions := f.insertDocument(root, "", "Contrato original", ana,
		docVersion{docDOCX, 91200, docsAt(0), ana}, docVersion{docDOCX, 91300, docsAt(9), f.owner}, docVersion{docPDF, 91400, docsAt(12), f.owner})
	pinned := f.linkDocument(replacement, source, versions[0], f.owner, docsAt(30))

	// The original is not a replacement: no `link`; the replacement offers it.
	if got := strs(docsScope(f.ok(f.owner.token, root))["allowed_actions"]); !reflect.DeepEqual(got, []string{"upload"}) {
		t.Fatalf("original scope actions: %v", got)
	}
	body := f.ok(f.owner.token, replacement)
	if got := strs(docsScope(body)["allowed_actions"]); !reflect.DeepEqual(got, []string{"upload", "link"}) {
		t.Fatalf("replacement scope actions: %v", got)
	}
	if !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(0), "links": float64(1)}) {
		t.Fatalf("counts: %v", docsScope(body)["counts"])
	}
	link := body["links"].([]any)[0].(map[string]any)
	if !reflect.DeepEqual(docsSorted(link), []string{"allowed_actions", "id", "linked_at", "linked_by", "source", "state"}) || link["id"] != pinned || link["state"] != "available" {
		t.Fatalf("link: %v", link)
	}
	if !reflect.DeepEqual(strs(link["allowed_actions"]), []string{"download", "unlink"}) || link["linked_at"] != "2026-11-21T21:02:11.482910Z" {
		t.Fatalf("link actions/time: %v", link)
	}
	src := link["source"].(map[string]any)
	if !reflect.DeepEqual(docsSorted(src), []string{"document_id", "format", "has_newer_version", "name", "participation_id", "process_id", "sequence", "size", "uploaded_at", "uploaded_by", "version", "version_count"}) {
		t.Fatalf("source keys: %v", docsSorted(src))
	}
	wantSource := map[string]any{
		"document_id": source, "process_id": root, "sequence": float64(0), "participation_id": nil, "name": "Contrato original", "format": "docx", "size": float64(91200),
		"version": float64(1), "version_count": float64(3), "uploaded_at": "2026-11-20T15:02:11.482910Z", "has_newer_version": true,
	}
	for k, v := range wantSource {
		if got, ok := src[k]; !ok || got != v {
			t.Errorf("source.%s = %v (present %v), want %v", k, got, ok, v)
		}
	}
	if !reflect.DeepEqual(src["uploaded_by"], map[string]any{"id": ana.userID.String(), "name": "Ana López"}) {
		t.Fatalf("source.uploaded_by: %v", src["uploaded_by"])
	}

	// Read-only callers download only; a stakeholder reads every source of the company (D18).
	stakeLink := f.ok(stakeholder.token, replacement)["links"].([]any)[0].(map[string]any)
	if stakeLink["state"] != "available" || !reflect.DeepEqual(strs(stakeLink["allowed_actions"]), []string{"download"}) {
		t.Fatalf("stakeholder link: %v", stakeLink)
	}
	if got := docsScope(f.ok(stakeholder.token, replacement)); got["can_manage"] != false || len(strs(got["allowed_actions"])) != 0 {
		t.Fatalf("stakeholder scope: %v", got)
	}

	// Strict source access (D18): a recruiter who may open the replacement but not the original sees an inaccessible link.
	hidden := f.ok(sourceless.token, replacement)["links"].([]any)[0].(map[string]any)
	if hidden["state"] != "inaccessible" || hidden["source"] != nil || !reflect.DeepEqual(strs(hidden["allowed_actions"]), []string{"unlink"}) {
		t.Fatalf("inaccessible link: %v", hidden)
	}
	if shown := f.ok(onBoth.token, replacement)["links"].([]any)[0].(map[string]any); shown["state"] != "available" || shown["source"] == nil {
		t.Fatalf("a member of the source vacancy sees it: %v", shown)
	}
	for _, leaked := range []string{"Contrato original", source, "91200"} {
		if strings.Contains(string(f.get(sourceless.token, replacement).body), leaked) {
			t.Fatalf("an inaccessible link leaked %q", leaked)
		}
	}

	// A deleted source leaves the link «removed» (ON DELETE SET NULL): only unlink for a manager, nothing for a stakeholder.
	f.exec(`DELETE FROM placement_documents WHERE id=$1`, source)
	for _, tc := range []struct {
		actor draftFlowActor
		want  []string
	}{{f.owner, []string{"unlink"}}, {stakeholder, []string{}}} {
		removed := f.ok(tc.actor.token, replacement)["links"].([]any)[0].(map[string]any)
		if removed["state"] != "removed" || removed["source"] != nil || !reflect.DeepEqual(strs(removed["allowed_actions"]), tc.want) {
			t.Fatalf("removed link: %v", removed)
		}
	}
}
