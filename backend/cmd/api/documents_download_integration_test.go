//go:build integration

package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// GET /v2/me/company/job-drafts/{id}/documents/{doc}/file through the production router
// (docs/contracts/placement-vacancy-documents-v1.md, P4, D21): the audited download commits before the first byte, and
// nothing is recorded when the document, its file or the storage is missing.

func (f *docsFlow) filePath(draft, doc string) string {
	return draftFlowV2Path + "/" + draft + "/documents/" + doc + "/file"
}

func (f *docsFlow) download(token, draft, doc string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "GET", f.filePath(draft, doc), "", token, nil)
}

func (f *docsFlow) downloadEvents(draft string) []auditRow {
	return auditRowsWhere(f.t, f.h.pool, `company_id=$1 AND event_type='DocumentDownloaded' AND vacancy_id=$2`, f.company.companyID, draft)
}

// storageKey is the storage key of version 1 of a document.
func (f *docsFlow) storageKey(doc string) string {
	f.t.Helper()
	var key string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT storage_key FROM placement_document_versions WHERE document_id=$1 AND version=1`, doc).Scan(&key); err != nil {
		f.t.Fatal(err)
	}
	return key
}

func TestDocumentsDownload_HeadersAndBytes(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	for _, tc := range []struct {
		label, file, given string
		content            []byte
		contentType        string
		disposition        string
	}{
		// mime.FormatMediaType quotes an ASCII name only when it is not a bare token (a space, a quote, a backslash).
		{"ascii pdf", "Contrato marco.pdf", "", bytesPDF(4096), "application/pdf", `attachment; filename="Contrato marco.pdf"`},
		// RFC 5987: the extended parameter alone, lower-case charset, percent-encoded UTF-8, no ASCII fallback.
		{"accents and enye", "Informe año 2026.pdf", "", bytesPDF(100), "application/pdf", "attachment; filename*=utf-8''Informe%20a%C3%B1o%202026.pdf"},
		{"docx", "Oferta.docx", "", bytesDOCX(t), docDOCX, `attachment; filename=Oferta.docx`},
		{"xlsx", "Presupuesto.XLSX", "", bytesXLSX(t), docXLSX, `attachment; filename=Presupuesto.xlsx`},
		// «.JPEG» was stripped at upload; the download name takes the extension of the stored format.
		{"jpeg uploaded, downloaded as .jpg", "Escaneo.JPEG", "", bytesJPG(), "image/jpeg", `attachment; filename=Escaneo.jpg`},
		{"png", "Foto.png", "", bytesPNG(), "image/png", `attachment; filename=Foto.png`},
		{"quotes and backslashes are escaped", "x.pdf", `Informe "final" \ v2`, bytesPDF(100), "application/pdf", `attachment; filename="Informe \"final\" \\ v2.pdf"`},
		{"non latin", "契約書.pdf", "", bytesPDF(100), "application/pdf", "attachment; filename*=utf-8''%E5%A5%91%E7%B4%84%E6%9B%B8.pdf"},
	} {
		t.Run(tc.label, func(t *testing.T) {
			extra := []docPart{}
			if tc.given != "" {
				extra = append(extra, namePart(tc.given))
			}
			doc := f.uploadOK(f.owner.token, draft, tc.file, tc.content, extra...)["item"].(map[string]any)["id"].(string)
			got := f.download(f.owner.token, draft, doc)
			if got.status != 200 || !bytes.Equal(got.body, tc.content) {
				t.Fatalf("%d, %d bytes (want %d)", got.status, len(got.body), len(tc.content))
			}
			draftFlowAssertNoStore(t, got)
			h := got.header
			if h.Get("Content-Type") != tc.contentType || h.Get("Content-Disposition") != tc.disposition ||
				h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Length") != strconv.Itoa(len(tc.content)) {
				t.Fatalf("headers: %v", h)
			}
			if strings.Contains(tc.disposition, "filename*=") && strings.Contains(h.Get("Content-Disposition"), `filename="`) {
				t.Fatal("a non-ASCII name must not carry an ASCII fallback parameter")
			}
			if strings.Contains(strings.ToLower(h.Get("Content-Disposition")), "inline") {
				t.Fatal("documents are never served inline (D10)")
			}
		})
	}
}

// D21: the audit row is committed BEFORE the first byte leaves, and each download is one row of ids and enums.
func TestDocumentsDownload_AuditRowExistsBeforeTheFirstByte(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	draft := publicationFlowReady(t, f.h, ana)
	doc := f.uploadOK(ana.token, draft, "Informe confidencial de Juan Pérez.pdf", bytesPDF(8192))["item"].(map[string]any)["id"].(string)
	if len(f.downloadEvents(draft)) != 0 {
		t.Fatal("uploading must not record a download")
	}

	var atFirstByte = -1
	f.storage.mu.Lock()
	f.storage.onFirstRead = func() { atFirstByte = len(f.downloadEvents(draft)) } // a separate pooled connection: only a COMMITTED row counts
	f.storage.mu.Unlock()
	got := f.download(ana.token, draft, doc)
	if got.status != 200 {
		t.Fatalf("%d %s", got.status, got.body)
	}
	if atFirstByte != 1 {
		t.Fatalf("download events visible when the first byte was read: %d, want 1 (audit before stream)", atFirstByte)
	}
	events := f.downloadEvents(draft)
	if len(events) != 1 {
		t.Fatalf("events: %d", len(events))
	}
	versionID := ""
	if err := f.h.pool.QueryRow(context.Background(), `SELECT id::text FROM placement_document_versions WHERE document_id=$1`, doc).Scan(&versionID); err != nil {
		t.Fatal(err)
	}
	draftID := uuid.MustParse(draft)
	assertAuditRow(t, events[0], wantAuditRow{
		actor: ana.userID, eventType: "DocumentDownloaded", entityType: "document", entityID: uuid.MustParse(doc), company: f.company.companyID, vacancy: &draftID,
		metadata: map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": draft, "scope": "vacancy", "document_id": doc, "version_id": versionID, "version": "1"},
	})
	if strings.Contains(string(mustJSON(t, events[0].Metadata)), "Juan") {
		t.Fatal("the file name leaked into the audit metadata")
	}
	if opened, closed := f.storage.streams(); opened != 1 || closed != 1 {
		t.Fatalf("streams opened %d closed %d", opened, closed)
	}

	// Every download is its own row.
	f.download(ana.token, draft, doc)
	f.download(f.owner.token, draft, doc)
	if events := f.downloadEvents(draft); len(events) != 3 {
		t.Fatalf("events after three downloads: %d", len(events))
	}
}

// Nothing is recorded, and no byte is served, when the document, its file or the storage is missing, or when the audit fails.
func TestDocumentsDownload_NothingRecordedWhenNothingIsServed(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published() // a participation needs a process row
	doc := f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(300))["item"].(map[string]any)["id"].(string)
	assertNoServe := func(label string, got draftFlowResponse, status int, code string) {
		t.Helper()
		draftFlowAssertError(t, got, status, code)
		if got.header.Get("Content-Disposition") != "" || bytes.Contains(got.body, []byte("%PDF")) {
			t.Fatalf("%s: bytes or download headers served on an error: %v", label, got.header)
		}
		if n := len(f.downloadEvents(draft)); n != 0 {
			t.Fatalf("%s: %d download events recorded", label, n)
		}
	}

	assertNoServe("unknown document", f.download(f.owner.token, draft, uuid.NewString()), 404, "not_found")

	// A document of ANOTHER vacancy of the same company, asked for under this one.
	otherDraft := publicationFlowReady(t, f.h, f.owner)
	assertNoServe("document of another vacancy", f.download(f.owner.token, otherDraft, doc), 404, "not_found")

	// A participation document is not served by the vacancy route (P6 owns that scope).
	stage := pipelineconfig.Defaults(uuid.MustParse(draft)).Stages[0].ID
	participation := draftListCandidateSeed(t, f.h, draft, stage)
	partDoc, _ := f.insertDocument(draft, participation, "Del candidato", f.owner, docVersion{docPDF, 1, docsAt(0), f.owner})
	assertNoServe("participation document", f.download(f.owner.token, draft, partDoc), 404, "not_found")

	// The row exists but the file is gone: 404, nothing recorded.
	key := f.storageKey(doc)
	if err := os.Rename(filepath.Join(f.dir, key), filepath.Join(f.dir, key+".moved")); err != nil {
		t.Fatal(err)
	}
	assertNoServe("file missing", f.download(f.owner.token, draft, doc), 404, "not_found")
	if err := os.Rename(filepath.Join(f.dir, key+".moved"), filepath.Join(f.dir, key)); err != nil {
		t.Fatal(err)
	}

	// The storage fails: 503 document_storage_unavailable.
	f.storage.mu.Lock()
	f.storage.openErr = documents.ErrStorageUnavailable
	f.storage.mu.Unlock()
	assertNoServe("storage unavailable", f.download(f.owner.token, draft, doc), 503, "document_storage_unavailable")
	f.storage.mu.Lock()
	f.storage.openErr = nil
	f.storage.mu.Unlock()

	// The audit append fails: nothing is served, the opened stream is closed, nothing is recorded.
	allow := auditBlock(t, f.h.pool, f.company.companyID, "DocumentDownloaded")
	opened, closed := f.storage.streams()
	assertNoServe("audit failure", f.download(f.owner.token, draft, doc), 500, "internal_error")
	if o, c := f.storage.streams(); o != opened+1 || c != closed+1 {
		t.Fatalf("the stream opened for a failed audit must be closed: opened %d->%d closed %d->%d", opened, o, closed, c)
	}
	allow()
	if got := f.download(f.owner.token, draft, doc); got.status != 200 || len(f.downloadEvents(draft)) != 1 {
		t.Fatalf("after the block: %d events %d", got.status, len(f.downloadEvents(draft)))
	}
}

// With the storage disabled the download answers 503 after its gates, and nothing is recorded.
func TestDocumentsDownload_StorageDisabled(t *testing.T) {
	f := newDocsFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc, _ := f.insertDocument(draft, "", "Contrato", f.owner, docVersion{docPDF, 10, docsAt(0), f.owner})
	outsider := f.member("recruiter")
	draftFlowAssertError(t, f.download(f.owner.token, draft, doc), 503, "document_storage_unavailable")
	draftFlowAssertError(t, f.download(outsider.token, draft, doc), 404, "not_found") // the gates answer first
	if len(f.downloadEvents(draft)) != 0 {
		t.Fatal("a download was recorded without storage")
	}
}

// The read gate (D4, D6): owner, team members and every stakeholder of the company download, drafts included; the rest do not.
func TestDocumentsDownload_AuthorizationMatrix(t *testing.T) {
	f := newDocsUploadFlow(t)
	responsible := f.member("recruiter")
	draft := publicationFlowReady(t, f.h, responsible) // never published
	doc := f.uploadOK(responsible.token, draft, "Contrato.pdf", bytesPDF(500))["item"].(map[string]any)["id"].(string)
	collaborator := f.member("recruiter")
	teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	outsider := f.member("recruiter")
	former := f.member("recruiter")
	teamAccessEndCollaborator(t, f.h, teamAccessCollaborator(t, f.h, draft, f.company.companyID, former.userID, f.owner.userID), f.owner.userID)
	stakeholder := f.member("stakeholder")
	_, otherOwnerID, otherSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	otherOwner := f.h.actor(t, otherOwnerID, otherSub)

	want := 0
	for _, tc := range []struct {
		name  string
		actor draftFlowActor
	}{{"owner", f.owner}, {"responsible recruiter", responsible}, {"active collaborator", collaborator}, {"stakeholder, never-published draft", stakeholder}} {
		got := f.download(tc.actor.token, draft, doc)
		if got.status != 200 || !bytes.HasPrefix(got.body, []byte("%PDF-")) {
			t.Fatalf("%s: %d", tc.name, got.status)
		}
		want++
		events := f.downloadEvents(draft)
		if len(events) != want || *events[want-1].ActorID != tc.actor.userID {
			t.Fatalf("%s: the audit row must name the downloader: %d rows", tc.name, len(events))
		}
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
	} {
		draftFlowAssertError(t, f.download(tc.actor.token, draft, doc), tc.status, tc.code)
	}
	draftFlowAssertError(t, f.docs.do(t, "GET", f.filePath(draft, doc), "", "", nil), 401, "unauthenticated")
	draftFlowAssertError(t, f.docs.do(t, "GET", f.filePath(draft, "not-a-uuid"), "", f.owner.token, nil), 400, "invalid_request")
	draftFlowAssertError(t, f.docs.do(t, "GET", f.filePath("not-a-uuid", doc), "", f.owner.token, nil), 400, "invalid_request")
	if len(f.downloadEvents(draft)) != want {
		t.Fatalf("a refused download was recorded: %d", len(f.downloadEvents(draft)))
	}
}

// S4: after closure the documents are still downloadable, by the same people.
func TestDocumentsDownload_AfterClosure(t *testing.T) {
	f := newDocsUploadFlow(t)
	id := f.published()
	doc := f.uploadOK(f.owner.token, id, "Contrato.pdf", bytesPDF(100))["item"].(map[string]any)["id"].(string)
	f.closeIt(id, "finish")
	stakeholder := f.member("stakeholder")
	before := f.vacancySnapshot(id)
	for _, actor := range []draftFlowActor{f.owner, stakeholder} {
		if got := f.download(actor.token, id, doc); got.status != 200 {
			t.Fatalf("%d %s", got.status, got.body)
		}
	}
	if f.vacancySnapshot(id) != before {
		t.Fatal("a download changed the vacancy")
	}
	if got := f.uploadOK(f.owner.token, id, "Despues.pdf", bytesPDF(100)); !reflect.DeepEqual(docsScope(got)["counts"], map[string]any{"documents": float64(2), "links": float64(0)}) {
		t.Fatalf("scope after closure: %v", got)
	}
}
