//go:build integration

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	documentspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Versions and delete through the production router (docs/contracts/placement-vacancy-documents-v1.md, P5): replace with the
// required expected_version part, the version list, download by version and delete (rows first, files after commit). Real
// RequireAuth, real recruiter and reader gates, the real documents store, service and local storage, isolated PostgreSQL.

func expectedPart(n int) docPart {
	return docPart{name: "expected_version", body: []byte(strconv.Itoa(n))}
}

func (f *docsFlow) docPath(draft, doc string) string {
	return draftFlowV2Path + "/" + draft + "/documents/" + doc
}

func (f *docsFlow) replace(token, draft, doc string, parts ...docPart) draftFlowResponse {
	f.t.Helper()
	body, ct := docsMultipart(f.t, parts...)
	return f.docs.do(f.t, "POST", f.docPath(draft, doc)+"/versions", body, token, map[string]string{"Content-Type": ct})
}

// replaceOK replaces with expected_version first, then the file (the order the contract asks clients to use).
func (f *docsFlow) replaceOK(token, draft, doc string, expected int, filename string, content []byte, extra ...docPart) map[string]any {
	f.t.Helper()
	parts := append([]docPart{expectedPart(expected)}, extra...)
	got := f.replace(token, draft, doc, append(parts, filePart(filename, content))...)
	if got.status != 201 {
		f.t.Fatalf("replace %s (expected_version %d): %d %s", filename, expected, got.status, got.body)
	}
	return draftFlowObject(f.t, got.body)
}

func (f *docsFlow) versions(token, draft, doc string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "GET", f.docPath(draft, doc)+"/versions", "", token, nil)
}

func (f *docsFlow) versionFile(token, draft, doc string, n any) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "GET", fmt.Sprintf("%s/versions/%v/file", f.docPath(draft, doc), n), "", token, nil)
}

func (f *docsFlow) deleteDoc(token, draft, doc string) draftFlowResponse {
	f.t.Helper()
	return f.docs.do(f.t, "DELETE", f.docPath(draft, doc), "", token, nil)
}

func (f *docsFlow) events(draft, eventType string) []auditRow {
	f.t.Helper()
	return auditRowsWhere(f.t, f.h.pool, `company_id=$1 AND event_type=$2 AND vacancy_id=$3`, f.company.companyID, eventType, draft)
}

func (f *docsFlow) versionCount(doc string) int {
	return f.count(`SELECT count(*) FROM placement_document_versions WHERE document_id=$1`, doc)
}

func (f *docsFlow) versionID(doc string, n int) string {
	f.t.Helper()
	var id string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT id::text FROM placement_document_versions WHERE document_id=$1 AND version=$2`, doc, n).Scan(&id); err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *docsFlow) keyOf(doc string, n int) string {
	f.t.Helper()
	var key string
	if err := f.h.pool.QueryRow(context.Background(), `SELECT storage_key FROM placement_document_versions WHERE document_id=$1 AND version=$2`, doc, n).Scan(&key); err != nil {
		f.t.Fatal(err)
	}
	return key
}

func docID(body map[string]any) string { return body["item"].(map[string]any)["id"].(string) }

func (f *docsFlow) service() *documents.Service {
	return documents.NewService(f.storage, f.newStore(f.storage))
}

// --- replace ----------------------------------------------------------------------------------------------------

// A replacement is a NEW version: the document keeps its id and creation, the old file stays, the answer is {item, scope}
// and equals what the list reads back, and DocumentReplaced carries ids and enums only.
func TestDocumentsReplace_NewVersionAnswersItemAndScope(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	luis := f.name(f.member("recruiter"), "Luis Ortega")
	draft := publicationFlowReady(t, f.h, ana)
	teamAccessCollaborator(t, f.h, draft, f.company.companyID, luis.userID, f.owner.userID)
	v1 := bytesPDF(2048)
	created := f.uploadOK(ana.token, draft, "Contrato marco.pdf", v1)["item"].(map[string]any)
	doc := created["id"].(string)

	v2 := bytesDOCX(t)
	got := f.replace(luis.token, draft, doc, expectedPart(1), namePart("  Contrato   firmado.DOCX "), filePart("firmado.docx", v2))
	draftFlowAssertNoStore(t, got)
	if got.status != 201 || got.header.Get("Content-Type") != "application/json" {
		t.Fatalf("%d %s %s", got.status, got.header.Get("Content-Type"), got.body)
	}
	if got.header.Get("Location") != "" || got.header.Get("Idempotency-Replayed") != "" {
		t.Fatalf("Location/Idempotency-Replayed on a replace: %v", got.header)
	}
	body := draftFlowObject(t, got.body)
	if !reflect.DeepEqual(docsSorted(body), []string{"item", "scope"}) {
		t.Fatalf("keys: %v", docsSorted(body))
	}
	item := body["item"].(map[string]any)
	if !reflect.DeepEqual(docsSorted(item), docItemKeys) {
		t.Fatalf("item keys: %v", docsSorted(item))
	}
	for k, v := range map[string]any{
		"id": doc, "name": "Contrato firmado", "format": "docx", "content_type": docDOCX, "size": float64(len(v2)),
		"version": float64(2), "version_count": float64(2), "participation_id": nil, "created_at": created["created_at"],
	} {
		if item[k] != v {
			t.Errorf("%s = %v, want %v", k, item[k], v)
		}
	}
	if !reflect.DeepEqual(item["created_by"], map[string]any{"id": ana.userID.String(), "name": "Ana López"}) ||
		!reflect.DeepEqual(item["updated_by"], map[string]any{"id": luis.userID.String(), "name": "Luis Ortega"}) || item["updated_at"].(string) <= item["created_at"].(string) {
		t.Errorf("people/times: %v", item)
	}
	if !reflect.DeepEqual(strs(item["allowed_actions"]), []string{"download", "replace", "delete"}) {
		t.Errorf("item actions: %v", item["allowed_actions"])
	}
	scope := docsScope(body)
	if scope["can_manage"] != true || !reflect.DeepEqual(strs(scope["allowed_actions"]), []string{"upload"}) || !reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(1), "links": float64(0)}) {
		t.Errorf("scope: %v", scope)
	}
	if list := f.ok(ana.token, draft); !reflect.DeepEqual(list["items"].([]any)[0], item) || !reflect.DeepEqual(list["scope"], body["scope"]) {
		t.Fatalf("the 201 differs from the list\n201  %v\nlist %v", body, list)
	}

	// Rows and files: version 1 is still there, byte for byte, next to version 2.
	if f.versionCount(doc) != 2 || f.count(`SELECT count(*) FROM placement_documents WHERE id=$1`, doc) != 1 || f.objects() != 2 {
		t.Fatalf("versions %d objects %d", f.versionCount(doc), f.objects())
	}
	if !bytes.Equal(f.object(f.keyOf(doc, 1)), v1) || !bytes.Equal(f.object(f.keyOf(doc, 2)), v2) || f.keyOf(doc, 1) == f.keyOf(doc, 2) {
		t.Fatal("the stored versions are not the uploaded bytes")
	}
	var uploadedBy uuid.UUID
	if err := f.h.pool.QueryRow(context.Background(), `SELECT uploaded_by FROM placement_document_versions WHERE document_id=$1 AND version=2`, doc).Scan(&uploadedBy); err != nil || uploadedBy != luis.userID {
		t.Fatalf("version 2 uploaded_by %v %v", uploadedBy, err)
	}

	// DocumentReplaced: ids and enums, never the name.
	events := f.events(draft, "DocumentReplaced")
	if len(events) != 1 {
		t.Fatalf("DocumentReplaced rows: %d", len(events))
	}
	draftID := uuid.MustParse(draft)
	assertAuditRow(t, events[0], wantAuditRow{
		actor: luis.userID, eventType: "DocumentReplaced", entityType: "document", entityID: uuid.MustParse(doc), company: f.company.companyID, vacancy: &draftID,
		metadata: map[string]any{
			"company_id": f.company.companyID.String(), "vacancy_id": draft, "scope": "vacancy", "document_id": doc, "version_id": f.versionID(doc, 2),
			"version": "2", "previous_version_id": f.versionID(doc, 1), "format": "docx", "renamed": "true",
		},
	})
	if raw := string(mustJSON(t, events[0].Metadata)); strings.Contains(raw, "Contrato") || strings.Contains(raw, "firmado") {
		t.Fatalf("the name leaked into the audit metadata: %s", raw)
	}

	// Without `name` the name stays; a format change is fine (docx → png); `renamed` is false when the name did not change.
	body = f.replaceOK(ana.token, draft, doc, 2, "Escaneo.png", bytesPNG())
	if item := body["item"].(map[string]any); item["name"] != "Contrato firmado" || item["format"] != "png" || item["version"] != float64(3) || item["version_count"] != float64(3) {
		t.Fatalf("v3: %v", item)
	}
	f.replaceOK(ana.token, draft, doc, 3, "x.pdf", bytesPDF(60), namePart("Contrato firmado.pdf")) // the same name, extension stripped
	renamed := []string{}
	for _, e := range f.events(draft, "DocumentReplaced") {
		renamed = append(renamed, e.Metadata["renamed"].(string))
	}
	if !reflect.DeepEqual(renamed, []string{"true", "false", "false"}) {
		t.Fatalf("renamed flags: %v", renamed)
	}
	if f.objects() != 4 || f.versionCount(doc) != 4 {
		t.Fatalf("objects %d versions %d", f.objects(), f.versionCount(doc))
	}
}

// A stale expected_version is answered with the current one; sent before the file it is answered before the file is read.
func TestDocumentsReplace_StaleExpectedVersion(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	f.replaceOK(f.owner.token, draft, doc, 1, "b.pdf", bytesPDF(120))
	objects := f.objects()
	assertUnchanged := func(label string) {
		t.Helper()
		if f.versionCount(doc) != 2 || f.objects() != objects || len(f.events(draft, "DocumentReplaced")) != 1 {
			t.Fatalf("%s changed state: versions %d objects %d events %d", label, f.versionCount(doc), f.objects(), len(f.events(draft, "DocumentReplaced")))
		}
	}
	conflict := func(label string, got draftFlowResponse) {
		t.Helper()
		draftFlowAssertError(t, got, 409, "document_version_conflict")
		data := draftFlowObject(t, got.body)["data"].(map[string]any)
		if !reflect.DeepEqual(data, map[string]any{"current_version": float64(2)}) {
			t.Fatalf("%s: data %v", label, data)
		}
		assertUnchanged(label)
	}

	conflict("behind, before the file", f.replace(f.owner.token, draft, doc, expectedPart(1), filePart("c.pdf", bytesPDF(130))))
	conflict("ahead, before the file", f.replace(f.owner.token, draft, doc, expectedPart(3), filePart("c.pdf", bytesPDF(130))))
	conflict("behind, after the file", f.replace(f.owner.token, draft, doc, filePart("c.pdf", bytesPDF(130)), expectedPart(1)))
	// Proof that the pre-flight answers before the body is inspected: a file that would be a 415 is never looked at.
	conflict("before an invalid file", f.replace(f.owner.token, draft, doc, expectedPart(1), filePart("archive.zip", bytesZip(t, "a.txt"))))
	conflict("with a name", f.replace(f.owner.token, draft, doc, expectedPart(1), namePart("Otro"), filePart("c.pdf", bytesPDF(130))))
	if name := f.ok(f.owner.token, draft)["items"].([]any)[0].(map[string]any)["name"]; name != "a" {
		t.Fatalf("a refused replace renamed the document: %v", name)
	}
	// The same call with the right value goes through.
	f.replaceOK(f.owner.token, draft, doc, 2, "c.pdf", bytesPDF(130))
}

// Everything that is wrong with the request (not with the version) is refused before anything is stored.
func TestDocumentsReplace_ValidationAndFileFailures(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	pdf := func() docPart { return filePart("b.pdf", bytesPDF(150)) }
	raw := func(v string) docPart { return docPart{name: "expected_version", body: []byte(v)} }
	for _, tc := range []struct {
		name   string
		parts  []docPart
		status int
		code   string
		fields []map[string]any
		data   map[string]any
	}{
		{"expected_version missing", []docPart{pdf()}, 400, "validation_error", []map[string]any{{"field": "expected_version", "code": "required"}}, nil},
		{"expected_version empty", []docPart{raw(""), pdf()}, 400, "validation_error", []map[string]any{{"field": "expected_version", "code": "invalid"}}, nil},
		{"expected_version text", []docPart{raw("last"), pdf()}, 400, "validation_error", []map[string]any{{"field": "expected_version", "code": "invalid"}}, nil},
		{"expected_version zero", []docPart{raw("0"), pdf()}, 400, "validation_error", []map[string]any{{"field": "expected_version", "code": "invalid"}}, nil},
		{"expected_version negative", []docPart{raw("-1"), pdf()}, 400, "validation_error", []map[string]any{{"field": "expected_version", "code": "invalid"}}, nil},
		{"expected_version decimal", []docPart{raw("1.0"), pdf()}, 400, "validation_error", []map[string]any{{"field": "expected_version", "code": "invalid"}}, nil},
		{"expected_version invalid after the file", []docPart{pdf(), raw("one")}, 400, "validation_error", []map[string]any{{"field": "expected_version", "code": "invalid"}}, nil},
		{"expected_version duplicated", []docPart{expectedPart(1), expectedPart(1), pdf()}, 400, "invalid_request", nil, nil},
		{"file missing", []docPart{expectedPart(1)}, 400, "invalid_request", nil, nil},
		{"file duplicated", []docPart{expectedPart(1), pdf(), pdf()}, 400, "invalid_request", nil, nil},
		{"unknown part", []docPart{expectedPart(1), docPart{name: "extra", body: []byte("x")}, pdf()}, 400, "invalid_request", nil, nil},
		{"transfer encoding", []docPart{expectedPart(1), docPart{name: "file", filename: "b.pdf", body: bytesPDF(50), headers: map[string]string{"Content-Transfer-Encoding": "base64"}}}, 400, "invalid_request", nil, nil},
		{"name only extension", []docPart{expectedPart(1), namePart(".pdf"), pdf()}, 400, "validation_error", []map[string]any{{"field": "name", "code": "invalid"}}, nil},
		{"name too long", []docPart{expectedPart(1), namePart(strings.Repeat("ñ", 121)), pdf()}, 400, "validation_error", []map[string]any{{"field": "name", "code": "invalid"}}, nil},
		{"empty file", []docPart{expectedPart(1), filePart("b.pdf", nil)}, 400, "validation_error", []map[string]any{{"field": "file", "code": "empty"}}, nil},
		{"extension and bytes disagree", []docPart{expectedPart(1), filePart("b.pdf", bytesPNG())}, 400, "document_content_mismatch", nil, map[string]any{"detected_format": "png", "extension": ".pdf"}},
		{"bytes of nothing accepted", []docPart{expectedPart(1), filePart("b.docx", []byte("plain text"))}, 400, "document_content_mismatch", nil, map[string]any{"detected_format": nil, "extension": ".docx"}},
		{"legacy .doc", []docPart{expectedPart(1), filePart("b.doc", bytesLegacyOffice())}, 415, "unsupported_media_type", nil, nil},
		{"no extension", []docPart{expectedPart(1), filePart("contrato", bytesPDF(50))}, 415, "unsupported_media_type", nil, nil},
		{"over the size limit", []docPart{expectedPart(1), filePart("big.pdf", bytesPDF(documents.MaxBytes+1))}, 413, "payload_too_large", nil, map[string]any{"max_bytes": float64(documents.MaxBytes)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := f.replace(f.owner.token, draft, doc, tc.parts...)
			draftFlowAssertError(t, got, tc.status, tc.code)
			body := draftFlowObject(t, got.body)
			if tc.fields != nil {
				fields := []map[string]any{}
				for _, x := range body["fields"].([]any) {
					fields = append(fields, x.(map[string]any))
				}
				if !reflect.DeepEqual(fields, tc.fields) {
					t.Fatalf("fields %v", fields)
				}
			}
			if tc.data != nil && !reflect.DeepEqual(body["data"], tc.data) {
				t.Fatalf("data %v", body["data"])
			}
			if f.versionCount(doc) != 1 || f.objects() != 1 || len(f.events(draft, "DocumentReplaced")) != 0 {
				t.Fatalf("a failed replace stored something: versions %d objects %d events %d", f.versionCount(doc), f.objects(), len(f.events(draft, "DocumentReplaced")))
			}
		})
	}
	t.Run("not multipart", func(t *testing.T) {
		got := f.docs.do(t, "POST", f.docPath(draft, doc)+"/versions", `{"expected_version":1}`, f.owner.token, map[string]string{"Content-Type": "application/json"})
		draftFlowAssertError(t, got, 400, "invalid_request")
	})
	t.Run("exactly the size limit is accepted", func(t *testing.T) {
		f.replaceOK(f.owner.token, draft, doc, 1, "exact.pdf", bytesPDF(documents.MaxBytes))
	})
}

// Two replaces that both saw version 1: one wins, the others get 409 with the new current version; history never loses a
// version and the losers' files are removed.
func TestDocumentsReplace_ConcurrentReplacesOneWins(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	const racers = 6
	type outcome struct {
		resp draftFlowResponse
		err  error
	}
	start := make(chan struct{})
	out := make(chan outcome, racers)
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		body, ct := docsMultipart(t, expectedPart(1), filePart(fmt.Sprintf("r%d.pdf", i), bytesPDF(200+i)))
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, err := f.docs.roundTrip("POST", f.docPath(draft, doc)+"/versions", body, f.owner.token, map[string]string{"Content-Type": ct})
			out <- outcome{resp, err}
		}()
	}
	close(start)
	wg.Wait()
	close(out)
	won, lost := 0, 0
	for o := range out {
		if o.err != nil {
			t.Fatal(o.err)
		}
		switch o.resp.status {
		case 201:
			won++
		case 409:
			lost++
			if o.resp.header.Get("Content-Type") != "application/json" || !strings.Contains(string(o.resp.body), `"document_version_conflict"`) || !strings.Contains(string(o.resp.body), `"current_version":2`) {
				t.Fatalf("loser: %s", o.resp.body)
			}
		default:
			t.Fatalf("racer: %d %s", o.resp.status, o.resp.body)
		}
	}
	if won != 1 || lost != racers-1 {
		t.Fatalf("won %d lost %d", won, lost)
	}
	if f.versionCount(doc) != 2 || f.objects() != 2 || len(f.events(draft, "DocumentReplaced")) != 1 {
		t.Fatalf("versions %d objects %d events %d", f.versionCount(doc), f.objects(), len(f.events(draft, "DocumentReplaced")))
	}
}

// The lock path itself, deterministically: both replaces passed the pre-flight and streamed their file before either
// committed, so only the check under the draft lock can tell them apart.
func TestDocumentsReplace_ConflictUnderTheDraftLock(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	svc, ctx := f.service(), context.Background()
	d, docUUID := documents.VacancyTarget(uuid.MustParse(draft)), uuid.MustParse(doc)
	for i := 0; i < 2; i++ {
		if current, err := svc.PreflightReplace(ctx, f.company.companyID, f.owner.userID, d, docUUID); err != nil || current != 1 {
			t.Fatalf("pre-flight %d: current %d err %v", i, current, err)
		}
	}
	first, err := svc.Stage(ctx, "one.pdf", bytes.NewReader(bytesPDF(300)))
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Stage(ctx, "two.pdf", bytes.NewReader(bytesPDF(400)))
	if err != nil {
		t.Fatal(err)
	}
	cmd := func(s documents.Staged) documents.ReplaceCommand {
		return documents.ReplaceCommand{CompanyID: f.company.companyID, ActorID: f.owner.userID, Target: d, DocID: docUUID, ExpectedVersion: 1, Staged: s}
	}
	if res, err := svc.Replace(ctx, cmd(first)); err != nil || res.Item.Version != 2 {
		t.Fatalf("first: %+v %v", res, err)
	}
	var conflict *documents.VersionConflictError
	if _, err := svc.Replace(ctx, cmd(second)); !errors.As(err, &conflict) || conflict.Current != 2 {
		t.Fatalf("second: %v", err)
	}
	if f.objects() != 2 || f.versionCount(doc) != 2 { // the loser's object was removed: v1 and the winner remain
		t.Fatalf("objects %d versions %d", f.objects(), f.versionCount(doc))
	}
}

// The write takes the draft row lock (D23): while another transaction holds it (a team change, a lifecycle move, another
// document write) a replace and a delete wait, and go through once it is released. Without the lock two replaces could
// read the same current version.
func TestDocumentsReplaceAndDelete_WaitForTheDraftLock(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	svc, ctx := f.service(), context.Background()
	d, docUUID := documents.VacancyTarget(uuid.MustParse(draft)), uuid.MustParse(doc)
	staged, err := svc.Stage(ctx, "b.pdf", bytes.NewReader(bytesPDF(200)))
	if err != nil {
		t.Fatal(err)
	}

	hold, err := f.h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(ctx) }()
	if _, err := hold.Exec(ctx, `SELECT id FROM job_drafts WHERE id=$1 FOR UPDATE`, draft); err != nil {
		t.Fatal(err)
	}
	replaced, deleted := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := svc.Replace(ctx, documents.ReplaceCommand{CompanyID: f.company.companyID, ActorID: f.owner.userID, Target: d, DocID: docUUID, ExpectedVersion: 1, Staged: staged})
		replaced <- err
	}()
	go func() {
		_, err := svc.Delete(ctx, f.company.companyID, f.owner.userID, d, docUUID)
		deleted <- err
	}()
	select {
	case err := <-replaced:
		t.Fatalf("the replace did not wait for the draft lock: %v", err)
	case err := <-deleted:
		t.Fatalf("the delete did not wait for the draft lock: %v", err)
	case <-time.After(400 * time.Millisecond):
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	// Whichever got the lock first, the other saw its result: replace-then-delete deletes version 1 and 2; delete-then-replace
	// leaves a replace that finds no document. Never a half state.
	var errs [2]error
	for i, ch := range []chan error{replaced, deleted} {
		select {
		case errs[i] = <-ch:
		case <-time.After(10 * time.Second):
			t.Fatal("a write never finished after the lock was released")
		}
	}
	if errs[1] != nil {
		t.Fatalf("delete: %v", errs[1])
	}
	if errs[0] != nil && !errors.Is(errs[0], documents.ErrScopeNotFound) {
		t.Fatalf("replace: %v", errs[0])
	}
	if f.docCount(draft) != 0 || f.versionCount(doc) != 0 {
		t.Fatalf("the document survived: docs %d versions %d", f.docCount(draft), f.versionCount(doc))
	}
	if errs[0] != nil { // the replace lost: its object was removed and only the delete event exists
		if f.objects() != 0 || len(f.events(draft, "DocumentReplaced")) != 0 {
			t.Fatalf("objects %d replaced events %d", f.objects(), len(f.events(draft, "DocumentReplaced")))
		}
	}
	if len(f.events(draft, "DocumentDeleted")) != 1 {
		t.Fatalf("DocumentDeleted rows: %d", len(f.events(draft, "DocumentDeleted")))
	}
}

// A replace that streamed its file while the document was being deleted lands nowhere and leaves nothing behind.
func TestDocumentsReplace_DocumentDeletedWhileStreaming(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	svc, ctx := f.service(), context.Background()
	d, docUUID := documents.VacancyTarget(uuid.MustParse(draft)), uuid.MustParse(doc)
	if _, err := svc.PreflightReplace(ctx, f.company.companyID, f.owner.userID, d, docUUID); err != nil {
		t.Fatal(err)
	}
	staged, err := svc.Stage(ctx, "b.pdf", bytes.NewReader(bytesPDF(300)))
	if err != nil {
		t.Fatal(err)
	}
	if got := f.deleteDoc(f.owner.token, draft, doc); got.status != 200 {
		t.Fatalf("delete: %d %s", got.status, got.body)
	}
	_, err = svc.Replace(ctx, documents.ReplaceCommand{CompanyID: f.company.companyID, ActorID: f.owner.userID, Target: d, DocID: docUUID, ExpectedVersion: 1, Staged: staged})
	if !errors.Is(err, documents.ErrScopeNotFound) {
		t.Fatalf("err = %v", err)
	}
	if f.objects() != 0 || f.docCount(draft) != 0 || len(f.events(draft, "DocumentReplaced")) != 0 {
		t.Fatalf("objects %d docs %d replaced events %d", f.objects(), f.docCount(draft), len(f.events(draft, "DocumentReplaced")))
	}
}

// 25 versions: `replace` leaves allowed_actions with the 25th, a write beyond answers document_limit_reached (kind versions)
// after the stale check, and the document can still be downloaded, listed and deleted.
func TestDocumentsReplace_VersionCap(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	for v := 1; v < documents.MaxVersions; v++ {
		body := f.replaceOK(f.owner.token, draft, doc, v, fmt.Sprintf("v%d.pdf", v+1), bytesPDF(100+v))
		item := body["item"].(map[string]any)
		wantActions := []string{"download", "replace", "delete"}
		if v+1 == documents.MaxVersions {
			wantActions = []string{"download", "delete"}
		}
		if item["version"] != float64(v+1) || !reflect.DeepEqual(strs(item["allowed_actions"]), wantActions) {
			t.Fatalf("after replace %d: version %v actions %v", v, item["version"], item["allowed_actions"])
		}
	}
	if f.versionCount(doc) != 25 || f.objects() != 25 {
		t.Fatalf("versions %d objects %d", f.versionCount(doc), f.objects())
	}
	if actions := strs(f.ok(f.owner.token, draft)["items"].([]any)[0].(map[string]any)["allowed_actions"]); !reflect.DeepEqual(actions, []string{"download", "delete"}) {
		t.Fatalf("list actions at the cap: %v", actions)
	}

	got := f.replace(f.owner.token, draft, doc, expectedPart(25), filePart("v26.pdf", bytesPDF(500)))
	draftFlowAssertError(t, got, 409, "document_limit_reached")
	if data := draftFlowObject(t, got.body)["data"]; !reflect.DeepEqual(data, map[string]any{"kind": "versions", "limit": float64(25)}) {
		t.Fatalf("data %v", data)
	}
	// Also when the file comes first (answered under the lock, the object is removed).
	draftFlowAssertError(t, f.replace(f.owner.token, draft, doc, filePart("v26.pdf", bytesPDF(500)), expectedPart(25)), 409, "document_limit_reached")
	// The stale value wins over the cap.
	got = f.replace(f.owner.token, draft, doc, expectedPart(24), filePart("v26.pdf", bytesPDF(500)))
	draftFlowAssertError(t, got, 409, "document_version_conflict")
	if data := draftFlowObject(t, got.body)["data"]; !reflect.DeepEqual(data, map[string]any{"current_version": float64(25)}) {
		t.Fatalf("data %v", data)
	}
	if f.versionCount(doc) != 25 || f.objects() != 25 || len(f.events(draft, "DocumentReplaced")) != 24 {
		t.Fatalf("a refused write changed state: versions %d objects %d events %d", f.versionCount(doc), f.objects(), len(f.events(draft, "DocumentReplaced")))
	}

	body := draftFlowObject(t, f.versions(f.owner.token, draft, doc).body)
	versions := body["versions"].([]any)
	if len(versions) != 25 || versions[0].(map[string]any)["version"] != float64(25) || versions[24].(map[string]any)["version"] != float64(1) {
		t.Fatalf("version list: %d entries", len(versions))
	}
	if got := f.versionFile(f.owner.token, draft, doc, 1); got.status != 200 {
		t.Fatalf("download of version 1: %d", got.status)
	}
	if got := f.deleteDoc(f.owner.token, draft, doc); got.status != 200 || f.objects() != 0 {
		t.Fatalf("delete at the cap: %d objects %d", got.status, f.objects())
	}
}

// --- versions list and download by version ---------------------------------------------------------------------

func TestDocumentsVersions_ListOrderAndShape(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	luis := f.name(f.member("recruiter"), "Luis Ortega")
	draft := publicationFlowReady(t, f.h, ana)
	teamAccessCollaborator(t, f.h, draft, f.company.companyID, luis.userID, f.owner.userID)
	stakeholder := f.member("stakeholder")
	v1, v2, v3 := bytesDOCX(t), bytesPDF(3000), bytesPNG()
	doc := docID(f.uploadOK(ana.token, draft, "Contrato marco.docx", v1))
	f.replaceOK(luis.token, draft, doc, 1, "x.pdf", v2)
	f.replaceOK(ana.token, draft, doc, 2, "y.png", v3)

	for _, actor := range []draftFlowActor{ana, luis, f.owner, stakeholder} { // read gate: owner, team, stakeholder
		got := f.versions(actor.token, draft, doc)
		draftFlowAssertNoStore(t, got)
		if got.status != 200 || got.header.Get("Content-Type") != "application/json" {
			t.Fatalf("%d %s", got.status, got.body)
		}
		body := draftFlowObject(t, got.body)
		if !reflect.DeepEqual(docsSorted(body), []string{"document_id", "name", "versions"}) || body["document_id"] != doc || body["name"] != "Contrato marco" {
			t.Fatalf("body %s", got.body)
		}
		list := body["versions"].([]any)
		if len(list) != 3 {
			t.Fatalf("versions: %d", len(list))
		}
		for i, want := range []struct {
			version      float64
			format, ctyp string
			size         int
			by, uploader string
			current      bool
		}{
			{3, "png", "image/png", len(v3), ana.userID.String(), "Ana López", true},
			{2, "pdf", docPDF, len(v2), luis.userID.String(), "Luis Ortega", false},
			{1, "docx", docDOCX, len(v1), ana.userID.String(), "Ana López", false},
		} {
			v := list[i].(map[string]any)
			if !reflect.DeepEqual(docsSorted(v), []string{"content_type", "format", "is_current", "size", "uploaded_at", "uploaded_by", "version"}) {
				t.Fatalf("version keys: %v", docsSorted(v))
			}
			if v["version"] != want.version || v["format"] != want.format || v["content_type"] != want.ctyp || v["size"] != float64(want.size) || v["is_current"] != want.current ||
				!reflect.DeepEqual(v["uploaded_by"], map[string]any{"id": want.by, "name": want.uploader}) {
				t.Fatalf("entry %d: %v", i, v)
			}
		}
		if list[0].(map[string]any)["uploaded_at"].(string) <= list[2].(map[string]any)["uploaded_at"].(string) {
			t.Fatalf("timestamps: %v", list)
		}
	}
	// Listing is not audited (no content leaves).
	if n := f.count(`SELECT count(*) FROM audit_events WHERE company_id=$1 AND event_type='DocumentDownloaded'`, f.company.companyID); n != 0 {
		t.Fatalf("download events after listing: %d", n)
	}
}

// Versions are ordered by number, not by time: the clock of a seeded history may run the other way.
func TestDocumentsVersions_OrderedByVersionNumber(t *testing.T) {
	f := newDocsFlow(t) // storage disabled: the list reads only the database
	draft := publicationFlowReady(t, f.h, f.owner)
	doc, ids := f.insertDocument(draft, "", "Contrato", f.owner,
		docVersion{docPDF, 11, docsAt(9), f.owner}, docVersion{docDOCX, 22, docsAt(1), f.owner}, docVersion{docPDF, 33, docsAt(5), f.owner})
	list := draftFlowObject(t, f.versions(f.owner.token, draft, doc).body)["versions"].([]any)
	got := []float64{}
	current := []bool{}
	for _, v := range list {
		got = append(got, v.(map[string]any)["version"].(float64))
		current = append(current, v.(map[string]any)["is_current"].(bool))
	}
	if !reflect.DeepEqual(got, []float64{3, 2, 1}) || !reflect.DeepEqual(current, []bool{true, false, false}) {
		t.Fatalf("versions %v current %v (ids %v)", got, current, ids)
	}
	// The list endpoint of the vacancy agrees: the current version is the highest number.
	item := f.ok(f.owner.token, draft)["items"].([]any)[0].(map[string]any)
	if item["version"] != float64(3) || item["size"] != float64(33) {
		t.Fatalf("item: %v", item)
	}
}

func TestDocumentsVersions_ScopeAndInput(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := f.published()
	other := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	stage := pipelineconfig.Defaults(uuid.MustParse(draft)).Stages[0].ID
	participation := draftListCandidateSeed(t, f.h, draft, stage)
	partDoc, _ := f.insertDocument(draft, participation, "Del candidato", f.owner, docVersion{docPDF, 1, docsAt(0), f.owner})

	draftFlowAssertError(t, f.versions(f.owner.token, draft, uuid.NewString()), 404, "not_found")
	draftFlowAssertError(t, f.versions(f.owner.token, other, doc), 404, "not_found") // a document of another vacancy
	draftFlowAssertError(t, f.versions(f.owner.token, draft, partDoc), 404, "not_found")
	draftFlowAssertError(t, f.versions(f.owner.token, draft, "not-a-uuid"), 400, "invalid_request")
	draftFlowAssertError(t, f.versions(f.owner.token, "not-a-uuid", doc), 400, "invalid_request")
	draftFlowAssertError(t, f.versions("", draft, doc), 401, "unauthenticated")
	_, otherOwnerID, otherSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	draftFlowAssertError(t, f.versions(f.h.actor(t, otherOwnerID, otherSub).token, draft, doc), 404, "not_found")

	// Replace and delete never reach a participation document either (P6 owns that scope).
	draftFlowAssertError(t, f.replace(f.owner.token, draft, partDoc, expectedPart(1), filePart("b.pdf", bytesPDF(50))), 404, "not_found")
	draftFlowAssertError(t, f.deleteDoc(f.owner.token, draft, partDoc), 404, "not_found")
	draftFlowAssertError(t, f.versionFile(f.owner.token, draft, partDoc, 1), 404, "not_found")
	if f.count(`SELECT count(*) FROM placement_documents WHERE id=$1`, partDoc) != 1 || f.count(`SELECT count(*) FROM placement_document_versions WHERE document_id=$1`, partDoc) != 1 {
		t.Fatal("a vacancy route touched a participation document")
	}
}

func TestDocumentsDownloadVersion_HeadersBytesAndAudit(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	draft := publicationFlowReady(t, f.h, ana)
	stakeholder := f.member("stakeholder")
	v1, v2 := bytesPDF(4096), bytesDOCX(t)
	doc := docID(f.uploadOK(ana.token, draft, "Contrato marco.pdf", v1))
	f.replaceOK(ana.token, draft, doc, 1, "firmado.docx", v2)

	// Each version is served with ITS format: contrato.pdf is never served as «….pdf.docx» nor the docx as a pdf.
	for _, tc := range []struct {
		n           int
		body        []byte
		ctyp, cdisp string
	}{
		{1, v1, docPDF, `attachment; filename="Contrato marco.pdf"`},
		{2, v2, docDOCX, `attachment; filename="Contrato marco.docx"`},
	} {
		got := f.versionFile(stakeholder.token, draft, doc, tc.n) // read gate: a stakeholder downloads
		draftFlowAssertNoStore(t, got)
		if got.status != 200 || !bytes.Equal(got.body, tc.body) {
			t.Fatalf("version %d: %d (%d bytes)", tc.n, got.status, len(got.body))
		}
		h := got.header
		if h.Get("Content-Type") != tc.ctyp || h.Get("Content-Disposition") != tc.cdisp || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Content-Length") != strconv.Itoa(len(tc.body)) {
			t.Fatalf("version %d headers: %v", tc.n, h)
		}
	}
	// `/file` is still the current version.
	if got := f.download(ana.token, draft, doc); got.status != 200 || !bytes.Equal(got.body, v2) {
		t.Fatalf("current: %d", got.status)
	}

	// Audited like P4: one row per download, with the version it served.
	events := f.downloadEvents(draft)
	if len(events) != 3 {
		t.Fatalf("download events: %d", len(events))
	}
	draftID := uuid.MustParse(draft)
	for i, want := range []struct {
		version string
		id      string
		actor   uuid.UUID
	}{{"1", f.versionID(doc, 1), stakeholder.userID}, {"2", f.versionID(doc, 2), stakeholder.userID}, {"2", f.versionID(doc, 2), ana.userID}} {
		assertAuditRow(t, events[i], wantAuditRow{
			actor: want.actor, eventType: "DocumentDownloaded", entityType: "document", entityID: uuid.MustParse(doc), company: f.company.companyID, vacancy: &draftID,
			metadata: map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": draft, "scope": "vacancy", "document_id": doc, "version_id": want.id, "version": want.version},
		})
	}
	if strings.Contains(string(mustJSON(t, events[0].Metadata)), "Contrato") {
		t.Fatal("the file name leaked into the audit metadata")
	}
}

func TestDocumentsDownloadVersion_NothingRecordedWhenNothingIsServed(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(300)))
	f.replaceOK(f.owner.token, draft, doc, 1, "b.pdf", bytesPDF(310))
	assertNoServe := func(label string, got draftFlowResponse, status int, code string) {
		t.Helper()
		draftFlowAssertError(t, got, status, code)
		if got.header.Get("Content-Disposition") != "" || bytes.Contains(got.body, []byte("%PDF")) || len(f.downloadEvents(draft)) != 0 {
			t.Fatalf("%s: served or recorded something", label)
		}
	}
	assertNoServe("version that does not exist", f.versionFile(f.owner.token, draft, doc, 3), 404, "not_found")
	assertNoServe("a very high version", f.versionFile(f.owner.token, draft, doc, 1000), 404, "not_found")
	assertNoServe("unknown document", f.versionFile(f.owner.token, draft, uuid.NewString(), 1), 404, "not_found")
	for _, n := range []string{"0", "-1", "abc", "1.5", "+1", "99999999999999999999"} {
		assertNoServe("version "+n, f.versionFile(f.owner.token, draft, doc, url.PathEscape(n)), 400, "invalid_request")
	}

	key := f.keyOf(doc, 1) // version 1's file is gone from storage: 404, and version 2 still downloads
	if err := os.Rename(filepath.Join(f.dir, key), filepath.Join(f.dir, key+".moved")); err != nil {
		t.Fatal(err)
	}
	assertNoServe("file missing", f.versionFile(f.owner.token, draft, doc, 1), 404, "not_found")
	if err := os.Rename(filepath.Join(f.dir, key+".moved"), filepath.Join(f.dir, key)); err != nil {
		t.Fatal(err)
	}

	f.storage.mu.Lock()
	f.storage.openErr = documents.ErrStorageUnavailable
	f.storage.mu.Unlock()
	assertNoServe("storage unavailable", f.versionFile(f.owner.token, draft, doc, 1), 503, "document_storage_unavailable")
	f.storage.mu.Lock()
	f.storage.openErr = nil
	f.storage.mu.Unlock()

	allow := auditBlock(t, f.h.pool, f.company.companyID, "DocumentDownloaded")
	opened, closed := f.storage.streams()
	assertNoServe("audit failure", f.versionFile(f.owner.token, draft, doc, 1), 500, "internal_error")
	if o, c := f.storage.streams(); o != opened+1 || c != closed+1 {
		t.Fatalf("the stream opened for a failed audit must be closed: opened %d->%d closed %d->%d", opened, o, closed, c)
	}
	allow()
	if got := f.versionFile(f.owner.token, draft, doc, 1); got.status != 200 || len(f.downloadEvents(draft)) != 1 {
		t.Fatalf("after the block: %d events %d", got.status, len(f.downloadEvents(draft)))
	}
}

// --- delete -----------------------------------------------------------------------------------------------------

// Delete answers 200 {scope}; the rows and every version's file go, the audit event stays, and the freed slot comes back.
func TestDocumentsDelete_RemovesRowsFilesAndFreesTheSlot(t *testing.T) {
	f := newDocsUploadFlow(t)
	ana := f.name(f.member("recruiter"), "Ana López")
	draft := publicationFlowReady(t, f.h, ana)
	// A second, untouched document and 48 seeded ones: the scope is full (50) with the document under test.
	keep := docID(f.uploadOK(ana.token, draft, "Otro.pdf", bytesPDF(80)))
	doc := docID(f.uploadOK(ana.token, draft, "Informe confidencial de Juan Pérez.pdf", bytesPDF(120)))
	f.replaceOK(ana.token, draft, doc, 1, "v2.docx", bytesDOCX(t))
	for i := 0; i < 48; i++ {
		f.insertDocument(draft, "", fmt.Sprintf("Sembrado %d", i), ana, docVersion{docPDF, 5, docsAt(i), ana})
	}
	full := f.ok(ana.token, draft)
	if s := docsScope(full); !reflect.DeepEqual(strs(s["allowed_actions"]), []string{}) || s["upload_blocked_reason"] != "limit_reached" {
		t.Fatalf("scope before: %v", s)
	}
	keys := []string{f.keyOf(doc, 1), f.keyOf(doc, 2)}
	keepKey := f.keyOf(keep, 1)
	objects := f.objects()

	got := f.deleteDoc(ana.token, draft, doc)
	draftFlowAssertNoStore(t, got)
	if got.status != 200 || got.header.Get("Content-Type") != "application/json" {
		t.Fatalf("%d %s %s", got.status, got.header.Get("Content-Type"), got.body)
	}
	body := draftFlowObject(t, got.body)
	if !reflect.DeepEqual(docsSorted(body), []string{"scope"}) {
		t.Fatalf("keys: %v", docsSorted(body))
	}
	scope := docsScope(body)
	if scope["can_manage"] != true || !reflect.DeepEqual(strs(scope["allowed_actions"]), []string{"upload"}) || scope["upload_blocked_reason"] != nil ||
		!reflect.DeepEqual(scope["counts"], map[string]any{"documents": float64(49), "links": float64(0)}) {
		t.Fatalf("scope after: %v", scope)
	}
	if list := f.ok(ana.token, draft); !reflect.DeepEqual(list["scope"], body["scope"]) || len(list["items"].([]any)) != 49 {
		t.Fatalf("the answer differs from the list: %v", list["scope"])
	}

	// Rows and files.
	if f.count(`SELECT count(*) FROM placement_documents WHERE id=$1`, doc) != 0 || f.versionCount(doc) != 0 || f.objects() != objects-2 {
		t.Fatalf("rows left or files kept: versions %d objects %d (was %d)", f.versionCount(doc), f.objects(), objects)
	}
	for _, key := range keys {
		if _, err := os.Stat(filepath.Join(f.dir, key)); !os.IsNotExist(err) {
			t.Fatalf("file %s still exists (%v)", key, err)
		}
	}
	if _, err := os.Stat(filepath.Join(f.dir, keepKey)); err != nil || f.versionCount(keep) != 1 {
		t.Fatal("another document was touched")
	}

	// The audit event outlives the document and its files, with ids and counts only.
	events := f.events(draft, "DocumentDeleted")
	if len(events) != 1 {
		t.Fatalf("DocumentDeleted rows: %d", len(events))
	}
	draftID := uuid.MustParse(draft)
	assertAuditRow(t, events[0], wantAuditRow{
		actor: ana.userID, eventType: "DocumentDeleted", entityType: "document", entityID: uuid.MustParse(doc), company: f.company.companyID, vacancy: &draftID,
		metadata: map[string]any{"company_id": f.company.companyID.String(), "vacancy_id": draft, "scope": "vacancy", "kind": "file", "document_id": doc, "version_count": "2", "linked_count": "0"},
	})
	if raw := string(mustJSON(t, events[0].Metadata)); strings.Contains(raw, "Juan") || strings.Contains(raw, "confidencial") {
		t.Fatalf("the name leaked into the audit metadata: %s", raw)
	}

	// Gone for every route; a repeated delete is a plain 404 and records nothing more.
	draftFlowAssertError(t, f.deleteDoc(ana.token, draft, doc), 404, "not_found")
	draftFlowAssertError(t, f.download(ana.token, draft, doc), 404, "not_found")
	draftFlowAssertError(t, f.versionFile(ana.token, draft, doc, 1), 404, "not_found")
	draftFlowAssertError(t, f.versions(ana.token, draft, doc), 404, "not_found")
	draftFlowAssertError(t, f.replace(ana.token, draft, doc, expectedPart(2), filePart("c.pdf", bytesPDF(50))), 404, "not_found")
	if len(f.events(draft, "DocumentDeleted")) != 1 || f.objects() != objects-2 {
		t.Fatal("a refused delete changed state")
	}
	// The freed slot is usable.
	f.uploadOK(ana.token, draft, "Nuevo.pdf", bytesPDF(60))
}

// A storage failure after the commit does not undo the delete: the answer is still 200 {scope}, the rows and the audit event
// are final, and the files stay as orphans that Reconcile removes once they are older than the grace window.
func TestDocumentsDelete_StorageFailureLeavesAnOrphanForReconcile(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	f.replaceOK(f.owner.token, draft, doc, 1, "b.pdf", bytesPDF(110))
	keys := []string{f.keyOf(doc, 1), f.keyOf(doc, 2)}

	f.storage.failDeletes(documents.ErrStorageUnavailable)
	got := f.deleteDoc(f.owner.token, draft, doc)
	if got.status != 200 {
		t.Fatalf("a storage failure after the commit must not fail the delete: %d %s", got.status, got.body)
	}
	body := draftFlowObject(t, got.body)
	if !reflect.DeepEqual(docsSorted(body), []string{"scope"}) || !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(0), "links": float64(0)}) {
		t.Fatalf("body %s", got.body)
	}
	if strings.Contains(string(got.body), "unavailable") || strings.Contains(string(got.body), "storage") {
		t.Fatalf("the storage failure leaked: %s", got.body)
	}
	if f.storage.deletes < 2 {
		t.Fatalf("both files must have been attempted, got %d", f.storage.deletes)
	}
	// Rows gone and audit written; the files remain, unreferenced.
	if f.docCount(draft) != 0 || f.versionCount(doc) != 0 || f.objects() != 2 {
		t.Fatalf("docs %d versions %d objects %d", f.docCount(draft), f.versionCount(doc), f.objects())
	}
	if n := f.count(`SELECT count(*) FROM placement_document_versions WHERE storage_key = ANY($1)`, keys); n != 0 {
		t.Fatalf("%d version rows still reference the orphans", n)
	}
	if len(f.events(draft, "DocumentDeleted")) != 1 {
		t.Fatal("the audit event must exist even though the file could not be deleted")
	}
	draftFlowAssertError(t, f.download(f.owner.token, draft, doc), 404, "not_found")

	// Reconcile leaves young orphans alone (they could belong to an upload in flight) and removes them once they are old.
	reconciler := documentspostgres.NewReconciler(f.h.pool, f.storage)
	f.storage.failDeletes(nil)
	if err := reconciler.Reconcile(context.Background()); err != nil || f.objects() != 2 {
		t.Fatalf("young orphans: err %v objects %d", err, f.objects())
	}
	old := time.Now().Add(-2 * documents.OrphanGrace)
	for _, key := range keys {
		if err := os.Chtimes(filepath.Join(f.dir, key), old, old); err != nil {
			t.Fatal(err)
		}
	}
	if err := reconciler.Reconcile(context.Background()); err != nil || f.objects() != 0 {
		t.Fatalf("old orphans: err %v objects %d", err, f.objects())
	}
	if len(f.events(draft, "DocumentDeleted")) != 1 {
		t.Fatal("the audit event must outlive the file")
	}
}

// The files of a document that stays are never deleted: a failed audit rolls the delete back as a whole.
func TestDocumentsDelete_AuditFailureKeepsEverything(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	f.replaceOK(f.owner.token, draft, doc, 1, "b.pdf", bytesPDF(110))
	allow := auditBlock(t, f.h.pool, f.company.companyID, "DocumentDeleted", "DocumentReplaced")
	got := f.deleteDoc(f.owner.token, draft, doc)
	draftFlowAssertError(t, got, 500, "internal_error")
	if strings.Contains(string(got.body), "audit") {
		t.Fatalf("driver detail leaked: %s", got.body)
	}
	if f.docCount(draft) != 1 || f.versionCount(doc) != 2 || f.objects() != 2 || f.storage.deletes != 0 {
		t.Fatalf("a failed delete changed state: docs %d versions %d objects %d storage deletes %d", f.docCount(draft), f.versionCount(doc), f.objects(), f.storage.deletes)
	}
	// The replace is a write with an audit event too: it fails closed and removes its own object.
	got = f.replace(f.owner.token, draft, doc, expectedPart(2), filePart("c.pdf", bytesPDF(120)))
	draftFlowAssertError(t, got, 500, "internal_error")
	if f.versionCount(doc) != 2 || f.objects() != 2 || len(f.events(draft, "DocumentReplaced")) != 1 {
		t.Fatalf("a failed replace changed state: versions %d objects %d events %d", f.versionCount(doc), f.objects(), len(f.events(draft, "DocumentReplaced")))
	}
	allow()
	f.replaceOK(f.owner.token, draft, doc, 2, "c.pdf", bytesPDF(120))
	if got := f.deleteDoc(f.owner.token, draft, doc); got.status != 200 || f.objects() != 0 {
		t.Fatalf("after the block: %d objects %d", got.status, f.objects())
	}
}

// Deleting a source makes the links that point at it «removed» (D19): the link stays, the count includes it, the audit event
// says how many links lost their source.
func TestDocumentsDelete_LinksToTheDeletedDocumentBecomeRemoved(t *testing.T) {
	f := newDocsUploadFlow(t)
	root := f.published()
	f.closeIt(root, "finish")
	replacement := f.published()
	f.link(replacement, root, root, 1)
	doc := docID(f.uploadOK(f.owner.token, root, "Contrato original.pdf", bytesPDF(100)))
	link := f.linkDocument(replacement, doc, f.versionID(doc, 1), f.owner, docsAt(30))
	if state := f.ok(f.owner.token, replacement)["links"].([]any)[0].(map[string]any)["state"]; state != "available" {
		t.Fatalf("link before: %v", state)
	}

	if got := f.deleteDoc(f.owner.token, root, doc); got.status != 200 {
		t.Fatalf("%d %s", got.status, got.body)
	}
	events := f.events(root, "DocumentDeleted")
	if len(events) != 1 || events[0].Metadata["linked_count"] != "1" || events[0].Metadata["version_count"] != "1" {
		t.Fatalf("events %+v", events)
	}
	body := f.ok(f.owner.token, replacement)
	l := body["links"].([]any)[0].(map[string]any)
	if l["id"] != link || l["state"] != "removed" || l["source"] != nil || !reflect.DeepEqual(strs(l["allowed_actions"]), []string{"unlink"}) {
		t.Fatalf("link after: %v", l)
	}
	if !reflect.DeepEqual(docsScope(body)["counts"], map[string]any{"documents": float64(0), "links": float64(1)}) {
		t.Fatalf("counts: %v", docsScope(body)["counts"])
	}
}

// Racing deletes of one document: one answers 200 and the others a plain 404; one audit event, no object left.
func TestDocumentsDelete_ConcurrentDeletesDeleteOnce(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))
	f.replaceOK(f.owner.token, draft, doc, 1, "b.pdf", bytesPDF(110))
	const racers = 4
	statuses := make(chan int, racers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, err := f.docs.roundTrip("DELETE", f.docPath(draft, doc), "", f.owner.token, nil)
			if err != nil {
				statuses <- -1
				return
			}
			statuses <- resp.status
		}()
	}
	close(start)
	wg.Wait()
	close(statuses)
	ok, gone := 0, 0
	for s := range statuses {
		switch s {
		case 200:
			ok++
		case 404:
			gone++
		default:
			t.Fatalf("racer status %d", s)
		}
	}
	if ok != 1 || gone != racers-1 || len(f.events(draft, "DocumentDeleted")) != 1 || f.objects() != 0 {
		t.Fatalf("200s %d 404s %d events %d objects %d", ok, gone, len(f.events(draft, "DocumentDeleted")), f.objects())
	}
}

// --- authorization ----------------------------------------------------------------------------------------------

// The matrix of «Authorization» for the four P5 routes: owner and active team members manage; a stakeholder reads and
// downloads but is forbidden to replace or delete; a recruiter who was never on the team, a former member and another
// company get the usual 404s; nothing is changed by a refused caller.
func TestDocumentsVersions_AuthorizationMatrix(t *testing.T) {
	f := newDocsUploadFlow(t)
	responsible := f.name(f.member("recruiter"), "Rita Responsable")
	draft := publicationFlowReady(t, f.h, responsible)
	collaborator := f.member("recruiter")
	teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	outsider := f.member("recruiter")
	former := f.member("recruiter")
	teamAccessEndCollaborator(t, f.h, teamAccessCollaborator(t, f.h, draft, f.company.companyID, former.userID, f.owner.userID), f.owner.userID)
	stakeholder := f.member("stakeholder")
	_, otherOwnerID, otherSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	otherOwner := f.h.actor(t, otherOwnerID, otherSub)

	for _, tc := range []struct {
		name  string
		actor draftFlowActor
	}{{"owner", f.owner}, {"responsible recruiter", responsible}, {"active collaborator", collaborator}} {
		t.Run(tc.name+" manages", func(t *testing.T) {
			doc := docID(f.uploadOK(tc.actor.token, draft, tc.name+".pdf", bytesPDF(40)))
			f.replaceOK(tc.actor.token, draft, doc, 1, "v2.pdf", bytesPDF(50))
			if got := f.versions(tc.actor.token, draft, doc); got.status != 200 {
				t.Fatalf("versions: %d", got.status)
			}
			if got := f.versionFile(tc.actor.token, draft, doc, 1); got.status != 200 {
				t.Fatalf("download v1: %d", got.status)
			}
			if got := f.deleteDoc(tc.actor.token, draft, doc); got.status != 200 {
				t.Fatalf("delete: %d %s", got.status, got.body)
			}
		})
	}

	doc := docID(f.uploadOK(f.owner.token, draft, "protegido.pdf", bytesPDF(40)))
	objects, replaced, deleted := f.objects(), len(f.events(draft, "DocumentReplaced")), len(f.events(draft, "DocumentDeleted"))
	refuse := func(label string, actor draftFlowActor, status int, code string) {
		t.Helper()
		draftFlowAssertError(t, f.replace(actor.token, draft, doc, expectedPart(1), filePart("no.pdf", bytesPDF(40))), status, code)
		draftFlowAssertError(t, f.deleteDoc(actor.token, draft, doc), status, code)
		if f.versionCount(doc) != 1 || f.docCount(draft) != 1 || f.objects() != objects || len(f.events(draft, "DocumentReplaced")) != replaced || len(f.events(draft, "DocumentDeleted")) != deleted {
			t.Fatalf("%s: a refused caller changed state", label)
		}
	}
	t.Run("stakeholder writes are forbidden", func(t *testing.T) { refuse("stakeholder", stakeholder, 403, "forbidden") })
	t.Run("stakeholder reads and downloads", func(t *testing.T) {
		if got := f.versions(stakeholder.token, draft, doc); got.status != 200 {
			t.Fatalf("versions: %d %s", got.status, got.body)
		}
		if got := f.versionFile(stakeholder.token, draft, doc, 1); got.status != 200 {
			t.Fatalf("download: %d", got.status)
		}
	})
	t.Run("recruiter never on the team", func(t *testing.T) {
		refuse("outsider", outsider, 404, "not_found")
		draftFlowAssertError(t, f.versions(outsider.token, draft, doc), 404, "not_found")
		draftFlowAssertError(t, f.versionFile(outsider.token, draft, doc, 1), 404, "not_found")
	})
	t.Run("former member", func(t *testing.T) {
		refuse("former", former, 404, "team_access_ended")
		draftFlowAssertError(t, f.versions(former.token, draft, doc), 404, "team_access_ended")
		draftFlowAssertError(t, f.versionFile(former.token, draft, doc, 1), 404, "team_access_ended")
	})
	t.Run("owner of another company", func(t *testing.T) {
		refuse("other company", otherOwner, 404, "not_found")
		draftFlowAssertError(t, f.versions(otherOwner.token, draft, doc), 404, "not_found")
		draftFlowAssertError(t, f.versionFile(otherOwner.token, draft, doc, 1), 404, "not_found")
	})
	t.Run("general gates", func(t *testing.T) {
		draftFlowAssertError(t, f.replace("", draft, doc, expectedPart(1), filePart("no.pdf", bytesPDF(40))), 401, "unauthenticated")
		draftFlowAssertError(t, f.deleteDoc("", draft, doc), 401, "unauthenticated")
		draftFlowAssertError(t, f.replace(f.owner.token, uuid.NewString(), doc, expectedPart(1), filePart("no.pdf", bytesPDF(40))), 404, "not_found")
		draftFlowAssertError(t, f.deleteDoc(f.owner.token, uuid.NewString(), doc), 404, "not_found")
		draftFlowAssertError(t, f.replace(f.owner.token, draft, uuid.NewString(), expectedPart(1), filePart("no.pdf", bytesPDF(40))), 404, "not_found")
		draftFlowAssertError(t, f.replace(f.owner.token, draft, "not-a-uuid", expectedPart(1), filePart("no.pdf", bytesPDF(40))), 400, "invalid_request")
		draftFlowAssertError(t, f.deleteDoc(f.owner.token, draft, "not-a-uuid"), 400, "invalid_request")
		draftFlowAssertError(t, f.replace(f.owner.token, "not-a-uuid", doc, expectedPart(1), filePart("no.pdf", bytesPDF(40))), 400, "invalid_request")
		if f.versionCount(doc) != 1 || f.objects() != objects {
			t.Fatal("a refused request changed state")
		}
	})
	t.Run("a v1 draft is hidden like a missing one", func(t *testing.T) {
		id, _, _ := f.h.create(t, f.owner, uuid.NewString(), draftFlowMinimalCreate)
		draftFlowAssertError(t, f.replace(f.owner.token, id, doc, expectedPart(1), filePart("no.pdf", bytesPDF(40))), 404, "not_found")
		draftFlowAssertError(t, f.deleteDoc(f.owner.token, id, doc), 404, "not_found")
		draftFlowAssertError(t, f.versions(f.owner.token, id, doc), 404, "not_found")
	})
	t.Run("the store refuses a stakeholder itself", func(t *testing.T) {
		store := f.newStore(f.storage)
		d, docUUID := documents.VacancyTarget(uuid.MustParse(draft)), uuid.MustParse(doc)
		if _, err := store.AuthorizeReplace(context.Background(), f.company.companyID, stakeholder.userID, d, docUUID); !errors.Is(err, documents.ErrForbidden) {
			t.Fatalf("stakeholder pre-flight: %v", err)
		}
		if _, err := store.Delete(context.Background(), f.company.companyID, stakeholder.userID, d, docUUID); !errors.Is(err, documents.ErrForbidden) {
			t.Fatalf("stakeholder delete: %v", err)
		}
		if _, err := store.AuthorizeReplace(context.Background(), f.company.companyID, former.userID, d, docUUID); !errors.Is(err, documents.ErrTeamAccessEnded) {
			t.Fatalf("former member pre-flight: %v", err)
		}
		if f.docCount(draft) != 1 {
			t.Fatal("the store let a refused caller delete")
		}
	})
}

// A recruiter whose tramo ends while the replacement streams cannot land it: the draft lock and the re-authorization refuse
// it and the object is removed (failure table: «Authorization revoked between pre-flight and commit»).
func TestDocumentsReplace_RevokedBetweenPreflightAndCommit(t *testing.T) {
	f := newDocsUploadFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	collaborator := f.member("recruiter")
	assignment := teamAccessCollaborator(t, f.h, draft, f.company.companyID, collaborator.userID, f.owner.userID)
	doc := docID(f.uploadOK(f.owner.token, draft, "a.pdf", bytesPDF(100)))

	svc, ctx := f.service(), context.Background()
	d, docUUID := documents.VacancyTarget(uuid.MustParse(draft)), uuid.MustParse(doc)
	if _, err := svc.PreflightReplace(ctx, f.company.companyID, collaborator.userID, d, docUUID); err != nil {
		t.Fatal(err)
	}
	staged, err := svc.Stage(ctx, "b.pdf", bytes.NewReader(bytesPDF(200)))
	if err != nil {
		t.Fatal(err)
	}
	teamAccessEndCollaborator(t, f.h, assignment, f.owner.userID)
	_, err = svc.Replace(ctx, documents.ReplaceCommand{CompanyID: f.company.companyID, ActorID: collaborator.userID, Target: d, DocID: docUUID, ExpectedVersion: 1, Staged: staged})
	if !errors.Is(err, documents.ErrTeamAccessEnded) {
		t.Fatalf("err = %v", err)
	}
	if f.versionCount(doc) != 1 || f.objects() != 1 || len(f.events(draft, "DocumentReplaced")) != 0 {
		t.Fatalf("versions %d objects %d events %d", f.versionCount(doc), f.objects(), len(f.events(draft, "DocumentReplaced")))
	}
}

// --- after closure (S4) -----------------------------------------------------------------------------------------

// Replace and delete are document operations: allowed on a closed or finished vacancy, audited, and the lifecycle rows are
// byte-identical afterwards. A stakeholder stays forbidden.
func TestDocumentsReplaceAndDelete_AfterClosureLeaveTheVacancyByteIdentical(t *testing.T) {
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
			stakeholder := f.member("stakeholder")
			doc := docID(f.uploadOK(f.owner.token, id, "Contrato.pdf", bytesPDF(300)))
			before := f.vacancySnapshot(id)
			auditBefore := auditCompanyCount(t, f.h.pool, f.company.companyID)

			got := f.replace(f.owner.token, id, doc, expectedPart(1), filePart("Contrato firmado.docx", bytesDOCX(t)))
			if got.status != 201 {
				t.Fatalf("replace: %d %s", got.status, got.body)
			}
			if item := draftFlowObject(t, got.body)["item"].(map[string]any); item["version"] != float64(2) {
				t.Fatalf("item: %v", item)
			}
			if after := f.vacancySnapshot(id); after != before {
				t.Fatalf("the replace changed the vacancy\nbefore %s\nafter  %s", before, after)
			}
			if n := auditCompanyCount(t, f.h.pool, f.company.companyID); n != auditBefore+1 || len(f.events(id, "DocumentReplaced")) != 1 {
				t.Fatalf("audit rows %d -> %d, replaced events %d", auditBefore, n, len(f.events(id, "DocumentReplaced")))
			}
			draftFlowAssertError(t, f.replace(stakeholder.token, id, doc, expectedPart(2), filePart("no.pdf", bytesPDF(50))), 403, "forbidden")
			draftFlowAssertError(t, f.deleteDoc(stakeholder.token, id, doc), 403, "forbidden")
			if got := f.versionFile(stakeholder.token, id, doc, 1); got.status != 200 {
				t.Fatalf("stakeholder download after closure: %d", got.status)
			}

			downloads := auditCompanyCount(t, f.h.pool, f.company.companyID)
			if got := f.deleteDoc(f.owner.token, id, doc); got.status != 200 {
				t.Fatalf("delete: %d %s", got.status, got.body)
			}
			if after := f.vacancySnapshot(id); after != before {
				t.Fatalf("the delete changed the vacancy\nbefore %s\nafter  %s", before, after)
			}
			if n := auditCompanyCount(t, f.h.pool, f.company.companyID); n != downloads+1 || len(f.events(id, "DocumentDeleted")) != 1 {
				t.Fatalf("audit rows %d -> %d, deleted events %d", downloads, n, len(f.events(id, "DocumentDeleted")))
			}
		})
	}
}

// --- storage disabled -------------------------------------------------------------------------------------------

// With the storage disabled the routes that move a file answer 503 after their gates (nothing recorded); the version list
// reads only the database; a delete still removes the rows (it must always be possible, S6).
func TestDocumentsVersions_StorageDisabled(t *testing.T) {
	f := newDocsFlow(t)
	draft := publicationFlowReady(t, f.h, f.owner)
	stakeholder := f.member("stakeholder")
	outsider := f.member("recruiter")
	doc, _ := f.insertDocument(draft, "", "Contrato", f.owner, docVersion{docPDF, 10, docsAt(0), f.owner}, docVersion{docDOCX, 20, docsAt(1), f.owner})

	draftFlowAssertError(t, f.replace(f.owner.token, draft, doc, expectedPart(2), filePart("a.pdf", bytesPDF(80))), 503, "document_storage_unavailable")
	// The gates and the lookup answer first: a refused caller or an unknown document never learns that the storage is down.
	draftFlowAssertError(t, f.replace(stakeholder.token, draft, doc, expectedPart(2), filePart("a.pdf", bytesPDF(80))), 403, "forbidden")
	draftFlowAssertError(t, f.replace(outsider.token, draft, doc, expectedPart(2), filePart("a.pdf", bytesPDF(80))), 404, "not_found")
	draftFlowAssertError(t, f.replace(f.owner.token, draft, uuid.NewString(), expectedPart(1), filePart("a.pdf", bytesPDF(80))), 404, "not_found")
	draftFlowAssertError(t, f.versionFile(f.owner.token, draft, doc, 1), 503, "document_storage_unavailable")
	draftFlowAssertError(t, f.versionFile(outsider.token, draft, doc, 1), 404, "not_found")
	draftFlowAssertError(t, f.versionFile(f.owner.token, draft, doc, 9), 404, "not_found")
	if f.versionCount(doc) != 2 || len(f.events(draft, "DocumentReplaced")) != 0 || len(f.downloadEvents(draft)) != 0 {
		t.Fatal("something was recorded without storage")
	}
	if got := f.versions(stakeholder.token, draft, doc); got.status != 200 {
		t.Fatalf("version list without storage: %d %s", got.status, got.body)
	}
	if got := f.deleteDoc(f.owner.token, draft, doc); got.status != 200 || f.docCount(draft) != 0 || len(f.events(draft, "DocumentDeleted")) != 1 {
		t.Fatalf("delete without storage: %d docs %d", got.status, f.docCount(draft))
	}
}
