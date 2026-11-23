//go:build integration

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/google/uuid"
)

// Replacement linking through the production router (docs/contracts/placement-vacancy-documents-v1.md, P7, S3, D16-D19, D22):
// GET …/document-sources, POST …/document-links, DELETE …/document-links/{link} and GET …/document-links/{link}/file, for the
// vacancy scope and for the participation scope. Real RequireAuth, recruiter and reader gates, the real store, service and local
// storage over a temp directory, isolated PostgreSQL. Chains, teams and lifecycle states are built through the existing routers
// and fixtures; source documents are uploaded through the documents API.

func lscope(scope string) string { return draftFlowV2Path + "/" + scope }

func (f *docsFlow) sourcesGet(token, scope string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "GET", lscope(scope)+"/document-sources", "", token, nil)
}

func (f *docsFlow) sourcesOK(token, scope string) map[string]any {
	f.t.Helper()
	got := f.sourcesGet(token, scope)
	draftFlowAssertNoStore(f.t, got)
	if got.status != 200 {
		f.t.Fatalf("GET document-sources %s: %d %s", scope, got.status, got.body)
	}
	return draftFlowObject(f.t, got.body)
}

func (f *docsFlow) linkPost(token, scope, body string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "POST", lscope(scope)+"/document-links", body, token, map[string]string{"Content-Type": "application/json"})
}

// linkBody is the request body: version 0 omits the key (pin the current version).
func linkBody(source string, version int) string {
	if version == 0 {
		return fmt.Sprintf(`{"source_document_id":%q}`, source)
	}
	return fmt.Sprintf(`{"source_document_id":%q,"version":%d}`, source, version)
}

// linkOK links a source document and returns the decoded 201 `{link, scope}`.
func (f *docsFlow) linkOK(token, scope, source string, version int) map[string]any {
	f.t.Helper()
	got := f.linkPost(token, scope, linkBody(source, version))
	draftFlowAssertNoStore(f.t, got)
	if got.status != 201 {
		f.t.Fatalf("link %s on %s: %d %s", source, scope, got.status, got.body)
	}
	return draftFlowObject(f.t, got.body)
}

func linkID(body map[string]any) string { return body["link"].(map[string]any)["id"].(string) }

func (f *docsFlow) linkDelete(token, scope, link string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "DELETE", lscope(scope)+"/document-links/"+link, "", token, nil)
}

func (f *docsFlow) linkDownload(token, scope, link string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "GET", lscope(scope)+"/document-links/"+link+"/file", "", token, nil)
}

func (f *docsFlow) linkRows(draft string) int {
	return f.count(`SELECT count(*) FROM placement_document_links WHERE draft_id=$1`, draft)
}

// chain2 is an original (published, then finished) and its replacement (published, linked as sequence 1).
func (f *docsFlow) chain2() (original, replacement string) {
	f.t.Helper()
	original = f.published()
	f.closeIt(original, "finish")
	replacement = f.published()
	f.link(replacement, original, original, 1)
	return original, replacement
}

// chain3 adds a second replacement (sequence 2, started from the first).
func (f *docsFlow) chain3() (original, first, second string) {
	f.t.Helper()
	original, first = f.chain2()
	second = f.published()
	f.link(second, first, original, 2)
	return original, first, second
}

func sourceGroups(body map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, raw := range body["sources"].([]any) {
		out = append(out, raw.(map[string]any))
	}
	return out
}

func groupDocNames(group map[string]any) []string {
	names := []string{}
	for _, raw := range group["documents"].([]any) {
		names = append(names, raw.(map[string]any)["name"].(string))
	}
	return names
}

func linkList(body map[string]any) []map[string]any {
	out := []map[string]any{}
	for _, raw := range body["links"].([]any) {
		out = append(out, raw.(map[string]any))
	}
	return out
}

func (f *docsFlow) docRows(draft string) int {
	return f.count(`SELECT count(*) FROM placement_documents WHERE draft_id=$1`, draft)
}

// --- link a pinned version and download it ---------------------------------------------------------------------------

// S3: «explicitly choose which to link to the replacement, preserving source and version references». The link pins version 1 of a
// document that has two versions; nothing is copied; the download serves the pinned bytes, audited with the link.
func TestDocumentLinks_LinkAPinnedVersionAndDownloadIt(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	original, replacement := f.chain2()
	teamAccessCollaborator(t, f.h, original, f.company.companyID, ana.userID, f.owner.userID)
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, ana.userID, f.owner.userID)

	v1 := bytesPDF(300)
	source := docID(f.uploadOK(ana.token, original, "Contrato original.pdf", v1))
	f.replaceOK(f.owner.token, original, source, 1, "Contrato v2.docx", bytesDOCX(t))
	objects := f.objects()

	got := f.linkOK(ana.token, replacement, source, 1)
	if keys := docsSorted(got); !reflect.DeepEqual(keys, []string{"link", "scope"}) {
		t.Fatalf("201 keys: %v", keys)
	}
	link := got["link"].(map[string]any)
	if !reflect.DeepEqual(docsSorted(link), []string{"allowed_actions", "id", "linked_at", "linked_by", "source", "state"}) || link["state"] != "available" ||
		!reflect.DeepEqual(strs(link["allowed_actions"]), []string{"download", "unlink"}) ||
		!reflect.DeepEqual(link["linked_by"], map[string]any{"id": ana.userID.String(), "name": "Ana López"}) {
		t.Fatalf("link: %v", link)
	}
	src := link["source"].(map[string]any)
	if !reflect.DeepEqual(docsSorted(src), []string{"document_id", "format", "has_newer_version", "name", "participation_id", "process_id", "sequence", "size", "uploaded_at", "uploaded_by", "version", "version_count"}) {
		t.Fatalf("source keys: %v", docsSorted(src))
	}
	for k, want := range map[string]any{
		"document_id": source, "process_id": original, "sequence": float64(0), "participation_id": nil, "name": "Contrato original", "format": "pdf",
		"size": float64(len(v1)), "version": float64(1), "version_count": float64(2), "has_newer_version": true,
	} {
		if src[k] != want {
			t.Errorf("source.%s = %v, want %v", k, src[k], want)
		}
	}
	if !reflect.DeepEqual(src["uploaded_by"], map[string]any{"id": ana.userID.String(), "name": "Ana López"}) {
		t.Fatalf("uploaded_by (the pinned version's): %v", src["uploaded_by"])
	}
	scope := docsScope(got)
	if !reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(0), "links": float64(1)}) || scope["can_manage"] != true ||
		!reflect.DeepEqual(strs(scope["allowed_actions"]), []string{"upload", "link"}) || scope["upload_blocked_reason"] != nil {
		t.Fatalf("scope: %v", scope)
	}

	// The 201 equals what the list reads back (the frontend does not re-read it).
	list := f.ok(ana.token, replacement)
	if !reflect.DeepEqual(list["links"], []any{link}) || !reflect.DeepEqual(list["scope"], got["scope"]) || len(list["items"].([]any)) != 0 {
		t.Fatalf("list differs from the 201:\n%v\n%v", list, got)
	}

	// No copy: the replacement owns no document or version, and storage holds exactly the source's objects.
	if f.docRows(replacement) != 0 || f.objects() != objects || f.linkRows(replacement) != 1 {
		t.Fatalf("a link must not copy: docs %d objects %d (was %d) links %d", f.docRows(replacement), f.objects(), objects, f.linkRows(replacement))
	}

	// The audit row of the link: ids and enums only.
	linked := f.events(replacement, "DocumentLinked")
	if len(linked) != 1 {
		t.Fatalf("DocumentLinked rows: %d", len(linked))
	}
	row := linked[0]
	wantMeta := map[string]any{
		"company_id": f.company.companyID.String(), "vacancy_id": replacement, "scope": "vacancy", "link_id": link["id"],
		"source_document_id": source, "source_version_id": f.versionID(source, 1), "source_vacancy_id": original,
	}
	if !reflect.DeepEqual(row.Metadata, wantMeta) || row.EntityType != "document" || row.EntityID.String() != link["id"] || row.ActorID == nil || *row.ActorID != ana.userID {
		t.Fatalf("DocumentLinked: %+v", row)
	}
	if strings.Contains(fmt.Sprint(row.Metadata), "Contrato") {
		t.Fatalf("a file name reached the audit trail: %v", row.Metadata)
	}

	// The download serves the PINNED version (v1, a PDF), not the newer docx, and is audited through the link.
	dl := f.linkDownload(ana.token, replacement, link["id"].(string))
	if dl.status != 200 || !bytes.Equal(dl.body, v1) || dl.header.Get("Content-Type") != "application/pdf" ||
		dl.header.Get("Content-Disposition") != "attachment; filename=\"Contrato original.pdf\"" || dl.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("download: %d %q %v", dl.status, dl.body, dl.header)
	}
	draftFlowAssertNoStore(t, dl)
	downloads := f.events(replacement, "DocumentDownloaded")
	if len(downloads) != 1 {
		t.Fatalf("DocumentDownloaded rows: %d", len(downloads))
	}
	if !reflect.DeepEqual(downloads[0].Metadata, map[string]any{
		"company_id": f.company.companyID.String(), "vacancy_id": replacement, "scope": "vacancy", "document_id": source,
		"version_id": f.versionID(source, 1), "version": "1", "link_id": link["id"],
	}) || downloads[0].EntityID.String() != source {
		t.Fatalf("DocumentDownloaded: %+v", downloads[0])
	}
	// The source's own route is unaffected: it still serves the CURRENT version (v2), audited against the source vacancy.
	if got := f.download(f.owner.token, original, source); got.status != 200 || !bytes.Equal(got.body, f.object(f.keyOf(source, 2))) {
		t.Fatalf("source download: %d", got.status)
	}
}

// Without `version` the link pins the source's current version at that moment, and keeps serving it after the source moves on.
func TestDocumentLinks_DefaultPinsTheCurrentVersionAndHasNewerVersionFollowsTheSource(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	first := bytesPDF(100)
	source := docID(f.uploadOK(f.owner.token, original, "Oferta.pdf", first))
	second := bytesPDF(200)
	f.replaceOK(f.owner.token, original, source, 1, "Oferta.pdf", second)

	link := f.linkOK(f.owner.token, replacement, source, 0)["link"].(map[string]any)
	src := link["source"].(map[string]any)
	if src["version"] != float64(2) || src["version_count"] != float64(2) || src["has_newer_version"] != false || src["size"] != float64(len(second)) {
		t.Fatalf("default pin: %v", src)
	}

	// The source is replaced again: the link stays on version 2 and says there is a newer one.
	third := bytesPDF(300)
	f.replaceOK(f.owner.token, original, source, 2, "Oferta.pdf", third)
	got := linkList(f.ok(f.owner.token, replacement))[0]
	src = got["source"].(map[string]any)
	if src["version"] != float64(2) || src["version_count"] != float64(3) || src["has_newer_version"] != true || src["size"] != float64(len(second)) || got["state"] != "available" {
		t.Fatalf("after a source replace: %v", got)
	}
	if dl := f.linkDownload(f.owner.token, replacement, link["id"].(string)); dl.status != 200 || !bytes.Equal(dl.body, second) {
		t.Fatalf("the link must keep serving the pinned bytes: %d %d bytes", dl.status, len(dl.body))
	}
}

// --- the sources list ------------------------------------------------------------------------------------------------

// D22: grouped by origin, only real files, original first, with already_linked; a process of another chain, a later process and
// participation documents are not sources of a vacancy-level link; links of links do not exist.
func TestDocumentLinks_SourcesAreTheEarlierProcessesOfTheChain(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, first, second := f.chain3()
	foreign := f.published() // a different logical vacancy of the same company
	f.closeIt(foreign, "finish")

	docOriginal := docID(f.uploadOK(f.owner.token, original, "Contrato original.pdf", bytesPDF(100)))
	f.replaceOK(f.owner.token, original, docOriginal, 1, "Contrato original.pdf", bytesPDF(110))
	docFirst := docID(f.uploadOK(f.owner.token, first, "Adenda uno.pdf", bytesPDF(120)))
	f.uploadOK(f.owner.token, first, "Adenda dos.pdf", bytesPDF(130))
	f.uploadOK(f.owner.token, second, "Propio de la segunda.pdf", bytesPDF(140))
	f.uploadOK(f.owner.token, foreign, "Otra vacante.pdf", bytesPDF(150))
	pid := f.participation(original, replStages(original)["placement"])
	f.uploadOK(f.owner.token, pscope(original, pid), "Del candidato.pdf", bytesPDF(160))
	// first's own link to the original's document is not a file: the second replacement never lists it as a source.
	f.linkOK(f.owner.token, first, docOriginal, 0)

	body := f.sourcesOK(f.owner.token, second)
	if body["can_link"] != true || !reflect.DeepEqual(docsSorted(body), []string{"can_link", "sources"}) {
		t.Fatalf("body: %v", body)
	}
	groups := sourceGroups(body)
	if len(groups) != 2 {
		t.Fatalf("groups: %v", body["sources"])
	}
	// Original first, then the first replacement; each group names its process, sequence and (null) participation.
	for i, want := range []struct {
		process  string
		sequence float64
		names    []string
	}{
		{original, 0, []string{"Contrato original"}},
		{first, 1, []string{"Adenda dos", "Adenda uno"}}, // newest first
	} {
		g := groups[i]
		if !reflect.DeepEqual(docsSorted(g), []string{"documents", "participation_id", "process_id", "sequence"}) ||
			g["process_id"] != want.process || g["sequence"] != want.sequence || g["participation_id"] != nil || !reflect.DeepEqual(groupDocNames(g), want.names) {
			t.Fatalf("group %d: %v", i, g)
		}
	}
	first0 := groups[0]["documents"].([]any)[0].(map[string]any)
	if !reflect.DeepEqual(docsSorted(first0), []string{"already_linked", "format", "id", "name", "size", "updated_at", "version", "version_count"}) ||
		first0["id"] != docOriginal || first0["version"] != float64(2) || first0["version_count"] != float64(2) || first0["format"] != "pdf" || first0["size"] != float64(110) || first0["already_linked"] != false {
		t.Fatalf("source document: %v", first0)
	}

	// The first replacement sees only the original; the original (not a replacement) has no sources at all.
	if g := sourceGroups(f.sourcesOK(f.owner.token, first)); len(g) != 1 || g[0]["process_id"] != original {
		t.Fatalf("first replacement sources: %v", g)
	}
	notReplacement := f.sourcesOK(f.owner.token, original)
	if notReplacement["can_link"] != false || len(notReplacement["sources"].([]any)) != 0 {
		t.Fatalf("original: %v", notReplacement)
	}

	// already_linked is per scope: linking in the second replacement flips it there only.
	f.linkOK(f.owner.token, second, docFirst, 0)
	for _, g := range sourceGroups(f.sourcesOK(f.owner.token, second)) {
		for _, raw := range g["documents"].([]any) {
			d := raw.(map[string]any)
			if want := d["id"] == docFirst; d["already_linked"] != want {
				t.Fatalf("already_linked of %v = %v", d["name"], d["already_linked"])
			}
		}
	}
	if g := sourceGroups(f.sourcesOK(f.owner.token, first)); g[0]["documents"].([]any)[0].(map[string]any)["already_linked"] != true {
		t.Fatalf("the first replacement linked the original's document: %v", g)
	}
}

// D18: a source the caller cannot read is omitted from the list; a stakeholder reads every source but cannot link.
func TestDocumentLinks_SourcesFollowSourceAccess(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))

	onBoth := f.member("recruiter")
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, onBoth.userID, f.owner.userID)
	teamAccessCollaborator(t, f.h, original, f.company.companyID, onBoth.userID, f.owner.userID)
	targetOnly := f.member("recruiter")
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, targetOnly.userID, f.owner.userID)
	stakeholder := f.member("stakeholder")

	for name, tc := range map[string]struct {
		actor   draftFlowActor
		groups  int
		canLink bool
	}{
		"owner":                   {f.owner, 1, true},
		"a member of both teams":  {onBoth, 1, true},
		"a member of the target":  {targetOnly, 0, true}, // can link in principle, sees nothing to link
		"stakeholder (read-only)": {stakeholder, 1, false},
	} {
		body := f.sourcesOK(tc.actor.token, replacement)
		if len(sourceGroups(body)) != tc.groups || body["can_link"] != tc.canLink {
			t.Fatalf("%s: %v", name, body)
		}
	}
	// The omitted source answers like a missing one (no leak).
	missing := f.linkPost(targetOnly.token, replacement, linkBody(uuid.NewString(), 0))
	hidden := f.linkPost(targetOnly.token, replacement, linkBody(source, 0))
	draftFlowAssertError(t, missing, 404, "not_found")
	draftFlowAssertError(t, hidden, 404, "not_found")
	if string(missing.body) != string(hidden.body) {
		t.Fatalf("the refusal leaks: %s vs %s", missing.body, hidden.body)
	}
	if f.linkRows(replacement) != 0 {
		t.Fatal("a refused link created a row")
	}
}

// can_link is the scope's `link` action: false when the scope is full.
func TestDocumentLinks_SourcesCanLinkIsFalseWhenTheScopeIsFull(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100))
	for i := 0; i < 50; i++ {
		f.insertDocument(replacement, "", fmt.Sprintf("Documento %02d", i), f.owner, docVersion{docPDF, 1, docsAt(i), f.owner})
	}
	body := f.sourcesOK(f.owner.token, replacement)
	if body["can_link"] != false || len(sourceGroups(body)) != 1 {
		t.Fatalf("full scope: %v", body)
	}
}

// --- participation scope ---------------------------------------------------------------------------------------------

// D17: a carried participation links documents of its ancestors, nearest first; a participation that is not carried, or a
// document of a participation that is not an ancestor, is refused; the vacancy documents are not sources of a participation.
func TestDocumentLinks_ParticipationScopeFollowsTheAncestors(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, first, second := f.chain3()
	a := f.participation(original, replStages(original)["placement"])
	b := f.participation(first, replStages(first)["new"])
	c := f.participation(second, replStages(second)["new"])
	fresh := f.participation(second, replStages(second)["new"])
	unrelated := f.participation(original, replStages(original)["screening"])
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, b, a)
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, c, b)
	// Another carried participation of the same process descends from the unrelated one: its ancestry is not c's.
	d := f.participation(second, replStages(second)["new"])
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, d, unrelated)

	docA := docID(f.uploadOK(f.owner.token, pscope(original, a), "Contrato firmado.pdf", bytesPDF(100)))
	docB := docID(f.uploadOK(f.owner.token, pscope(first, b), "Oferta v2.pdf", bytesPDF(110)))
	docUnrelated := docID(f.uploadOK(f.owner.token, pscope(original, unrelated), "De otra persona.pdf", bytesPDF(120)))
	docVacancy := docID(f.uploadOK(f.owner.token, original, "Del proceso.pdf", bytesPDF(130)))
	target := pscope(second, c)

	body := f.sourcesOK(f.owner.token, target)
	groups := sourceGroups(body)
	if body["can_link"] != true || len(groups) != 2 {
		t.Fatalf("sources: %v", body)
	}
	// Nearest ancestor first: b (process `first`), then a (process `original`).
	for i, want := range []struct {
		process, participation string
		sequence               float64
		names                  []string
	}{{first, b, 1, []string{"Oferta v2"}}, {original, a, 0, []string{"Contrato firmado"}}} {
		g := groups[i]
		if g["process_id"] != want.process || g["participation_id"] != want.participation || g["sequence"] != want.sequence || !reflect.DeepEqual(groupDocNames(g), want.names) {
			t.Fatalf("group %d: %v", i, g)
		}
	}
	// A participation that is not carried has nothing to link; the vacancy-level list is another scope.
	if body := f.sourcesOK(f.owner.token, pscope(second, fresh)); body["can_link"] != false || len(body["sources"].([]any)) != 0 {
		t.Fatalf("not carried: %v", body)
	}
	// The vacancy-level list is another scope: it offers the original's vacancy document, not the participation documents.
	if got := sourceGroups(f.sourcesOK(f.owner.token, second)); len(got) != 1 || got[0]["process_id"] != original || !reflect.DeepEqual(groupDocNames(got[0]), []string{"Del proceso"}) {
		t.Fatalf("vacancy sources: %v", got)
	}

	link := f.linkOK(f.owner.token, target, docA, 0)
	src := link["link"].(map[string]any)["source"].(map[string]any)
	if src["participation_id"] != a || src["process_id"] != original || src["name"] != "Contrato firmado" || src["sequence"] != float64(0) {
		t.Fatalf("participation link source: %v", src)
	}
	f.linkOK(f.owner.token, target, docB, 0)
	if !reflect.DeepEqual(docsScope(link)["counts"], map[string]any{"documents": float64(0), "links": float64(1)}) || docsScope(link)["limits"].(map[string]any)["max_documents"] != float64(20) {
		t.Fatalf("participation scope: %v", docsScope(link))
	}
	// The scopes never mix: the vacancy list of `second` shows no link of this participation.
	if len(linkList(f.ok(f.owner.token, second))) != 0 || len(linkList(f.ok(f.owner.token, target))) != 2 {
		t.Fatal("participation links leaked into the vacancy list")
	}

	// Refused: a not-carried participation, a document of a non-ancestor, a vacancy document.
	got := f.linkPost(f.owner.token, pscope(second, fresh), linkBody(docA, 0))
	draftFlowAssertError(t, got, 422, "document_link_invalid")
	if got := linkErrData(t, got); got["reason"] != "not_replacement" {
		t.Fatalf("not carried: %v", got)
	}
	for name, doc := range map[string]string{"non-ancestor participation": docUnrelated, "vacancy document": docVacancy} {
		got := f.linkPost(f.owner.token, target, linkBody(doc, 0))
		draftFlowAssertError(t, got, 422, "document_link_invalid")
		if d := linkErrData(t, got); d["reason"] != "source_not_in_chain" {
			t.Fatalf("%s: %v", name, d)
		}
	}
	// And the other way round: a participation document is not a source of a vacancy-level link.
	got = f.linkPost(f.owner.token, second, linkBody(docA, 0))
	draftFlowAssertError(t, got, 422, "document_link_invalid")
	if d := linkErrData(t, got); d["reason"] != "source_not_in_chain" {
		t.Fatalf("participation doc on a vacancy scope: %v", d)
	}

	// Download through the participation link: audited with the participation entity ids.
	linkA := linkList(f.ok(f.owner.token, target))
	var forA string
	for _, l := range linkA {
		if l["source"].(map[string]any)["document_id"] == docA {
			forA = l["id"].(string)
		}
	}
	dl := f.linkDownload(f.owner.token, target, forA)
	if dl.status != 200 || !bytes.Equal(dl.body, bytesPDF(100)) {
		t.Fatalf("download: %d", dl.status)
	}
	rows := f.participationEvents("DocumentDownloaded", c)
	if len(rows) != 1 || rows[0].Metadata["scope"] != "participation" || rows[0].Metadata["link_id"] != forA || rows[0].Metadata["document_id"] != docA || rows[0].Metadata["vacancy_id"] != second {
		t.Fatalf("participation link download audit: %+v", rows)
	}
	linked := f.participationEvents("DocumentLinked", c)
	if len(linked) != 2 {
		t.Fatalf("DocumentLinked rows: %d", len(linked))
	}
	var meta map[string]any
	for _, r := range linked {
		if r.Metadata["source_document_id"] == docA {
			meta = r.Metadata
		}
	}
	if !reflect.DeepEqual(meta, map[string]any{
		"company_id": f.company.companyID.String(), "vacancy_id": second, "scope": "participation", "participation_id": c, "link_id": forA,
		"source_document_id": docA, "source_version_id": f.versionID(docA, 1), "source_vacancy_id": original, "source_participation_id": a,
	}) {
		t.Fatalf("DocumentLinked metadata: %v", meta)
	}

	// Unlink in the participation scope is audited as a participation event and leaves the source alone.
	if got := f.linkDelete(f.owner.token, target, forA); got.status != 200 {
		t.Fatalf("unlink: %d %s", got.status, got.body)
	}
	deleted := f.participationEvents("DocumentDeleted", c)
	if len(deleted) != 1 || deleted[0].Metadata["kind"] != "link" || deleted[0].Metadata["link_id"] != forA {
		t.Fatalf("unlink audit: %+v", deleted)
	}
	if f.participationDocs(a) != 1 {
		t.Fatal("unlink touched the source")
	}
}

// --- validation order ------------------------------------------------------------------------------------------------

func linkErrData(t *testing.T, got draftFlowResponse) map[string]any {
	t.Helper()
	data, _ := draftFlowObject(t, got.body)["data"].(map[string]any)
	return data
}

// A process that is not a replacement answers 422 document_link_invalid reason not_replacement BEFORE it looks at the source.
func TestDocumentLinks_NotAReplacementIsAContractError(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, _ := f.chain2()
	plain := f.published()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	for name, tc := range map[string]struct{ target, source string }{
		"the original of a chain":      {original, source},
		"a plain vacancy":              {plain, source},
		"a source that does not exist": {plain, uuid.NewString()},
	} {
		got := f.linkPost(f.owner.token, tc.target, linkBody(tc.source, 0))
		draftFlowAssertError(t, got, 422, "document_link_invalid")
		if d := linkErrData(t, got); !reflect.DeepEqual(d, map[string]any{"reason": "not_replacement"}) {
			t.Fatalf("%s: %v", name, d)
		}
		if f.linkRows(tc.target) != 0 {
			t.Fatalf("%s: a row was created", name)
		}
	}
	// The scope never offers `link` there.
	for _, draft := range []string{original, plain} {
		if got := strs(docsScope(f.ok(f.owner.token, draft))["allowed_actions"]); !reflect.DeepEqual(got, []string{"upload"}) {
			t.Fatalf("%s scope actions: %v", draft, got)
		}
	}
}

// A source of a later process, of the target itself or of another chain is source_not_in_chain; a missing one is 404; a link id
// is not a document (links of links are impossible).
func TestDocumentLinks_OnlyEarlierProcessesOfTheChain(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, first, second := f.chain3()
	foreign := f.published()
	f.closeIt(foreign, "finish")
	foreignReplacement := f.published()
	f.link(foreignReplacement, foreign, foreign, 1)

	docOriginal := docID(f.uploadOK(f.owner.token, original, "Original.pdf", bytesPDF(100)))
	docFirst := docID(f.uploadOK(f.owner.token, first, "Primera.pdf", bytesPDF(100)))
	docSecond := docID(f.uploadOK(f.owner.token, second, "Segunda.pdf", bytesPDF(100)))
	docForeign := docID(f.uploadOK(f.owner.token, foreign, "Otra cadena.pdf", bytesPDF(100)))

	notInChain := func(label, target, source string) {
		t.Helper()
		got := f.linkPost(f.owner.token, target, linkBody(source, 0))
		draftFlowAssertError(t, got, 422, "document_link_invalid")
		if d := linkErrData(t, got); !reflect.DeepEqual(d, map[string]any{"reason": "source_not_in_chain"}) {
			t.Fatalf("%s: %v", label, d)
		}
	}
	notInChain("a later process", first, docSecond)
	notInChain("itself", second, docSecond)
	notInChain("another chain", second, docForeign)
	notInChain("a later process of another chain", foreignReplacement, docFirst)
	if f.linkRows(first)+f.linkRows(second)+f.linkRows(foreignReplacement) != 0 {
		t.Fatal("a refused link created a row")
	}

	// The legal ones: earlier processes of the chain, skipping generations included.
	f.linkOK(f.owner.token, second, docOriginal, 0)
	f.linkOK(f.owner.token, second, docFirst, 0)
	linkOfFirst := f.linkOK(f.owner.token, first, docOriginal, 0)

	// A link is not a document: its id is no source (the sources list never offers one either).
	draftFlowAssertError(t, f.linkPost(f.owner.token, second, linkBody(linkID(linkOfFirst), 0)), 404, "not_found")
	for _, g := range sourceGroups(f.sourcesOK(f.owner.token, second)) {
		for _, raw := range g["documents"].([]any) {
			if raw.(map[string]any)["id"] == linkID(linkOfFirst) {
				t.Fatal("a link is listed as a source")
			}
		}
	}
	// An unknown document: 404.
	draftFlowAssertError(t, f.linkPost(f.owner.token, second, linkBody(uuid.NewString(), 0)), 404, "not_found")
}

// The source of another company is a plain 404, never a contract error.
func TestDocumentLinks_ForeignCompanySourceIsNotFound(t *testing.T) {
	f := newDocsUploadFlow(t)
	_, replacement := f.chain2()
	foreignCompany, foreignOwnerID, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	foreignOwner := f.h.actor(t, foreignOwnerID, foreignSub)
	foreignDraft := publicationFlowReady(t, f.h, foreignOwner)
	doc := uuid.NewString()
	f.exec(`INSERT INTO placement_documents(id,company_id,draft_id,participation_id,name,created_at,created_by) VALUES($1,$2,$3,NULL,'Ajeno',now(),$4)`, doc, foreignCompany.companyID, foreignDraft, foreignOwnerID)
	t.Cleanup(func() { f.exec(`DELETE FROM placement_documents WHERE id=$1`, doc) })
	draftFlowAssertError(t, f.linkPost(f.owner.token, replacement, linkBody(doc, 0)), 404, "not_found")
}

func TestDocumentLinks_PinnedVersionMustExist(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	for _, version := range []int{2, 7, 999999999} {
		got := f.linkPost(f.owner.token, replacement, linkBody(source, version))
		draftFlowAssertError(t, got, 422, "document_link_invalid")
		if d := linkErrData(t, got); !reflect.DeepEqual(d, map[string]any{"reason": "version_not_found"}) {
			t.Fatalf("version %d: %v", version, d)
		}
	}
	if f.linkRows(replacement) != 0 {
		t.Fatal("a refused link created a row")
	}
	f.linkOK(f.owner.token, replacement, source, 1)
}

// D26: no Idempotency-Key; a repeated request is document_already_linked with the existing link id, whatever version it names.
// The already-linked answer wins over the limit.
func TestDocumentLinks_AlreadyLinked(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	f.replaceOK(f.owner.token, original, source, 1, "Contrato.pdf", bytesPDF(110))
	link := linkID(f.linkOK(f.owner.token, replacement, source, 1))

	for _, version := range []int{0, 1, 2} {
		got := f.linkPost(f.owner.token, replacement, linkBody(source, version))
		draftFlowAssertError(t, got, 409, "document_already_linked")
		if d := linkErrData(t, got); !reflect.DeepEqual(d, map[string]any{"link_id": link}) {
			t.Fatalf("version %d: %v", version, d)
		}
	}
	if f.linkRows(replacement) != 1 || len(f.events(replacement, "DocumentLinked")) != 1 {
		t.Fatal("a repeated request must create nothing")
	}

	// Unlink, then the same document links again (a new link id).
	if got := f.linkDelete(f.owner.token, replacement, link); got.status != 200 {
		t.Fatalf("unlink: %d %s", got.status, got.body)
	}
	if again := linkID(f.linkOK(f.owner.token, replacement, source, 2)); again == link {
		t.Fatal("the new link reuses the old id")
	}

	// Full scope + already linked: already_linked, not limit_reached.
	for i := 0; i < 49; i++ {
		f.insertDocument(replacement, "", fmt.Sprintf("Documento %02d", i), f.owner, docVersion{docPDF, 1, docsAt(i), f.owner})
	}
	got := f.linkPost(f.owner.token, replacement, linkBody(source, 0))
	draftFlowAssertError(t, got, 409, "document_already_linked")
}

// Eight identical requests racing: the draft lock serializes them, exactly one link and one audit row exist.
func TestDocumentLinks_ConcurrentIdenticalRequestsLinkOnce(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))

	statuses := make([]int, 8)
	var wg sync.WaitGroup
	for i := range statuses {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			resp, err := f.docs.roundTrip("POST", lscope(replacement)+"/document-links", linkBody(source, 0), f.owner.token, map[string]string{"Content-Type": "application/json"})
			if err != nil {
				statuses[i] = -1
				return
			}
			statuses[i] = resp.status
		}(i)
	}
	wg.Wait()
	created, conflicts := 0, 0
	for _, s := range statuses {
		switch s {
		case 201:
			created++
		case 409:
			conflicts++
		}
	}
	if created != 1 || conflicts != 7 || f.linkRows(replacement) != 1 || len(f.events(replacement, "DocumentLinked")) != 1 {
		t.Fatalf("statuses %v rows %d events %d", statuses, f.linkRows(replacement), len(f.events(replacement, "DocumentLinked")))
	}
}

// The request body: strict JSON, nothing outside the two keys, checked before anything is looked up.
func TestDocumentLinks_RequestBodyIsStrict(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	for name, body := range map[string]string{
		"empty":               "",
		"not json":            "source_document_id=" + source,
		"an array":            "[]",
		"a string":            `"` + source + `"`,
		"null":                "null",
		"no source":           `{}`,
		"not a uuid":          `{"source_document_id":"contrato"}`,
		"a number":            `{"source_document_id":7}`,
		"unknown key":         `{"source_document_id":"` + source + `","copy":true}`,
		"version zero":        `{"source_document_id":"` + source + `","version":0}`,
		"negative version":    `{"source_document_id":"` + source + `","version":-1}`,
		"version as a string": `{"source_document_id":"` + source + `","version":"1"}`,
		"decimal version":     `{"source_document_id":"` + source + `","version":1.5}`,
		"null version":        `{"source_document_id":"` + source + `","version":null}`,
		"huge version":        `{"source_document_id":"` + source + `","version":99999999999999999999}`,
		"two documents":       `{"source_document_id":"` + source + `"}{"source_document_id":"` + source + `"}`,
		"trailing garbage":    `{"source_document_id":"` + source + `"} x`,
		"over the body limit": `{"source_document_id":"` + source + `","x":"` + strings.Repeat("a", 16384) + `"}`,
	} {
		draftFlowAssertError(t, f.linkPost(f.owner.token, replacement, body), 400, "invalid_request")
		if f.linkRows(replacement) != 0 {
			t.Fatalf("%s: a row was created", name)
		}
	}
	if len(f.events(replacement, "DocumentLinked")) != 0 {
		t.Fatal("a refused body was audited")
	}
	f.linkOK(f.owner.token, replacement, source, 1)
}

// --- limits ----------------------------------------------------------------------------------------------------------

// D15: files plus links, 50 per vacancy: 49 files and a link fill it, and the next link is document_limit_reached.
func TestDocumentLinks_LimitCountsFilesAndLinks(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	one := docID(f.uploadOK(f.owner.token, original, "Uno.pdf", bytesPDF(100)))
	two := docID(f.uploadOK(f.owner.token, original, "Dos.pdf", bytesPDF(100)))
	for i := 0; i < 49; i++ {
		f.insertDocument(replacement, "", fmt.Sprintf("Documento %02d", i), f.owner, docVersion{docPDF, 1, docsAt(i), f.owner})
	}

	got := f.linkOK(f.owner.token, replacement, one, 0)
	scope := docsScope(got)
	if !reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(49), "links": float64(1)}) || len(strs(scope["allowed_actions"])) != 0 || scope["upload_blocked_reason"] != "limit_reached" {
		t.Fatalf("the full scope: %v", scope)
	}
	refused := f.linkPost(f.owner.token, replacement, linkBody(two, 0))
	draftFlowAssertError(t, refused, 409, "document_limit_reached")
	if d := linkErrData(t, refused); !reflect.DeepEqual(d, map[string]any{"kind": "documents", "limit": float64(50)}) {
		t.Fatalf("limit data: %v", d)
	}
	if f.linkRows(replacement) != 1 || len(f.events(replacement, "DocumentLinked")) != 1 {
		t.Fatal("a refused link left something behind")
	}
	// A file cannot be uploaded either; unlinking frees the slot and both come back.
	draftFlowAssertError(t, f.post(f.owner.token, replacement, nil, filePart("sobra.pdf", bytesPDF(30))), 409, "document_limit_reached")
	freed := f.linkDelete(f.owner.token, replacement, linkID(got))
	if freed.status != 200 || !reflect.DeepEqual(strs(docsScope(draftFlowObject(t, freed.body))["allowed_actions"]), []string{"upload", "link"}) {
		t.Fatalf("unlink: %d %s", freed.status, freed.body)
	}
	f.linkOK(f.owner.token, replacement, two, 0)
}

// 20 per participation: 19 files and a link fill it.
func TestDocumentLinks_ParticipationLimitIsTwenty(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	a := f.participation(original, replStages(original)["placement"])
	c := f.participation(replacement, replStages(replacement)["new"])
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, c, a)
	one := docID(f.uploadOK(f.owner.token, pscope(original, a), "Uno.pdf", bytesPDF(100)))
	two := docID(f.uploadOK(f.owner.token, pscope(original, a), "Dos.pdf", bytesPDF(100)))
	target := pscope(replacement, c)
	for i := 0; i < 19; i++ {
		f.insertDocument(replacement, c, fmt.Sprintf("Documento %02d", i), f.owner, docVersion{docPDF, 1, docsAt(i), f.owner})
	}
	f.linkOK(f.owner.token, target, one, 0)
	got := f.linkPost(f.owner.token, target, linkBody(two, 0))
	draftFlowAssertError(t, got, 409, "document_limit_reached")
	if d := linkErrData(t, got); !reflect.DeepEqual(d, map[string]any{"kind": "documents", "limit": float64(20)}) {
		t.Fatalf("limit data: %v", d)
	}
	if body := f.sourcesOK(f.owner.token, target); body["can_link"] != false {
		t.Fatalf("full participation: %v", body)
	}
}

// --- states ----------------------------------------------------------------------------------------------------------

// D19: deleting the source leaves the link «removed»: no source, only unlink for a manager, nothing for a stakeholder, 404 on
// download without an audit row; unlinking still works.
func TestDocumentLinks_DeletedSourceMakesTheLinkRemoved(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	stakeholder := f.member("stakeholder")
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	link := linkID(f.linkOK(f.owner.token, replacement, source, 0))

	if got := f.deleteDoc(f.owner.token, original, source); got.status != 200 {
		t.Fatalf("delete source: %d %s", got.status, got.body)
	}
	for _, tc := range []struct {
		actor draftFlowActor
		want  []string
	}{{f.owner, []string{"unlink"}}, {stakeholder, []string{}}} {
		l := linkList(f.ok(tc.actor.token, replacement))[0]
		if l["state"] != "removed" || l["source"] != nil || l["id"] != link || !reflect.DeepEqual(strs(l["allowed_actions"]), tc.want) {
			t.Fatalf("removed link: %v", l)
		}
	}
	draftFlowAssertError(t, f.linkDownload(f.owner.token, replacement, link), 404, "not_found")
	draftFlowAssertError(t, f.linkDownload(stakeholder.token, replacement, link), 404, "not_found")
	if len(f.events(replacement, "DocumentDownloaded")) != 0 {
		t.Fatal("a refused link download was audited")
	}
	// The source's delete audit counts the link that lost its source.
	if deleted := f.events(original, "DocumentDeleted"); len(deleted) != 1 || deleted[0].Metadata["linked_count"] != "1" {
		t.Fatalf("source delete audit: %+v", deleted)
	}
	// A removed link still counts towards the limit until it is unlinked; unlinking works and is audited.
	if got := docsScope(f.ok(f.owner.token, replacement))["counts"]; !reflect.DeepEqual(got, map[string]any{"documents": float64(0), "links": float64(1)}) {
		t.Fatalf("counts: %v", got)
	}
	if got := f.linkDelete(f.owner.token, replacement, link); got.status != 200 {
		t.Fatalf("unlink a removed link: %d %s", got.status, got.body)
	}
	if len(linkList(f.ok(f.owner.token, replacement))) != 0 || len(f.events(replacement, "DocumentDeleted")) != 1 {
		t.Fatal("the removed link is still there")
	}
}

// D18: a viewer who has the target but lost the source sees the link as inaccessible (no name, size or download); somebody who
// can still read the source sees it available. A stakeholder reads every source of the organization.
func TestDocumentLinks_LosingSourceAccessMakesTheLinkInaccessible(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	stakeholder := f.member("stakeholder")
	rita := f.name(f.member("recruiter"), "Rita")
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, rita.userID, f.owner.userID)
	onSource := teamAccessCollaborator(t, f.h, original, f.company.companyID, rita.userID, f.owner.userID)
	source := docID(f.uploadOK(rita.token, original, "Confidencial de Juan Pérez.pdf", bytesPDF(100)))
	link := linkID(f.linkOK(rita.token, replacement, source, 0))
	if l := linkList(f.ok(rita.token, replacement))[0]; l["state"] != "available" {
		t.Fatalf("before: %v", l)
	}
	if dl := f.linkDownload(rita.token, replacement, link); dl.status != 200 {
		t.Fatalf("before: %d", dl.status)
	}
	events := len(f.events(replacement, "DocumentDownloaded"))

	teamAccessEndCollaborator(t, f.h, onSource, f.owner.userID) // Rita leaves the source vacancy's team, stays on the replacement's

	got := f.get(rita.token, replacement)
	l := linkList(draftFlowObject(t, got.body))[0]
	if l["state"] != "inaccessible" || l["source"] != nil || !reflect.DeepEqual(strs(l["allowed_actions"]), []string{"unlink"}) {
		t.Fatalf("after: %v", l)
	}
	for _, leaked := range []string{"Confidencial", "Juan", source} {
		if strings.Contains(string(got.body), leaked) {
			t.Fatalf("an inaccessible link leaked %q: %s", leaked, got.body)
		}
	}
	draftFlowAssertError(t, f.linkDownload(rita.token, replacement, link), 404, "not_found")
	if len(f.events(replacement, "DocumentDownloaded")) != events {
		t.Fatal("a refused link download was audited")
	}
	// The owner and a stakeholder still read the source through the same link.
	for _, a := range []draftFlowActor{f.owner, stakeholder} {
		if l := linkList(f.ok(a.token, replacement))[0]; l["state"] != "available" {
			t.Fatalf("%v: %v", a.userID, l)
		}
		if dl := f.linkDownload(a.token, replacement, link); dl.status != 200 {
			t.Fatalf("%v download: %d", a.userID, dl.status)
		}
	}
	// She can still unlink it, and only that.
	if got := f.linkDelete(rita.token, replacement, link); got.status != 200 {
		t.Fatalf("unlink: %d %s", got.status, got.body)
	}
}

// The stakeholder reads, lists sources and downloads through a link, and never writes.
func TestDocumentLinks_StakeholderIsReadOnly(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	stakeholder := f.member("stakeholder")
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	other := docID(f.uploadOK(f.owner.token, original, "Otro.pdf", bytesPDF(100)))
	link := linkID(f.linkOK(f.owner.token, replacement, source, 0))

	draftFlowAssertError(t, f.linkPost(stakeholder.token, replacement, linkBody(other, 0)), 403, "forbidden")
	draftFlowAssertError(t, f.linkDelete(stakeholder.token, replacement, link), 403, "forbidden")
	if f.linkRows(replacement) != 1 || len(f.events(replacement, "DocumentLinked")) != 1 || len(f.events(replacement, "DocumentDeleted")) != 0 {
		t.Fatal("a stakeholder changed something")
	}
	body := f.ok(stakeholder.token, replacement)
	l := linkList(body)[0]
	if docsScope(body)["can_manage"] != false || len(strs(docsScope(body)["allowed_actions"])) != 0 || !reflect.DeepEqual(strs(l["allowed_actions"]), []string{"download"}) {
		t.Fatalf("stakeholder view: %v", body)
	}
	if got := f.sourcesOK(stakeholder.token, replacement); got["can_link"] != false || len(sourceGroups(got)) != 1 {
		t.Fatalf("stakeholder sources: %v", got)
	}
	if dl := f.linkDownload(stakeholder.token, replacement, link); dl.status != 200 || !bytes.Equal(dl.body, bytesPDF(100)) {
		t.Fatalf("stakeholder download: %d", dl.status)
	}
	rows := f.events(replacement, "DocumentDownloaded")
	if len(rows) != 1 || rows[0].ActorID == nil || *rows[0].ActorID != stakeholder.userID {
		t.Fatalf("download audit: %+v", rows)
	}
}

// --- unlink ----------------------------------------------------------------------------------------------------------

// Unlink: 200 {scope}, audited as DocumentDeleted kind link, the source and its files untouched, the slot freed.
func TestDocumentLinks_UnlinkIsAuditedAndLeavesTheSourceAlone(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	link := linkID(f.linkOK(f.owner.token, replacement, source, 0))
	objects := f.objects()

	got := f.linkDelete(f.owner.token, replacement, link)
	draftFlowAssertNoStore(t, got)
	body := draftFlowObject(t, got.body)
	if got.status != 200 || !reflect.DeepEqual(docsSorted(body), []string{"scope"}) ||
		!reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(0), "links": float64(0)}) {
		t.Fatalf("unlink: %d %s", got.status, got.body)
	}
	if f.linkRows(replacement) != 0 || f.objects() != objects || f.docRows(original) != 1 || f.versionCount(source) != 1 {
		t.Fatal("the source must stay untouched")
	}
	if dl := f.download(f.owner.token, original, source); dl.status != 200 {
		t.Fatalf("source download: %d", dl.status)
	}
	deleted := f.events(replacement, "DocumentDeleted")
	if len(deleted) != 1 {
		t.Fatalf("DocumentDeleted rows: %d", len(deleted))
	}
	if !reflect.DeepEqual(deleted[0].Metadata, map[string]any{
		"company_id": f.company.companyID.String(), "vacancy_id": replacement, "scope": "vacancy", "kind": "link", "link_id": link,
	}) || deleted[0].EntityType != "document" || deleted[0].EntityID.String() != link || deleted[0].ActorID == nil || *deleted[0].ActorID != f.owner.userID {
		t.Fatalf("unlink audit: %+v", deleted[0])
	}
	// Gone: a repeated unlink and a download through it are 404, and nothing else is audited.
	draftFlowAssertError(t, f.linkDelete(f.owner.token, replacement, link), 404, "not_found")
	draftFlowAssertError(t, f.linkDownload(f.owner.token, replacement, link), 404, "not_found")
	if len(f.events(replacement, "DocumentDeleted")) != 1 || len(f.events(replacement, "DocumentDownloaded")) != 0 {
		t.Fatal("a refused request was audited")
	}
}

// A link answers only through its own scope: the other process, the participation scope and the vacancy scope are 404.
func TestDocumentLinks_ALinkAnswersOnlyThroughItsOwnScope(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, first, second := f.chain3()
	a := f.participation(original, replStages(original)["placement"])
	c := f.participation(second, replStages(second)["new"])
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, c, a)
	vacancyDoc := docID(f.uploadOK(f.owner.token, original, "Del proceso.pdf", bytesPDF(100)))
	partDoc := docID(f.uploadOK(f.owner.token, pscope(original, a), "Del candidato.pdf", bytesPDF(100)))
	vacancyLink := linkID(f.linkOK(f.owner.token, second, vacancyDoc, 0))
	partLink := linkID(f.linkOK(f.owner.token, pscope(second, c), partDoc, 0))

	for name, tc := range map[string]struct{ scope, link string }{
		"a vacancy link through another process":       {first, vacancyLink},
		"a vacancy link through a participation":       {pscope(second, c), vacancyLink},
		"a participation link through the vacancy":     {second, partLink},
		"a participation link through another vacancy": {first, partLink},
		"a link through the original":                  {original, vacancyLink},
		"a participation link through a wrong pid":     {pscope(second, f.participation(second, replStages(second)["new"])), partLink},
		"an unknown link":                              {second, uuid.NewString()},
	} {
		draftFlowAssertError(t, f.linkDelete(f.owner.token, tc.scope, tc.link), 404, "not_found")
		draftFlowAssertError(t, f.linkDownload(f.owner.token, tc.scope, tc.link), 404, "not_found")
		if f.linkRows(second) != 2 {
			t.Fatalf("%s: a link was removed", name)
		}
	}
	if len(f.events(second, "DocumentDeleted")) != 0 || len(f.events(second, "DocumentDownloaded")) != 0 {
		t.Fatal("a refused request was audited")
	}
	// Malformed ids and a wrong pid on the other two routes.
	draftFlowAssertError(t, f.linkDelete(f.owner.token, second, "not-a-uuid"), 400, "invalid_request")
	draftFlowAssertError(t, f.linkDownload(f.owner.token, second, "not-a-uuid"), 400, "invalid_request")
	wrong := pscope(second, uuid.NewString())
	draftFlowAssertError(t, f.sourcesGet(f.owner.token, wrong), 404, "not_found")
	draftFlowAssertError(t, f.linkPost(f.owner.token, wrong, linkBody(vacancyDoc, 0)), 404, "not_found")
	draftFlowAssertError(t, f.linkDelete(f.owner.token, wrong, partLink), 404, "not_found")
	draftFlowAssertError(t, f.linkDownload(f.owner.token, wrong, partLink), 404, "not_found")
	draftFlowAssertError(t, f.sourcesGet(f.owner.token, original+"/participations/nope"), 400, "invalid_request")
}

// --- scope flags -----------------------------------------------------------------------------------------------------

// `link` is in scope.allowed_actions only where linking is possible (D17, D15), for a manager.
func TestDocumentLinks_LinkInScopeActionsOnlyWhereAllowed(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	plain := f.published()
	stakeholder := f.member("stakeholder")
	a := f.participation(original, replStages(original)["placement"])
	carried := f.participation(replacement, replStages(replacement)["new"])
	fresh := f.participation(replacement, replStages(replacement)["new"])
	f.exec(`UPDATE process_participations SET carried_from_participation_id=$2 WHERE id=$1`, carried, a)
	// The replacement is closed: linking is still offered (S4).
	f.closeIt(replacement, "finish")

	for name, tc := range map[string]struct {
		scope string
		actor draftFlowActor
		want  []string
	}{
		"replacement, owner":           {replacement, f.owner, []string{"upload", "link"}},
		"replacement, stakeholder":     {replacement, stakeholder, []string{}},
		"original":                     {original, f.owner, []string{"upload"}},
		"plain vacancy":                {plain, f.owner, []string{"upload"}},
		"carried participation, owner": {pscope(replacement, carried), f.owner, []string{"upload", "link"}},
		"carried, stakeholder":         {pscope(replacement, carried), stakeholder, []string{}},
		"fresh participation":          {pscope(replacement, fresh), f.owner, []string{"upload"}},
		"the ancestor participation":   {pscope(original, a), f.owner, []string{"upload"}},
	} {
		if got := strs(docsScope(f.ok(tc.actor.token, tc.scope))["allowed_actions"]); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("%s: %v, want %v", name, got, tc.want)
		}
	}
}

// S4: linking on a closed and a finished replacement works, changes nothing about the vacancy and is audited once.
func TestDocumentLinks_AfterClosureLeaveTheVacancyByteIdentical(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	second := docID(f.uploadOK(f.owner.token, original, "Otro.pdf", bytesPDF(100)))

	f.closeIt(replacement, "continue")
	before := f.vacancySnapshot(replacement)
	f.linkOK(f.owner.token, replacement, source, 0)
	if after := f.vacancySnapshot(replacement); after != before {
		t.Fatalf("a link changed the closed vacancy:\n%s\n%s", before, after)
	}
	if got := f.transition(replacement, "finish-process", `{}`); got.status != 200 {
		t.Fatalf("finish: %d %s", got.status, got.body)
	}
	before = f.vacancySnapshot(replacement)
	link := linkID(f.linkOK(f.owner.token, replacement, second, 0))
	if got := f.linkDelete(f.owner.token, replacement, link); got.status != 200 {
		t.Fatalf("unlink after finish: %d", got.status)
	}
	if after := f.vacancySnapshot(replacement); after != before {
		t.Fatalf("a link changed the finished vacancy:\n%s\n%s", before, after)
	}
	if len(f.events(replacement, "DocumentLinked")) != 2 || len(f.events(replacement, "DocumentDeleted")) != 1 {
		t.Fatal("the attachments must be audited exactly once each")
	}
}

// --- authorization ---------------------------------------------------------------------------------------------------

func TestDocumentLinks_AuthorizationMatrix(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	existing := linkID(f.linkOK(f.owner.token, replacement, source, 0))

	collaborator := f.member("recruiter")
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, collaborator.userID, f.owner.userID)
	teamAccessCollaborator(t, f.h, original, f.company.companyID, collaborator.userID, f.owner.userID)
	outsider := f.member("recruiter") // talent-base recruiter, never on the replacement's team
	former := f.member("recruiter")
	teamAccessEndCollaborator(t, f.h, teamAccessCollaborator(t, f.h, replacement, f.company.companyID, former.userID, f.owner.userID), f.owner.userID)
	stakeholder := f.member("stakeholder")

	foreignCompany, foreignOwnerID, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	foreignOwner := f.h.actor(t, foreignOwnerID, foreignSub)
	foreignRecruiterID, foreignRecruiterSub := foreignCompany.addUser(t, "recruiter")
	foreignRecruiter := f.h.actor(t, foreignRecruiterID, foreignRecruiterSub)
	foreignStakeholderID, foreignStakeholderSub := foreignCompany.addUser(t, "stakeholder")
	foreignStakeholder := f.h.actor(t, foreignStakeholderID, foreignStakeholderSub)

	type op struct {
		name string
		do   func(a draftFlowActor) draftFlowResponse
	}
	reads := []op{
		{"sources", func(a draftFlowActor) draftFlowResponse { return f.sourcesGet(a.token, replacement) }},
		{"download", func(a draftFlowActor) draftFlowResponse { return f.linkDownload(a.token, replacement, existing) }},
	}
	// A manager reads and links.
	for name, actor := range map[string]draftFlowActor{"owner": f.owner, "collaborator": collaborator} {
		for _, r := range reads {
			if got := r.do(actor); got.status != 200 {
				t.Fatalf("%s %s: %d %s", name, r.name, got.status, got.body)
			}
		}
		extra := docID(f.uploadOK(f.owner.token, original, "Para "+name+".pdf", bytesPDF(120)))
		link := linkID(f.linkOK(actor.token, replacement, extra, 0))
		if got := f.linkDelete(actor.token, replacement, link); got.status != 200 {
			t.Fatalf("%s unlink: %d %s", name, got.status, got.body)
		}
	}
	// Refused callers: 404 (never on the team, other company), 404 team_access_ended, 403 for a stakeholder's writes.
	for _, tc := range []struct {
		actor        draftFlowActor
		status       int
		code         string
		refusedWrite bool // the recruiter ladder answers a stakeholder 403 before the store looks
	}{
		{outsider, 404, "not_found", true},
		{former, 404, "team_access_ended", true},
		{foreignOwner, 404, "not_found", true},
		{foreignRecruiter, 404, "not_found", true},
		{foreignStakeholder, 404, "not_found", false},
	} {
		for _, r := range reads {
			draftFlowAssertError(t, r.do(tc.actor), tc.status, tc.code)
		}
		if tc.refusedWrite {
			draftFlowAssertError(t, f.linkPost(tc.actor.token, replacement, linkBody(source, 0)), tc.status, tc.code)
			draftFlowAssertError(t, f.linkDelete(tc.actor.token, replacement, existing), tc.status, tc.code)
		} else {
			draftFlowAssertError(t, f.linkPost(tc.actor.token, replacement, linkBody(source, 0)), 403, "forbidden")
		}
	}
	draftFlowAssertError(t, f.linkPost(stakeholder.token, replacement, linkBody(source, 0)), 403, "forbidden")
	draftFlowAssertError(t, f.linkDelete(stakeholder.token, replacement, existing), 403, "forbidden")
	for _, r := range reads {
		if got := r.do(stakeholder); got.status != 200 {
			t.Fatalf("stakeholder %s: %d", r.name, got.status)
		}
	}
	// Anonymous and malformed ids.
	anon := f.docs.do(t, "GET", lscope(replacement)+"/document-sources", "", "", nil)
	draftFlowAssertError(t, anon, 401, "unauthenticated")
	draftFlowAssertError(t, f.docs.do(t, "POST", lscope(replacement)+"/document-links", linkBody(source, 0), "", map[string]string{"Content-Type": "application/json"}), 401, "unauthenticated")
	draftFlowAssertError(t, f.sourcesGet(f.owner.token, "not-a-uuid"), 400, "invalid_request")
	draftFlowAssertError(t, f.linkPost(f.owner.token, "not-a-uuid", linkBody(source, 0)), 400, "invalid_request")
	if f.linkRows(replacement) != 1 {
		t.Fatalf("links: %d", f.linkRows(replacement))
	}
}

// A recruiter whose tramo on the TARGET ended cannot land a link: the write transaction authorizes under the draft lock.
func TestDocumentLinks_RevokedWriterCannotLink(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	rita := f.member("recruiter")
	teamAccessCollaborator(t, f.h, original, f.company.companyID, rita.userID, f.owner.userID)
	assignment := teamAccessCollaborator(t, f.h, replacement, f.company.companyID, rita.userID, f.owner.userID)
	teamAccessEndCollaborator(t, f.h, assignment, f.owner.userID)

	store := f.newStore(f.storage)
	_, err := store.Link(context.Background(), documents.LinkCommand{CompanyID: f.company.companyID, ActorID: rita.userID, Target: documents.VacancyTarget(uuid.MustParse(replacement)), SourceDocumentID: uuid.MustParse(source)})
	if !errors.Is(err, documents.ErrTeamAccessEnded) {
		t.Fatalf("err = %v", err)
	}
	if f.linkRows(replacement) != 0 || len(f.events(replacement, "DocumentLinked")) != 0 {
		t.Fatal("a revoked writer linked")
	}
}

// --- failure modes ---------------------------------------------------------------------------------------------------

// The audit append is part of the write: when it fails, the link and the unlink roll back.
func TestDocumentLinks_AuditFailureRollsBack(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))

	allow := auditBlock(t, f.h.pool, f.company.companyID, "DocumentLinked")
	got := f.linkPost(f.owner.token, replacement, linkBody(source, 0))
	draftFlowAssertError(t, got, 500, "internal_error")
	if strings.Contains(string(got.body), "audit") || f.linkRows(replacement) != 0 {
		t.Fatalf("a failed audit must leave no link and no detail: %d %s", f.linkRows(replacement), got.body)
	}
	allow()
	link := linkID(f.linkOK(f.owner.token, replacement, source, 0))

	allow = auditBlock(t, f.h.pool, f.company.companyID, "DocumentDeleted")
	draftFlowAssertError(t, f.linkDelete(f.owner.token, replacement, link), 500, "internal_error")
	if f.linkRows(replacement) != 1 {
		t.Fatal("a failed audit must keep the link")
	}
	allow()
	if got := f.linkDelete(f.owner.token, replacement, link); got.status != 200 {
		t.Fatalf("unlink: %d", got.status)
	}

	// A failed audit of the download serves nothing.
	link = linkID(f.linkOK(f.owner.token, replacement, source, 0))
	allow = auditBlock(t, f.h.pool, f.company.companyID, "DocumentDownloaded")
	got = f.linkDownload(f.owner.token, replacement, link)
	draftFlowAssertError(t, got, 500, "internal_error")
	allow()
}

// With the storage disabled everything that only touches rows keeps working; the file download is 503 after the gates and the
// link rules (a missing link is still 404).
func TestDocumentLinks_StorageDisabled(t *testing.T) {
	f := newDocsFlow(t) // no storage
	original, replacement := f.chain2()
	source, _ := f.insertDocument(original, "", "Contrato", f.owner, docVersion{docPDF, 100, docsAt(0), f.owner})
	stakeholder := f.member("stakeholder")

	if body := f.sourcesOK(f.owner.token, replacement); len(sourceGroups(body)) != 1 {
		t.Fatalf("sources: %v", body)
	}
	link := linkID(f.linkOK(f.owner.token, replacement, source, 0))
	draftFlowAssertError(t, f.linkDownload(f.owner.token, replacement, link), 503, "document_storage_unavailable")
	draftFlowAssertError(t, f.linkDownload(stakeholder.token, replacement, link), 503, "document_storage_unavailable")
	draftFlowAssertError(t, f.linkDownload(f.owner.token, replacement, uuid.NewString()), 404, "not_found")
	if len(f.events(replacement, "DocumentDownloaded")) != 0 {
		t.Fatal("a failed download was audited")
	}
	if got := f.linkDelete(f.owner.token, replacement, link); got.status != 200 {
		t.Fatalf("unlink: %d", got.status)
	}
}

// A pinned version whose file is gone from storage is 404 and nothing is recorded; a failing storage is 503.
func TestDocumentLinks_DownloadNothingRecordedWhenNothingIsServed(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	link := linkID(f.linkOK(f.owner.token, replacement, source, 0))

	key := f.keyOf(source, 1)
	moved := filepath.Join(t.TempDir(), "moved")
	if err := os.Rename(filepath.Join(f.dir, key), moved); err != nil {
		t.Fatal(err)
	}
	draftFlowAssertError(t, f.linkDownload(f.owner.token, replacement, link), 404, "not_found")
	if err := os.Rename(moved, filepath.Join(f.dir, key)); err != nil {
		t.Fatal(err)
	}
	f.storage.mu.Lock()
	f.storage.openErr = fmt.Errorf("provider down")
	f.storage.mu.Unlock()
	draftFlowAssertError(t, f.linkDownload(f.owner.token, replacement, link), 503, "document_storage_unavailable")
	f.storage.mu.Lock()
	f.storage.openErr = nil
	f.storage.mu.Unlock()
	if len(f.events(replacement, "DocumentDownloaded")) != 0 {
		t.Fatal("a download that served nothing was audited")
	}
	if dl := f.linkDownload(f.owner.token, replacement, link); dl.status != 200 {
		t.Fatalf("recovered: %d", dl.status)
	}
}

// S3: «Linking does not bypass source access or retention/deletion rules»: linking never lets a viewer read a source version
// the pinned link does not name, and the source's own routes are unchanged by the existence of links.
func TestDocumentLinks_LinkingDoesNotWidenTheSource(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	rita := f.member("recruiter")
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, rita.userID, f.owner.userID) // never on the original's team
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	f.linkOK(f.owner.token, replacement, source, 0)

	for _, got := range []draftFlowResponse{
		f.get(rita.token, original),
		f.download(rita.token, original, source),
		f.versions(rita.token, original, source),
		f.versionFile(rita.token, original, source, 1),
		f.deleteDoc(rita.token, original, source),
	} {
		if got.status != 404 {
			t.Fatalf("a link opened the source to a recruiter outside its team: %d %s", got.status, got.body)
		}
	}
}

// The draft row lock serializes a link and an unlink with every other write of the vacancy (D23): holding the TARGET draft from
// another transaction makes both wait, and they finish once it is released. (A bare race of identical requests is too narrow a
// window to prove the lock, so it is held deterministically.)
func TestDocumentLinks_LinkAndUnlinkWaitForTheTargetDraftLock(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	one := docID(f.uploadOK(f.owner.token, original, "Uno.pdf", bytesPDF(100)))
	two := docID(f.uploadOK(f.owner.token, original, "Dos.pdf", bytesPDF(100)))
	existing := linkID(f.linkOK(f.owner.token, replacement, two, 0))
	svc, ctx := f.service(), context.Background()
	target := documents.VacancyTarget(uuid.MustParse(replacement))

	hold, err := f.h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(ctx) }()
	if _, err := hold.Exec(ctx, `SELECT id FROM job_drafts WHERE id=$1 FOR UPDATE`, replacement); err != nil {
		t.Fatal(err)
	}
	linked, unlinked := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := svc.Link(ctx, documents.LinkCommand{CompanyID: f.company.companyID, ActorID: f.owner.userID, Target: target, SourceDocumentID: uuid.MustParse(one)})
		linked <- err
	}()
	go func() {
		_, err := svc.Unlink(ctx, f.company.companyID, f.owner.userID, target, uuid.MustParse(existing))
		unlinked <- err
	}()
	select {
	case err := <-linked:
		t.Fatalf("the link did not wait for the draft lock: %v", err)
	case err := <-unlinked:
		t.Fatalf("the unlink did not wait for the draft lock: %v", err)
	case <-time.After(400 * time.Millisecond):
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	for name, ch := range map[string]chan error{"link": linked, "unlink": unlinked} {
		select {
		case err := <-ch:
			if err != nil {
				t.Fatalf("%s: %v", name, err)
			}
		case <-time.After(10 * time.Second):
			t.Fatalf("the %s never finished after the lock was released", name)
		}
	}
	if f.linkRows(replacement) != 1 || len(f.events(replacement, "DocumentLinked")) != 2 || len(f.events(replacement, "DocumentDeleted")) != 1 {
		t.Fatalf("links %d", f.linkRows(replacement))
	}
}

// Deleting the SOURCE while a link to it is being created: the source row is held FOR SHARE until the link commits, so the delete
// waits and then leaves the new link «removed» — never a dangling reference, never a failed insert.
func TestDocumentLinks_SourceDeleteWaitsForTheLinkAndLeavesItRemoved(t *testing.T) {
	f := newDocsUploadFlow(t)
	original, replacement := f.chain2()
	source := docID(f.uploadOK(f.owner.token, original, "Contrato.pdf", bytesPDF(100)))
	ctx := context.Background()

	// A transaction that holds the source row FOR UPDATE stands for a delete in flight: the link must wait for it, and when the
	// delete commits the link finds no source (404), instead of inserting a reference to a row that is going away.
	hold, err := f.h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(ctx) }()
	if _, err := hold.Exec(ctx, `SELECT id FROM placement_documents WHERE id=$1 FOR UPDATE`, source); err != nil {
		t.Fatal(err)
	}
	done := make(chan draftFlowResponse, 1)
	go func() { done <- f.linkPost(f.owner.token, replacement, linkBody(source, 0)) }()
	select {
	case got := <-done:
		t.Fatalf("the link did not wait for the source row: %d %s", got.status, got.body)
	case <-time.After(400 * time.Millisecond):
	}
	if _, err := hold.Exec(ctx, `DELETE FROM placement_documents WHERE id=$1`, source); err != nil {
		t.Fatal(err)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-done:
		draftFlowAssertError(t, got, 404, "not_found")
	case <-time.After(10 * time.Second):
		t.Fatal("the link never finished")
	}
	if f.linkRows(replacement) != 0 {
		t.Fatal("a link to a deleted source was created")
	}

	// And the other order: the link is in, then the source is deleted: the link is removed, not dangling.
	other := docID(f.uploadOK(f.owner.token, original, "Otro.pdf", bytesPDF(100)))
	link := linkID(f.linkOK(f.owner.token, replacement, other, 0))
	if got := f.deleteDoc(f.owner.token, original, other); got.status != 200 {
		t.Fatalf("delete: %d %s", got.status, got.body)
	}
	if l := linkList(f.ok(f.owner.token, replacement))[0]; l["id"] != link || l["state"] != "removed" {
		t.Fatalf("link: %v", l)
	}
}
