//go:build integration

package main

import (
	"bytes"
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
)

// Participation documents through the production router (docs/contracts/placement-vacancy-documents-v1.md, P6, D3, D5): the
// same endpoints as the vacancy scope under /v2/me/company/job-drafts/{id}/participations/{pid}/documents…, whose only rule is
// «pid belongs to {id}». Real RequireAuth, recruiter and reader gates, the real store, service and local storage, isolated
// PostgreSQL. The helpers of the vacancy tests build every path as draftFlowV2Path + "/" + draft + "/documents…", so a
// participation scope is passed to them as `pscope(draft, pid)` and they exercise the participation routes unchanged.

// pscope is the path segment that turns the vacancy helpers (post, get, replace, download, versions, deleteDoc…) into their
// participation counterparts.
func pscope(draft, pid string) string { return draft + "/participations/" + pid }

// participation seeds a participation of draft at stage (a stage id) and registers the removal of its documents BEFORE the
// participation fixture itself goes (cleanups run last-in first-out): documents created through the API reference it.
func (f *docsFlow) participation(draft, stage string) string {
	f.t.Helper()
	pid := draftListCandidateSeed(f.t, f.h, draft, stage)
	f.t.Cleanup(func() {
		for _, q := range []string{`DELETE FROM placement_document_links WHERE participation_id=$1`, `DELETE FROM placement_documents WHERE participation_id=$1`} {
			if _, err := f.h.pool.Exec(context.Background(), q, pid); err != nil {
				f.t.Errorf("participation documents cleanup: %v", err)
			}
		}
	})
	return pid
}

// discarded moves the participation to the exit stage with a discard reason, as the board does.
func (f *docsFlow) discarded(draft, pid string) {
	f.t.Helper()
	f.exec(`UPDATE process_participations SET previous_stage_id=stage_id, stage_id=$2, reason_group='recruiter', reason_code='profile_mismatch', discarded_at=now() WHERE id=$1`, pid, replStages(draft)["discarded"])
}

func (f *docsFlow) participationDocs(pid string) int {
	return f.count(`SELECT count(*) FROM placement_documents WHERE participation_id=$1`, pid)
}

// participationEvents are the audit rows of one event type of a participation scope.
func (f *docsFlow) participationEvents(eventType, pid string) []auditRow {
	f.t.Helper()
	return auditRowsWhere(f.t, f.h.pool, `company_id=$1 AND event_type=$2 AND metadata->>'participation_id'=$3`, f.company.companyID, eventType, pid)
}

func docItems(body map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, raw := range body["items"].([]any) {
		out = append(out, raw.(map[string]any))
	}
	return out
}

func docItemNames(body map[string]any) []string {
	names := []string{}
	for _, item := range docItems(body) {
		names = append(names, item["name"].(string))
	}
	return names
}

// --- every stage, discarded included (D3, Q7) -------------------------------------------------------------------

// «En cualquier etapa del proceso» / «Sí, también descartados»: the whole pipeline of operations works for a participation at
// every stage of the default pipeline and for a discarded one, and nothing in the answers depends on the stage.
func TestParticipationDocuments_EveryStageIncludingDiscarded(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	stages := replStages(draft)
	for _, kind := range []string{"new", "screening", "screening_ok", "in_process", "placement", "discarded"} {
		t.Run(kind, func(t *testing.T) {
			pid := ""
			if kind == "discarded" {
				pid = f.participation(draft, stages["new"])
				f.discarded(draft, pid)
			} else {
				pid = f.participation(draft, stages[kind])
			}
			p := pscope(draft, pid)

			// upload: 201 {item, scope}; participation_id is the pid, the limit is the participation's 20, no eligibility flag.
			body := f.uploadOK(f.owner.token, p, "Contrato "+kind+".pdf", bytesPDF(500))
			item := body["item"].(map[string]any)
			doc := item["id"].(string)
			if !reflect.DeepEqual(docsSorted(item), docItemKeys) || item["participation_id"] != pid || item["version"] != float64(1) ||
				item["name"] != "Contrato "+kind || item["format"] != "pdf" {
				t.Fatalf("item: %v", item)
			}
			scope := docsScope(body)
			if scope["can_manage"] != true || !reflect.DeepEqual(strs(scope["allowed_actions"]), []string{"upload"}) || scope["upload_blocked_reason"] != nil ||
				scope["limits"].(map[string]any)["max_documents"] != float64(20) ||
				!reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(1), "links": float64(0)}) {
				t.Fatalf("scope: %v", scope)
			}
			if _, has := scope["can_upload"]; has {
				t.Fatal("can_upload was removed (Q7): no eligibility")
			}
			if f.participationDocs(pid) != 1 {
				t.Fatalf("rows: %d", f.participationDocs(pid))
			}

			// list = the 201 item and scope
			list := f.ok(f.owner.token, p)
			if !reflect.DeepEqual(list["items"].([]any)[0], item) || !reflect.DeepEqual(list["scope"], scope) || len(list["links"].([]any)) != 0 {
				t.Fatalf("list %v\nwant item %v scope %v", list, item, scope)
			}

			// download: the bytes, audited with the participation
			got := f.download(f.owner.token, p, doc)
			if got.status != 200 || !bytes.Equal(got.body, bytesPDF(500)) {
				t.Fatalf("download: %d %d bytes", got.status, len(got.body))
			}

			// replace: version 2 (a different format is fine), expected_version required
			replaced := f.replaceOK(f.owner.token, p, doc, 1, "Contrato firmado.docx", bytesDOCX(t))
			if ri := replaced["item"].(map[string]any); ri["version"] != float64(2) || ri["participation_id"] != pid || ri["format"] != "docx" {
				t.Fatalf("replaced: %v", ri)
			}
			vs := draftFlowObject(t, f.versions(f.owner.token, p, doc).body)["versions"].([]any)
			if len(vs) != 2 || vs[0].(map[string]any)["version"] != float64(2) || vs[1].(map[string]any)["version"] != float64(1) {
				t.Fatalf("versions: %v", vs)
			}
			if got := f.versionFile(f.owner.token, p, doc, 1); got.status != 200 || !bytes.Equal(got.body, bytesPDF(500)) {
				t.Fatalf("version 1: %d", got.status)
			}

			// delete: 200 {scope}, the slot is free again, the files go
			del := f.deleteDoc(f.owner.token, p, doc)
			if del.status != 200 {
				t.Fatalf("delete: %d %s", del.status, del.body)
			}
			out := draftFlowObject(t, del.body)
			if len(out) != 1 || !reflect.DeepEqual(docsScope(out)["counts"], map[string]any{"documents": float64(0), "links": float64(0)}) {
				t.Fatalf("delete body: %v", out)
			}
			if f.participationDocs(pid) != 0 || f.objects() != 0 {
				t.Fatalf("rows %d objects %d", f.participationDocs(pid), f.objects())
			}
		})
	}
}

// --- S4: after closure and finished -------------------------------------------------------------------------------

// Upload, replace and delete of a participation document are document operations: accepted on a closed or finished process
// at any stage (discarded included), audited, and every lifecycle row, participation and credit stays byte-identical. A
// stakeholder reads and downloads but never writes.
func TestParticipationDocuments_AfterClosureAndFinishedLeaveTheVacancyByteIdentical(t *testing.T) {
	f := newDocsUploadFlow(t)
	states := map[string]func() string{
		"published": f.published,
		"paused": func() string {
			id := f.published()
			if got := f.transition(id, "pause", `{}`); got.status != 200 {
				t.Fatalf("pause: %d %s", got.status, got.body)
			}
			return id
		},
		"closed, process continues": func() string { id := f.published(); f.closeIt(id, "continue"); return id },
		"closed, covered":           func() string { id := f.published(); f.closeIt(id, "continue"); f.cover(id); return id },
		"closed, process finished":  func() string { id := f.published(); f.closeIt(id, "finish"); return id },
		"finished and then replaced": func() string {
			id := f.published()
			f.closeIt(id, "finish")
			f.link(f.published(), id, id, 1)
			return id
		},
	}
	for name, build := range states {
		t.Run(name, func(t *testing.T) {
			id := build()
			stages := replStages(id)
			placed := f.participation(id, stages["placement"])
			dropped := f.participation(id, stages["screening"])
			f.discarded(id, dropped)
			stakeholder := f.member("stakeholder")

			for label, pid := range map[string]string{"placement": placed, "discarded": dropped} {
				p := pscope(id, pid)
				before := f.vacancySnapshot(id)
				auditBefore := auditCompanyCount(t, f.h.pool, f.company.companyID)

				got := f.post(f.owner.token, p, nil, filePart("Doc "+label+".pdf", bytesPDF(300)))
				if got.status != 201 {
					t.Fatalf("%s upload: %d %s", label, got.status, got.body)
				}
				doc := docID(draftFlowObject(t, got.body))
				if got := f.replace(f.owner.token, p, doc, expectedPart(1), filePart("Doc v2.pdf", bytesPDF(310))); got.status != 201 {
					t.Fatalf("%s replace: %d %s", label, got.status, got.body)
				}
				if n := auditCompanyCount(t, f.h.pool, f.company.companyID); n != auditBefore+2 ||
					len(f.participationEvents("DocumentUploaded", pid)) != 1 || len(f.participationEvents("DocumentReplaced", pid)) != 1 {
					t.Fatalf("%s: audit rows %d -> %d", label, auditBefore, n)
				}

				// The stakeholder reads and downloads, and is refused every write.
				if body := f.ok(stakeholder.token, p); len(docItems(body)) != 1 || docsScope(body)["can_manage"] != false {
					t.Fatalf("%s: stakeholder list %v", label, body)
				}
				if got := f.download(stakeholder.token, p, doc); got.status != 200 {
					t.Fatalf("%s: stakeholder download %d", label, got.status)
				}
				draftFlowAssertError(t, f.post(stakeholder.token, p, nil, filePart("no.pdf", bytesPDF(50))), 403, "forbidden")
				draftFlowAssertError(t, f.replace(stakeholder.token, p, doc, expectedPart(2), filePart("no.pdf", bytesPDF(50))), 403, "forbidden")
				draftFlowAssertError(t, f.deleteDoc(stakeholder.token, p, doc), 403, "forbidden")

				auditMid := auditCompanyCount(t, f.h.pool, f.company.companyID)
				if got := f.deleteDoc(f.owner.token, p, doc); got.status != 200 {
					t.Fatalf("%s delete: %d %s", label, got.status, got.body)
				}
				if n := auditCompanyCount(t, f.h.pool, f.company.companyID); n != auditMid+1 || len(f.participationEvents("DocumentDeleted", pid)) != 1 {
					t.Fatalf("%s: delete audit rows %d -> %d", label, auditMid, n)
				}
				// No lifecycle, participation, team, credit or replacement row moved (the download rows are audit, not vacancy state).
				if after := f.vacancySnapshot(id); after != before {
					t.Fatalf("%s: the document operations changed the vacancy\nbefore %s\nafter  %s", label, before, after)
				}
			}
		})
	}
}

// --- «pid belongs to {id}» (D3, D5) -----------------------------------------------------------------------------------

// The only participation rule: a pid that is not a participation of process {id} is 404 not_found on every route and for every
// reader, whatever the reason (random, of another vacancy of the company, of another company), and nothing is stored, audited
// or left in storage. A malformed pid is a malformed request.
func TestParticipationDocuments_WrongPidIsNotFoundEverywhere(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	other := f.published() // another process of the same company
	pidMine := f.participation(draft, replStages(draft)["new"])
	pidOther := f.participation(other, replStages(other)["new"])
	docMine := docID(f.uploadOK(f.owner.token, pscope(draft, pidMine), "Mio.pdf", bytesPDF(200)))
	docOther := docID(f.uploadOK(f.owner.token, pscope(other, pidOther), "Ajeno.pdf", bytesPDF(200)))
	stakeholder := f.member("stakeholder")

	// another company, with its own published process and participation
	_, foreignOwnerID, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	foreignOwner := f.h.actor(t, foreignOwnerID, foreignSub)
	foreignDraft := publicationFlowReady(t, f.h, foreignOwner)
	publicFlowPublish(t, f.h, foreignDraft, foreignOwner)
	foreignPid := draftListCandidateSeed(t, f.h, foreignDraft, replStages(foreignDraft)["new"])

	snapshot := func() string {
		return fmt.Sprint(f.docCount(draft), f.docCount(other), f.objects(),
			auditCompanyCount(t, f.h.pool, f.company.companyID),
			f.count(`SELECT count(*) FROM placement_document_versions v JOIN placement_documents d ON d.id=v.document_id WHERE d.company_id=$1`, f.company.companyID))
	}
	before := snapshot()

	for label, wrong := range map[string]string{
		"a pid that does not exist":            uuid.NewString(),
		"a participation of another vacancy":   pidOther,
		"a participation of another company":   foreignPid,
		"the draft id used as a participation": draft,
	} {
		p := pscope(draft, wrong)
		for _, actor := range []draftFlowActor{f.owner, stakeholder} {
			draftFlowAssertError(t, f.get(actor.token, p), 404, "not_found")
			draftFlowAssertError(t, f.versions(actor.token, p, docMine), 404, "not_found")
			draftFlowAssertError(t, f.download(actor.token, p, docMine), 404, "not_found")
			draftFlowAssertError(t, f.versionFile(actor.token, p, docMine, 1), 404, "not_found")
			// a document of the other participation, asked through this one, is not served either
			draftFlowAssertError(t, f.download(actor.token, p, docOther), 404, "not_found")
		}
		// writes: refused before one byte is stored (404 for the owner; a stakeholder's 403 comes from the route group)
		draftFlowAssertError(t, f.post(f.owner.token, p, nil, filePart("x.pdf", bytesPDF(200))), 404, "not_found")
		draftFlowAssertError(t, f.replace(f.owner.token, p, docMine, expectedPart(1), filePart("x.pdf", bytesPDF(200))), 404, "not_found")
		draftFlowAssertError(t, f.deleteDoc(f.owner.token, p, docMine), 404, "not_found")
		draftFlowAssertError(t, f.deleteDoc(f.owner.token, p, docOther), 404, "not_found")
		if got := snapshot(); got != before {
			t.Fatalf("%s: state moved\nbefore %s\nafter  %s", label, before, got)
		}
	}

	// The documents are still where they were, reachable through their own participation.
	if names := docItemNames(f.ok(f.owner.token, pscope(draft, pidMine))); !reflect.DeepEqual(names, []string{"Mio"}) {
		t.Fatalf("mine: %v", names)
	}
	if names := docItemNames(f.ok(f.owner.token, pscope(other, pidOther))); !reflect.DeepEqual(names, []string{"Ajeno"}) {
		t.Fatalf("other: %v", names)
	}
	// And the same pid under the other process's path.
	draftFlowAssertError(t, f.get(f.owner.token, pscope(other, pidMine)), 404, "not_found")

	// Another company's draft id: the usual vacancy 404 comes first, pid or not; and the foreign owner cannot reach our pid either.
	draftFlowAssertError(t, f.get(f.owner.token, pscope(foreignDraft, foreignPid)), 404, "not_found")
	draftFlowAssertError(t, f.post(f.owner.token, pscope(foreignDraft, foreignPid), nil, filePart("x.pdf", bytesPDF(200))), 404, "not_found")
	draftFlowAssertError(t, f.get(foreignOwner.token, pscope(draft, pidMine)), 404, "not_found")
	draftFlowAssertError(t, f.get(foreignOwner.token, pscope(foreignDraft, pidMine)), 404, "not_found")

	// Malformed ids.
	bad := f.docs.do(t, "GET", draftFlowV2Path+"/"+draft+"/participations/nope/documents", "", f.owner.token, nil)
	draftFlowAssertError(t, bad, 400, "invalid_request")
	bad = f.docs.do(t, "DELETE", draftFlowV2Path+"/"+draft+"/participations/nope/documents/"+docMine, "", f.owner.token, nil)
	draftFlowAssertError(t, bad, 400, "invalid_request")
}

// A vacancy that was never published has no process and so no participations: every pid is 404, for the owner and for a
// stakeholder alike (the read gate needs no process row, but a participation scope does need its participation).
func TestParticipationDocuments_NeverPublishedDraftHasNoParticipations(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.draft() // no process row
	published := f.published()
	pid := f.participation(published, replStages(published)["new"]) // a real participation, of ANOTHER vacancy
	stakeholder := f.member("stakeholder")
	for _, p := range []string{pscope(draft, uuid.NewString()), pscope(draft, pid)} {
		for _, actor := range []draftFlowActor{f.owner, stakeholder} {
			draftFlowAssertError(t, f.get(actor.token, p), 404, "not_found")
		}
		draftFlowAssertError(t, f.post(f.owner.token, p, nil, filePart("x.pdf", bytesPDF(100))), 404, "not_found")
	}
	f.assertNothingStored("never published", draft)
}

// --- the two scopes never mix ------------------------------------------------------------------------------------------

// The vacancy list never shows a participation document and the participation list never shows a vacancy document (nor another
// participation's); their counts and limits are independent; a document is reachable only through its own scope.
func TestParticipationDocuments_ScopesNeverMix(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	stages := replStages(draft)
	p1, p2 := f.participation(draft, stages["new"]), f.participation(draft, stages["placement"])
	vacancyDoc := docID(f.uploadOK(f.owner.token, draft, "De la vacante.pdf", bytesPDF(200)))
	doc1 := docID(f.uploadOK(f.owner.token, pscope(draft, p1), "Del uno.pdf", bytesPDF(200)))
	doc2 := docID(f.uploadOK(f.owner.token, pscope(draft, p2), "Del dos.pdf", bytesPDF(200)))

	for scope, want := range map[string][]string{draft: {"De la vacante"}, pscope(draft, p1): {"Del uno"}, pscope(draft, p2): {"Del dos"}} {
		for _, actor := range []draftFlowActor{f.owner, f.member("stakeholder")} {
			body := f.ok(actor.token, scope)
			if got := docItemNames(body); !reflect.DeepEqual(got, want) {
				t.Fatalf("%s: %v want %v", scope, got, want)
			}
			if !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(1), "links": float64(0)}) {
				t.Fatalf("%s: counts %v", scope, docsScope(body)["counts"])
			}
		}
	}
	if docsScope(f.ok(f.owner.token, draft))["limits"].(map[string]any)["max_documents"] != float64(50) ||
		docsScope(f.ok(f.owner.token, pscope(draft, p1)))["limits"].(map[string]any)["max_documents"] != float64(20) {
		t.Fatal("the vacancy keeps 50 and the participation has 20")
	}
	if f.ok(f.owner.token, draft)["items"].([]any)[0].(map[string]any)["participation_id"] != nil {
		t.Fatal("a vacancy document keeps participation_id null")
	}

	// A document answers only through its own scope, on every route.
	cross := []struct {
		label, scope, doc string
	}{
		{"participation document through the vacancy", draft, doc1},
		{"vacancy document through a participation", pscope(draft, p1), vacancyDoc},
		{"document of another participation", pscope(draft, p1), doc2},
		{"document of the first through the second", pscope(draft, p2), doc1},
	}
	companyDocs := func() int {
		return f.count(`SELECT count(*) FROM placement_documents WHERE company_id=$1`, f.company.companyID)
	}
	companyVersions := func() int {
		return f.count(`SELECT count(*) FROM placement_document_versions v JOIN placement_documents d ON d.id=v.document_id WHERE d.company_id=$1`, f.company.companyID)
	}
	rows, objects := companyDocs(), f.objects()
	for _, tc := range cross {
		draftFlowAssertError(t, f.download(f.owner.token, tc.scope, tc.doc), 404, "not_found")
		draftFlowAssertError(t, f.versions(f.owner.token, tc.scope, tc.doc), 404, "not_found")
		draftFlowAssertError(t, f.versionFile(f.owner.token, tc.scope, tc.doc, 1), 404, "not_found")
		draftFlowAssertError(t, f.replace(f.owner.token, tc.scope, tc.doc, expectedPart(1), filePart("x.pdf", bytesPDF(100))), 404, "not_found")
		draftFlowAssertError(t, f.deleteDoc(f.owner.token, tc.scope, tc.doc), 404, "not_found")
	}
	if companyDocs() != rows || f.objects() != objects || companyVersions() != rows {
		t.Fatalf("a cross-scope request changed something: rows %d versions %d objects %d (was %d, %d)", companyDocs(), companyVersions(), f.objects(), rows, objects)
	}
	// The per-document answers still work through the right scope, and each carries its own scope in the audit row.
	for scope, doc := range map[string]string{draft: vacancyDoc, pscope(draft, p1): doc1, pscope(draft, p2): doc2} {
		if got := f.download(f.owner.token, scope, doc); got.status != 200 {
			t.Fatalf("%s: %d", scope, got.status)
		}
	}
	// Deleting from one scope frees only that scope's slot.
	if got := f.deleteDoc(f.owner.token, pscope(draft, p1), doc1); got.status != 200 {
		t.Fatalf("delete: %d", got.status)
	}
	if len(docItems(f.ok(f.owner.token, draft))) != 1 || len(docItems(f.ok(f.owner.token, pscope(draft, p2)))) != 1 {
		t.Fatal("deleting a participation document touched another scope")
	}
}

// --- authorization ------------------------------------------------------------------------------------------------

// Same matrix as the vacancy scope (§Authorization): manage = owner + active team, a stakeholder reads and never writes, a former
// member is team_access_ended, a recruiter never on the team and another company are 404, and talent-base access grants nothing.
func TestParticipationDocuments_AuthorizationMatrix(t *testing.T) {
	f := newDocsUploadFlow(t)
	responsible := f.name(f.member("recruiter"), "Rita Responsable")
	draft := publicationFlowReady(t, f.h, responsible)
	publicFlowPublish(t, f.h, draft, f.owner)
	pid := f.participation(draft, replStages(draft)["in_process"])
	p := pscope(draft, pid)
	doc := docID(f.uploadOK(responsible.token, p, "Contrato.pdf", bytesPDF(300)))

	collaborator := f.member("recruiter")
	assignment := teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	outsider := f.member("recruiter") // holds the talent base, never on this vacancy's team
	former := f.member("recruiter")
	ended := teamAccessCollaborator(t, f.h, draft, f.company.companyID, former.userID, f.owner.userID)
	teamAccessEndCollaborator(t, f.h, ended, f.owner.userID)
	stakeholder := f.member("stakeholder")

	foreignCompany, foreignOwnerID, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	foreignOwner := f.h.actor(t, foreignOwnerID, foreignSub)
	foreignRecruiterID, foreignRecruiterSub := foreignCompany.addUser(t, "recruiter")
	foreignRecruiter := f.h.actor(t, foreignRecruiterID, foreignRecruiterSub)
	foreignStakeholderID, foreignStakeholderSub := foreignCompany.addUser(t, "stakeholder")
	foreignStakeholder := f.h.actor(t, foreignStakeholderID, foreignStakeholderSub)

	if got := f.h.do(t, "GET", "/v2/me/company/candidates?limit=1", "", outsider.token, nil); got.status != 200 {
		t.Fatalf("the outsider must hold pool access in this fixture: %d %s", got.status, got.body)
	}

	type op struct {
		name string
		do   func(a draftFlowActor) draftFlowResponse
	}
	reads := []op{
		{"list", func(a draftFlowActor) draftFlowResponse { return f.get(a.token, p) }},
		{"versions", func(a draftFlowActor) draftFlowResponse { return f.versions(a.token, p, doc) }},
		{"download", func(a draftFlowActor) draftFlowResponse { return f.download(a.token, p, doc) }},
		{"version download", func(a draftFlowActor) draftFlowResponse { return f.versionFile(a.token, p, doc, 1) }},
	}
	writes := []op{
		{"upload", func(a draftFlowActor) draftFlowResponse {
			return f.post(a.token, p, nil, filePart("x.pdf", bytesPDF(100)))
		}},
		{"replace", func(a draftFlowActor) draftFlowResponse {
			return f.replace(a.token, p, doc, expectedPart(1), filePart("x.pdf", bytesPDF(100)))
		}},
		{"delete", func(a draftFlowActor) draftFlowResponse { return f.deleteDoc(a.token, p, doc) }},
	}

	// Manage + read: owner, responsible, active collaborator. (Writes run last and on a throwaway document, below.)
	for name, actor := range map[string]draftFlowActor{"owner": f.owner, "responsible": responsible, "collaborator": collaborator} {
		for _, r := range reads {
			if got := r.do(actor); got.status != 200 {
				t.Fatalf("%s %s: %d %s", name, r.name, got.status, got.body)
			}
		}
		if body := f.ok(actor.token, p); docsScope(body)["can_manage"] != true ||
			!reflect.DeepEqual(strs(docItems(body)[0]["allowed_actions"]), []string{"download", "replace", "delete"}) {
			t.Fatalf("%s scope: %v", name, body)
		}
		throwaway := docID(f.uploadOK(actor.token, p, "Prueba "+name+".pdf", bytesPDF(120)))
		f.replaceOK(actor.token, p, throwaway, 1, "Prueba v2.pdf", bytesPDF(130))
		if got := f.deleteDoc(actor.token, p, throwaway); got.status != 200 {
			t.Fatalf("%s delete: %d %s", name, got.status, got.body)
		}
	}

	// Read-only: a stakeholder reads and downloads (also with no process row of their own), and is refused every write.
	for _, r := range reads {
		if got := r.do(stakeholder); got.status != 200 {
			t.Fatalf("stakeholder %s: %d %s", r.name, got.status, got.body)
		}
	}
	if body := f.ok(stakeholder.token, p); docsScope(body)["can_manage"] != false || len(strs(docsScope(body)["allowed_actions"])) != 0 ||
		!reflect.DeepEqual(strs(docItems(body)[0]["allowed_actions"]), []string{"download"}) {
		t.Fatalf("stakeholder scope: %v", body)
	}
	auditBefore, objects := auditCompanyCount(t, f.h.pool, f.company.companyID), f.objects()
	for _, w := range writes {
		draftFlowAssertError(t, w.do(stakeholder), 403, "forbidden")
	}
	if n := auditCompanyCount(t, f.h.pool, f.company.companyID); n != auditBefore || f.objects() != objects || f.participationDocs(pid) != 1 || f.versionCount(doc) != 1 {
		t.Fatalf("a stakeholder write left traces: audit %d -> %d objects %d -> %d", auditBefore, n, objects, f.objects())
	}

	// Refused everywhere, reads and writes alike, with nothing stored.
	for _, tc := range []struct {
		name   string
		actor  draftFlowActor
		status int
		code   string
	}{
		{"recruiter never on the team (talent-base access grants nothing)", outsider, 404, "not_found"},
		{"former member", former, 404, "team_access_ended"},
		{"owner of another company", foreignOwner, 404, "not_found"},
		{"recruiter of another company", foreignRecruiter, 404, "not_found"},
	} {
		for _, o := range append(append([]op{}, reads...), writes...) {
			draftFlowAssertError(t, o.do(tc.actor), tc.status, tc.code)
		}
		_ = tc.name
	}
	for _, r := range reads { // a stakeholder of another company reads nothing of ours
		draftFlowAssertError(t, r.do(foreignStakeholder), 404, "not_found")
	}
	if f.participationDocs(pid) != 1 || f.versionCount(doc) != 1 || f.objects() != objects {
		t.Fatalf("a refused caller changed something: docs %d versions %d objects %d", f.participationDocs(pid), f.versionCount(doc), f.objects())
	}

	// A collaborator whose tramo ends loses access at once, reads and writes.
	teamAccessEndCollaborator(t, f.h, assignment, f.owner.userID)
	for _, o := range append(append([]op{}, reads...), writes...) {
		draftFlowAssertError(t, o.do(collaborator), 404, "team_access_ended")
	}

	// General gates.
	draftFlowAssertError(t, f.docs.do(t, "GET", draftFlowV2Path+"/"+p+"/documents", "", "", nil), 401, "unauthenticated")
	draftFlowAssertError(t, f.docs.do(t, "POST", draftFlowV2Path+"/"+p+"/documents", "", "", nil), 401, "unauthenticated")
	noMembership, sub := draftFlowInsertUser(t, f.h.pool)
	t.Cleanup(func() { _, _ = f.h.pool.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, noMembership) })
	draftFlowAssertError(t, f.get(f.h.actor(t, noMembership, sub).token, p), 403, "forbidden")

	// D5: no pool route serves a participation's documents, for the owner and for the pool-only recruiter.
	candidate := uuid.NewString()
	for _, path := range []string{
		"/v2/me/company/candidates/organic/" + candidate + "/participations/" + pid + "/documents",
		"/v2/me/company/candidates/organic/" + candidate + "/participations/" + pid + "/documents/" + doc + "/file",
		"/v2/me/company/candidates/manual/" + candidate + "/documents",
		"/v2/me/company/candidates/documents",
	} {
		for _, a := range []draftFlowActor{outsider, f.owner} {
			for _, h := range []*draftFlowHarness{f.h, f.docs} {
				for _, method := range []string{"GET", "POST", "DELETE"} {
					if got := h.do(t, method, path, "", a.token, nil); got.status != 404 && got.status != 405 {
						t.Fatalf("%s %s: %d %s", method, path, got.status, got.body)
					}
				}
			}
		}
	}
}

// --- limit 20 per participation (D15) -----------------------------------------------------------------------------------

// 20 documents per participation, files plus links, counted per participation: the 21st is 409 document_limit_reached
// (`data.kind = documents`, limit 20) with nothing stored; the scope says so; another participation and the vacancy are not
// affected; a delete frees the slot.
func TestParticipationDocuments_LimitIsTwentyPerParticipation(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	stages := replStages(draft)
	full, empty := f.participation(draft, stages["new"]), f.participation(draft, stages["placement"])
	p := pscope(draft, full)

	first := ""
	for i := 1; i <= 19; i++ {
		body := f.uploadOK(f.owner.token, p, fmt.Sprintf("Doc %02d.pdf", i), bytesPDF(100))
		if i == 1 {
			first = docID(body)
		}
		if i == 19 && !reflect.DeepEqual(strs(docsScope(body)["allowed_actions"]), []string{"upload"}) {
			t.Fatalf("19th: %v", docsScope(body))
		}
	}
	// The 20th fills the scope: its own answer already says upload is blocked.
	last := f.uploadOK(f.owner.token, p, "Doc 20.pdf", bytesPDF(100))
	scope := docsScope(last)
	if len(strs(scope["allowed_actions"])) != 0 || scope["upload_blocked_reason"] != "limit_reached" ||
		!reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(20), "links": float64(0)}) {
		t.Fatalf("20th scope: %v", scope)
	}

	objects := f.objects()
	got := f.post(f.owner.token, p, nil, filePart("Doc 21.pdf", bytesPDF(100)))
	draftFlowAssertError(t, got, 409, "document_limit_reached")
	data := draftFlowObject(t, got.body)["data"].(map[string]any)
	if data["kind"] != "documents" || data["limit"] != float64(20) {
		t.Fatalf("data: %v", data)
	}
	if f.participationDocs(full) != 20 || f.objects() != objects {
		t.Fatalf("the refused upload stored something: rows %d objects %d (was %d)", f.participationDocs(full), f.objects(), objects)
	}
	if body := f.ok(f.owner.token, p); len(docItems(body)) != 20 || docsScope(body)["upload_blocked_reason"] != "limit_reached" {
		t.Fatalf("list: %d items, scope %v", len(docItems(body)), docsScope(body))
	}
	// Replacing a version is not a new document: it still works at the limit.
	f.replaceOK(f.owner.token, p, first, 1, "Doc 01 v2.pdf", bytesPDF(110))

	// Independent counters: the other participation and the vacancy still accept uploads.
	f.uploadOK(f.owner.token, pscope(draft, empty), "Libre.pdf", bytesPDF(100))
	f.uploadOK(f.owner.token, draft, "Vacante.pdf", bytesPDF(100))
	if body := f.ok(f.owner.token, draft); docsScope(body)["limits"].(map[string]any)["max_documents"] != float64(50) || len(docItems(body)) != 1 {
		t.Fatalf("vacancy scope: %v", body)
	}

	// A delete frees exactly one slot and `upload` comes back.
	del := f.deleteDoc(f.owner.token, p, first)
	if del.status != 200 || !reflect.DeepEqual(strs(docsScope(draftFlowObject(t, del.body))["allowed_actions"]), []string{"upload"}) {
		t.Fatalf("delete: %d %s", del.status, del.body)
	}
	f.uploadOK(f.owner.token, p, "Doc 22.pdf", bytesPDF(100))
}

// The limit counts files AND links of the participation (D15).
func TestParticipationDocuments_LimitCountsLinks(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	pid := f.participation(draft, replStages(draft)["new"])
	p := pscope(draft, pid)
	source, versions := f.insertDocument(draft, "", "Fuente", f.owner, docVersion{docPDF, 5, docsAt(0), f.owner})
	for i := 0; i < 19; i++ {
		f.uploadOK(f.owner.token, p, fmt.Sprintf("Doc %02d.pdf", i), bytesPDF(100))
	}
	// A link of this participation (P7 creates them through the API; here it is seeded).
	f.exec(`INSERT INTO placement_document_links(id,company_id,draft_id,participation_id,source_document_id,source_version_id,linked_at,linked_by) VALUES($1,$2,$3,$4,$5,$6,now(),$7)`,
		uuid.NewString(), f.company.companyID, draft, pid, source, versions[0], f.owner.userID)

	body := f.ok(f.owner.token, p)
	scope := docsScope(body)
	if scope["upload_blocked_reason"] != "limit_reached" || len(strs(scope["allowed_actions"])) != 0 ||
		!reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(19), "links": float64(1)}) || len(body["links"].([]any)) != 1 {
		t.Fatalf("scope %v links %v", scope, body["links"])
	}
	got := f.post(f.owner.token, p, nil, filePart("Una mas.pdf", bytesPDF(100)))
	draftFlowAssertError(t, got, 409, "document_limit_reached")
	if f.participationDocs(pid) != 19 {
		t.Fatalf("rows %d", f.participationDocs(pid))
	}
	// The link belongs to the participation only: the vacancy list shows no link of it.
	if links := f.ok(f.owner.token, draft)["links"].([]any); len(links) != 0 {
		t.Fatalf("vacancy links: %v", links)
	}
}

// --- audit ---------------------------------------------------------------------------------------------------------------

// Every event of a participation document carries the participation entity ids (contract «Audit events»): entity `document`, the
// document id as entity id, the vacancy of the request as vacancy_id, scope `participation` and the participation id; ids and
// enums only, never a file name; the vacancy-scope events keep their shape (no participation_id key).
func TestParticipationDocuments_AuditEventsCarryTheParticipation(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	draft := publicationFlowReady(t, f.h, ana)
	publicFlowPublish(t, f.h, draft, f.owner)
	pid := f.participation(draft, replStages(draft)["in_process"])
	p := pscope(draft, pid)

	body := f.uploadOK(ana.token, p, "Informe confidencial de Juan Pérez.pdf", bytesPDF(400))
	doc := docID(body)
	v1 := f.versionID(doc, 1)
	f.replaceOK(ana.token, p, doc, 1, "Informe v2.docx", bytesDOCX(t), namePart("Renombrado"))
	v2 := f.versionID(doc, 2)
	if got := f.versionFile(ana.token, p, doc, 1); got.status != 200 {
		t.Fatalf("download v1: %d", got.status)
	}
	if got := f.download(ana.token, p, doc); got.status != 200 {
		t.Fatalf("download current: %d", got.status)
	}
	if got := f.deleteDoc(ana.token, p, doc); got.status != 200 {
		t.Fatalf("delete: %d", got.status)
	}

	common := func(extra map[string]any) map[string]any {
		out := map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": draft, "scope": "participation", "participation_id": pid, "document_id": doc}
		for k, v := range extra {
			out[k] = v
		}
		return out
	}
	assertEvent := func(rows []auditRow, eventType string, want map[string]any) {
		t.Helper()
		if len(rows) != 1 {
			t.Fatalf("%s: %d rows", eventType, len(rows))
		}
		r := rows[0]
		if r.EventType != eventType || r.EntityType != "document" || r.EntityID.String() != doc || r.ActorID == nil || *r.ActorID != ana.userID ||
			r.CompanyID == nil || *r.CompanyID != f.company.companyID || r.VacancyID == nil || r.VacancyID.String() != draft || r.ActorType != "user" {
			t.Fatalf("%s: row %+v", eventType, r)
		}
		if !reflect.DeepEqual(r.Metadata, want) {
			t.Fatalf("%s: metadata %v\nwant %v", eventType, r.Metadata, want)
		}
		for _, v := range r.Metadata {
			if s, ok := v.(string); ok && (strings.Contains(s, "Informe") || strings.Contains(s, "Juan")) {
				t.Fatalf("%s: a file name leaked into the audit row: %v", eventType, r.Metadata)
			}
		}
	}
	assertEvent(f.participationEvents("DocumentUploaded", pid), "DocumentUploaded", common(map[string]any{"version_id": v1, "version": "1", "format": "pdf"}))
	assertEvent(f.participationEvents("DocumentReplaced", pid), "DocumentReplaced", common(map[string]any{
		"version_id": v2, "version": "2", "previous_version_id": v1, "format": "docx", "renamed": "true"}))
	assertEvent(f.participationEvents("DocumentDeleted", pid), "DocumentDeleted", common(map[string]any{"kind": "file", "version_count": "2", "linked_count": "0"}))

	downloads := f.participationEvents("DocumentDownloaded", pid)
	if len(downloads) != 2 {
		t.Fatalf("downloads: %d", len(downloads))
	}
	for i, want := range []map[string]any{
		common(map[string]any{"version_id": v1, "version": "1"}),
		common(map[string]any{"version_id": v2, "version": "2"}),
	} {
		if !reflect.DeepEqual(downloads[i].Metadata, want) || downloads[i].EventType != "DocumentDownloaded" || downloads[i].EntityType != "document" {
			t.Fatalf("download %d: %+v\nwant %v", i, downloads[i], want)
		}
	}

	// A vacancy document keeps its event shape: scope vacancy and no participation_id key.
	vdoc := docID(f.uploadOK(ana.token, draft, "Vacante.pdf", bytesPDF(100)))
	rows := auditRowsWhere(t, f.h.pool, `company_id=$1 AND event_type='DocumentUploaded' AND entity_id=$2`, f.company.companyID, vdoc)
	if len(rows) != 1 || rows[0].Metadata["scope"] != "vacancy" || rows[0].Metadata["participation_id"] != nil {
		t.Fatalf("vacancy event: %+v", rows)
	}
}

// --- idempotency -----------------------------------------------------------------------------------------------------------

// The upload's Idempotency-Key works for the participation scope; the fingerprint includes the scope and the participation id,
// so the same key and file under another participation (or under the vacancy) is a conflict, never a replay.
func TestParticipationDocuments_IdempotencyFingerprintIncludesTheParticipation(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	stages := replStages(draft)
	a, b := f.participation(draft, stages["new"]), f.participation(draft, stages["placement"])
	key := map[string]string{"Idempotency-Key": uuid.NewString()}
	file := filePart("Contrato.pdf", bytesPDF(250))

	first := f.post(f.owner.token, pscope(draft, a), key, file)
	if first.status != 201 || first.header.Get("Idempotency-Replayed") != "false" {
		t.Fatalf("first: %d %s %v", first.status, first.body, first.header)
	}
	replay := f.post(f.owner.token, pscope(draft, a), key, file)
	if replay.status != 201 || replay.header.Get("Idempotency-Replayed") != "true" || !bytes.Equal(replay.body, first.body) {
		t.Fatalf("replay: %d %s %v", replay.status, replay.body, replay.header)
	}
	if f.participationDocs(a) != 1 || f.objects() != 1 || len(f.participationEvents("DocumentUploaded", a)) != 1 {
		t.Fatalf("a replay must create nothing: rows %d objects %d", f.participationDocs(a), f.objects())
	}
	draftFlowAssertError(t, f.post(f.owner.token, pscope(draft, b), key, file), 409, "idempotency_conflict")
	draftFlowAssertError(t, f.post(f.owner.token, draft, key, file), 409, "idempotency_conflict")
	if f.participationDocs(b) != 0 || f.docCount(draft) != 1 || f.objects() != 1 {
		t.Fatalf("a conflict must create nothing: b %d total %d objects %d", f.participationDocs(b), f.docCount(draft), f.objects())
	}
}

// --- links flag ------------------------------------------------------------------------------------------------------------

// `link` appears in the scope's allowed_actions only on a CARRIED participation (D17) and only for a manager; the stage plays no
// role. Linking itself arrives in P7; the flag already tells the truth about the participation.
func TestParticipationDocuments_ScopeOffersLinkOnlyOnACarriedParticipation(t *testing.T) {
	f := newDocsUploadFlow(t)
	original := f.published()
	f.closeIt(original, "finish")
	replacement := f.published()
	f.link(replacement, original, original, 1)
	ancestor := f.participation(original, replStages(original)["placement"])
	carried := f.participation(replacement, replStages(replacement)["new"])
	fresh := f.participation(replacement, replStages(replacement)["new"])
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, carried, ancestor)
	stakeholder := f.member("stakeholder")

	for label, tc := range map[string]struct {
		draft, pid string
		actor      draftFlowActor
		want       []string
	}{
		"carried, owner":                 {replacement, carried, f.owner, []string{"upload", "link"}},
		"carried, stakeholder":           {replacement, carried, stakeholder, []string{}},
		"not carried, owner":             {replacement, fresh, f.owner, []string{"upload"}},
		"ancestor of a finished process": {original, ancestor, f.owner, []string{"upload"}},
	} {
		body := f.ok(tc.actor.token, pscope(tc.draft, tc.pid))
		if got := strs(docsScope(body)["allowed_actions"]); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s: %v want %v", label, got, tc.want)
		}
	}
	// A carried participation of the replacement is not a participation of the original: 404 through the other process.
	draftFlowAssertError(t, f.get(f.owner.token, pscope(original, carried)), 404, "not_found")
	draftFlowAssertError(t, f.get(f.owner.token, pscope(replacement, ancestor)), 404, "not_found")
}

// --- storage disabled ------------------------------------------------------------------------------------------------------

// With the storage disabled the participation routes that move a file answer 503 after their gates and after the participation
// rule (a wrong pid is still 404, never 503); the list and the delete only touch the database and keep working.
func TestParticipationDocuments_StorageDisabled(t *testing.T) {
	f := newDocsFlow(t)
	draft := f.published()
	pid := f.participation(draft, replStages(draft)["new"])
	p := pscope(draft, pid)
	doc, _ := f.insertDocument(draft, pid, "Sembrado", f.owner, docVersion{docPDF, 5, docsAt(0), f.owner})
	stakeholder := f.member("stakeholder")

	draftFlowAssertError(t, f.post(f.owner.token, p, nil, filePart("a.pdf", bytesPDF(100))), 503, "document_storage_unavailable")
	draftFlowAssertError(t, f.replace(f.owner.token, p, doc, expectedPart(1), filePart("a.pdf", bytesPDF(100))), 503, "document_storage_unavailable")
	draftFlowAssertError(t, f.download(f.owner.token, p, doc), 503, "document_storage_unavailable")
	draftFlowAssertError(t, f.versionFile(f.owner.token, p, doc, 1), 503, "document_storage_unavailable")
	// the gates and the participation rule answer first
	draftFlowAssertError(t, f.post(stakeholder.token, p, nil, filePart("a.pdf", bytesPDF(100))), 403, "forbidden")
	draftFlowAssertError(t, f.post(f.owner.token, pscope(draft, uuid.NewString()), nil, filePart("a.pdf", bytesPDF(100))), 404, "not_found")
	draftFlowAssertError(t, f.download(f.owner.token, pscope(draft, uuid.NewString()), doc), 404, "not_found")

	if got := f.versions(stakeholder.token, p, doc); got.status != 200 {
		t.Fatalf("versions: %d", got.status)
	}
	if body := f.ok(stakeholder.token, p); len(docItems(body)) != 1 {
		t.Fatalf("list: %v", body)
	}
	if got := f.deleteDoc(f.owner.token, p, doc); got.status != 200 {
		t.Fatalf("delete: %d %s", got.status, got.body)
	}
	if len(f.participationEvents("DocumentDownloaded", pid)) != 0 || len(f.participationEvents("DocumentUploaded", pid)) != 0 {
		t.Fatal("a refused request was audited")
	}
}

// --- fixtures of the store (the pid rule inside the write transaction) -------------------------------------------------------

// The store itself applies the rule: pre-flight, upload, replace and delete re-check the participation under the draft lock,
// so a participation that stops being the process's (here: removed between the pre-flight and the commit) lands nothing and the
// staged object is removed.
func TestParticipationDocuments_ParticipationGoneBetweenPreflightAndCommit(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	pid := f.participation(draft, replStages(draft)["new"])
	target := documents.ParticipationTarget(uuid.MustParse(draft), uuid.MustParse(pid))
	svc, ctx := f.service(), context.Background()

	if err := svc.PreflightUpload(ctx, f.company.companyID, f.owner.userID, target); err != nil {
		t.Fatal(err)
	}
	staged, err := svc.Stage(ctx, "a.pdf", bytes.NewReader(bytesPDF(100)))
	if err != nil {
		t.Fatal(err)
	}
	// The pid now points at nothing (the draft's participation was re-keyed elsewhere): the write transaction re-checks.
	wrong := documents.ParticipationTarget(uuid.MustParse(draft), uuid.New())
	_, err = svc.Upload(ctx, documents.UploadCommand{CompanyID: f.company.companyID, ActorID: f.owner.userID, Target: wrong, Name: "a", Staged: staged})
	if err != documents.ErrScopeNotFound {
		t.Fatalf("err = %v", err)
	}
	if f.participationDocs(pid) != 0 || f.objects() != 0 {
		t.Fatalf("rows %d objects %d", f.participationDocs(pid), f.objects())
	}
	if err := svc.PreflightUpload(ctx, f.company.companyID, f.owner.userID, wrong); err != documents.ErrScopeNotFound {
		t.Fatalf("pre-flight on a wrong pid: %v", err)
	}
	if _, err := svc.Delete(ctx, f.company.companyID, f.owner.userID, wrong, uuid.New()); err != documents.ErrScopeNotFound {
		t.Fatalf("delete on a wrong pid: %v", err)
	}
}

// The write transaction re-checks that the document belongs to the scope, not only the pre-flight: a document of participation A
// aimed at participation B or at the vacancy (and the other way round) is ErrScopeNotFound, the staged object is removed and
// nothing changes.
func TestParticipationDocuments_WriteTransactionRechecksTheScopeOfTheDocument(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	stages := replStages(draft)
	a, b := f.participation(draft, stages["new"]), f.participation(draft, stages["placement"])
	d := uuid.MustParse(draft)
	docA := uuid.MustParse(docID(f.uploadOK(f.owner.token, pscope(draft, a), "A.pdf", bytesPDF(100))))
	docVacancy := uuid.MustParse(docID(f.uploadOK(f.owner.token, draft, "V.pdf", bytesPDF(100))))
	svc, ctx := f.service(), context.Background()
	objects := f.objects()

	for label, tc := range map[string]struct {
		target documents.Target
		doc    uuid.UUID
	}{
		"participation document aimed at another participation": {documents.ParticipationTarget(d, uuid.MustParse(b)), docA},
		"participation document aimed at the vacancy":           {documents.VacancyTarget(d), docA},
		"vacancy document aimed at a participation":             {documents.ParticipationTarget(d, uuid.MustParse(a)), docVacancy},
	} {
		staged, err := svc.Stage(ctx, "x.pdf", bytes.NewReader(bytesPDF(100)))
		if err != nil {
			t.Fatal(err)
		}
		_, err = svc.Replace(ctx, documents.ReplaceCommand{CompanyID: f.company.companyID, ActorID: f.owner.userID, Target: tc.target, DocID: tc.doc, ExpectedVersion: 1, Staged: staged})
		if err != documents.ErrScopeNotFound {
			t.Fatalf("%s: replace err = %v", label, err)
		}
		if _, err := svc.Delete(ctx, f.company.companyID, f.owner.userID, tc.target, tc.doc); err != documents.ErrScopeNotFound {
			t.Fatalf("%s: delete err = %v", label, err)
		}
		if _, err := svc.PreflightReplace(ctx, f.company.companyID, f.owner.userID, tc.target, tc.doc); err != documents.ErrScopeNotFound {
			t.Fatalf("%s: pre-flight err = %v", label, err)
		}
	}
	if f.objects() != objects || f.versionCount(docA.String()) != 1 || f.versionCount(docVacancy.String()) != 1 || f.participationDocs(a) != 1 {
		t.Fatalf("a refused write changed something: objects %d (was %d)", f.objects(), objects)
	}
}
