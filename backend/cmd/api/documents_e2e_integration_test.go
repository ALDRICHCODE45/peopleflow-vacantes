//go:build integration

package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/storage/s3/testsupport"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	documentspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/postgres"
	documentsstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/storage"
	documentss3 "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/storage/s3"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	sdk "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/aws/smithy-go/logging"
	"github.com/google/uuid"
)

// P8: the whole life of a document through the production router, once on the local adapter and once on S3 (MinIO, skipped unless
// DOCUMENT_S3_TEST_ENDPOINT is set): upload → list → overview → replace → versions → download a version → link from a replacement →
// delete → Reconcile leaves no orphan. The same function runs both so the two adapters cannot drift.

func TestDocumentsEndToEnd_LocalStorage(t *testing.T) {
	local, err := documentsstorage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = local.Close() })
	runDocumentsEndToEnd(t, local)
}

func TestDocumentsEndToEnd_S3Storage(t *testing.T) {
	endpoint := os.Getenv("DOCUMENT_S3_TEST_ENDPOINT")
	if err := testsupport.ValidateEndpoint(os.Getenv("APP_ENV"), endpoint); err != nil {
		t.Fatal(err)
	}
	if endpoint == "" {
		t.Skip("DOCUMENT_S3_TEST_ENDPOINT is not set")
	}
	ctx := context.Background()
	// The bucket is bootstrapped through the SDK (no AWS CLI), private by default; credentials come from the SDK chain.
	cfg, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion("us-east-1"), awsconfig.WithLogger(logging.Nop{}))
	if err != nil {
		t.Fatal("load test SDK configuration")
	}
	client := sdk.NewFromConfig(cfg, func(o *sdk.Options) { o.BaseEndpoint = aws.String(endpoint); o.UsePathStyle = true })
	if _, err = client.CreateBucket(ctx, &sdk.CreateBucketInput{Bucket: aws.String("document-files")}); err != nil {
		var api smithy.APIError
		if !(errors.As(err, &api) && api.ErrorCode() == "BucketAlreadyOwnedByYou") {
			t.Fatal("bootstrap private test bucket")
		}
	}
	storage, err := documentss3.New(ctx, documentss3.Options{Bucket: "document-files", Region: "us-east-1", Prefix: "router-tests/" + uuid.NewString(), Endpoint: endpoint, ForcePathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { // whatever a failed run left under the random prefix
		objects, err := storage.Objects(context.Background())
		if err != nil {
			t.Error(err)
			return
		}
		for _, o := range objects {
			if err := storage.Delete(context.Background(), o.Key); err != nil {
				t.Error(err)
			}
		}
	})
	runDocumentsEndToEnd(t, storage)
}

func storedObjects(t *testing.T, storage documents.Storage) map[string]bool {
	t.Helper()
	objects, err := storage.Objects(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]bool{}
	for _, o := range objects {
		out[o.Key] = true
	}
	return out
}

func runDocumentsEndToEnd(t *testing.T, storage documents.Storage) {
	t.Helper()
	ctx := context.Background()
	f := newDocsFlowWith(t, storage)
	if n := len(storedObjects(t, storage)); n != 0 {
		t.Fatalf("the storage namespace is not empty: %d objects", n)
	}
	ana := f.name(f.member("recruiter"), "Ana López")
	stakeholder := f.member("stakeholder")

	// An active original with Ana on the team; its replacement comes after the original is finished.
	original := f.published()
	teamAccessCollaborator(t, f.h, original, f.company.companyID, ana.userID, f.owner.userID)
	pid := f.participation(original, replStages(original)["placement"])

	// 1. Upload: a vacancy document and a candidate-process document.
	v1 := bytesPDF(300)
	up := f.uploadOK(ana.token, original, "Contrato original.pdf", v1)
	doc := docID(up)
	if item := up["item"].(map[string]any); item["name"] != "Contrato original" || item["format"] != "pdf" || item["size"] != float64(len(v1)) {
		t.Fatalf("uploaded item: %v", item)
	}
	cv := bytesPNG()
	pdoc := docID(f.uploadOK(ana.token, pscope(original, pid), "Oferta firmada.png", cv))
	if got := len(storedObjects(t, storage)); got != 2 {
		t.Fatalf("objects after two uploads: %d", got)
	}

	// 2. List: the vacancy document only (the participation's stays in its own scope).
	list := f.ok(ana.token, original)
	if !reflect.DeepEqual(docItemNames(list), []string{"Contrato original"}) || !reflect.DeepEqual(docsScope(list)["counts"], map[string]any{"documents": float64(1), "links": float64(0)}) {
		t.Fatalf("list: %v", list)
	}

	// 3. Overview: one table with both documents, each with its owner; the stakeholder reads the same rows.
	for _, actor := range []draftFlowActor{ana, stakeholder} {
		ov := f.overviewOK(actor.token, original, "")
		got := map[string]string{}
		for _, row := range ovRows(ov, "items") {
			got[row["id"].(string)] = row["owner"].(map[string]any)["kind"].(string)
		}
		if !reflect.DeepEqual(got, map[string]string{doc: "vacancy", pdoc: "participation"}) {
			t.Fatalf("overview owners: %v", got)
		}
	}

	// 4. Replace: a second version in another format.
	v2 := bytesDOCX(t)
	rep := f.replaceOK(ana.token, original, doc, 1, "Contrato v2.docx", v2)
	if item := rep["item"].(map[string]any); item["format"] != "docx" || item["version"] != float64(2) {
		t.Fatalf("replaced item: %v", item)
	}

	// 5. Versions, and the download of the old one: the exact bytes, as an attachment, audited.
	versions := draftFlowObject(t, f.versions(ana.token, original, doc).body)["versions"].([]any)
	if len(versions) != 2 || versions[0].(map[string]any)["is_current"] != true || versions[1].(map[string]any)["version"] != float64(1) {
		t.Fatalf("versions: %v", versions)
	}
	old := f.versionFile(ana.token, original, doc, 1)
	if old.status != 200 || !bytes.Equal(old.body, v1) || old.header.Get("Content-Type") != docPDF || old.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("version 1 download: %d %v", old.status, old.header)
	}
	if cur := f.download(ana.token, original, doc); cur.status != 200 || !bytes.Equal(cur.body, v2) || cur.header.Get("Content-Type") != docDOCX {
		t.Fatalf("current download: %d %v", cur.status, cur.header)
	}
	if got := len(storedObjects(t, storage)); got != 3 {
		t.Fatalf("objects after replace: %d", got)
	}

	// 6. The original is finished (S4); its replacement links version 1 explicitly. Nothing is copied.
	f.closeIt(original, "finish")
	replacement := f.published()
	f.link(replacement, original, original, 1)
	teamAccessCollaborator(t, f.h, replacement, f.company.companyID, ana.userID, f.owner.userID)
	link := f.linkOK(ana.token, replacement, doc, 1)
	linkRef := linkID(link)
	if dl := f.linkDownload(ana.token, replacement, linkRef); dl.status != 200 || !bytes.Equal(dl.body, v1) {
		t.Fatalf("link download: %d", dl.status)
	}
	rlist := f.ok(ana.token, replacement)
	if links := linkList(rlist); len(links) != 1 || links[0]["state"] != "available" || len(docItems(rlist)) != 0 {
		t.Fatalf("replacement list: %v", rlist)
	}
	rov := f.overviewOK(ana.token, replacement, "")
	if links := ovRows(rov, "links"); len(links) != 1 || links[0]["id"] != linkRef || links[0]["owner"].(map[string]any)["kind"] != "vacancy" {
		t.Fatalf("replacement overview links: %v", rov["links"])
	}
	if got := len(storedObjects(t, storage)); got != 3 {
		t.Fatalf("a link must not copy a file: %d objects", got)
	}

	// 7. Reconcile never touches a referenced object, however old «now» is; an unreferenced one is kept while young and removed once old.
	aged := func() time.Time { return time.Now().Add(2 * documents.OrphanGrace) }
	reconciler := documentspostgres.NewReconciler(f.h.pool, storage)
	if err := reconciler.WithClock(aged).Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	referenced := storedObjects(t, storage)
	if len(referenced) != 3 {
		t.Fatalf("Reconcile removed a referenced object: %d left", len(referenced))
	}
	orphan, _, err := storage.Put(ctx, bytes.NewReader(bytesPDF(64)), documents.MaxBytes)
	if err != nil {
		t.Fatal(err)
	}
	if err := reconciler.WithClock(time.Now).Reconcile(ctx); err != nil || !storedObjects(t, storage)[orphan] {
		t.Fatalf("a young orphan must survive (it may be an upload in flight): err=%v", err)
	}
	if err := reconciler.WithClock(aged).Reconcile(ctx); err != nil {
		t.Fatal(err)
	}
	if left := storedObjects(t, storage); left[orphan] || !reflect.DeepEqual(left, referenced) {
		t.Fatalf("Reconcile must remove exactly the old orphan: %v", left)
	}

	// 8. Delete the vacancy document after closure: rows and every version's file go, the link shows `removed`, the audit stays.
	if got := f.deleteDoc(ana.token, original, doc); got.status != 200 {
		t.Fatalf("delete: %d %s", got.status, got.body)
	}
	if got := len(storedObjects(t, storage)); got != 1 {
		t.Fatalf("objects after delete: %d (only the participation document's file stays)", got)
	}
	draftFlowAssertError(t, f.download(ana.token, original, doc), 404, "not_found")
	if l := linkList(f.ok(ana.token, replacement))[0]; l["state"] != "removed" || l["source"] != nil {
		t.Fatalf("link after the source was deleted: %v", l)
	}
	draftFlowAssertError(t, f.linkDownload(ana.token, replacement, linkRef), 404, "not_found")
	if got := f.linkDelete(ana.token, replacement, linkRef); got.status != 200 {
		t.Fatalf("unlink: %d %s", got.status, got.body)
	}
	if got := f.deleteDoc(ana.token, pscope(original, pid), pdoc); got.status != 200 {
		t.Fatalf("delete participation document: %d %s", got.status, got.body)
	}

	// 9. Nothing is left: no file, no row, and the audit trail tells the story with ids only.
	if left := storedObjects(t, storage); len(left) != 0 {
		t.Fatalf("files left after every delete: %v", left)
	}
	if n := f.count(`SELECT count(*) FROM placement_documents WHERE company_id=$1`, f.company.companyID); n != 0 {
		t.Fatalf("documents left: %d", n)
	}
	if n := f.count(`SELECT count(*) FROM placement_document_versions v JOIN placement_documents d ON d.id=v.document_id WHERE d.company_id=$1`, f.company.companyID); n != 0 {
		t.Fatalf("versions left: %d", n)
	}
	for _, want := range []struct {
		draft, event string
		count        int
	}{
		{original, "DocumentUploaded", 2}, {original, "DocumentReplaced", 1}, {replacement, "DocumentLinked", 1},
		{original, "DocumentDownloaded", 2}, {replacement, "DocumentDownloaded", 1}, {original, "DocumentDeleted", 2}, {replacement, "DocumentDeleted", 1},
	} {
		if got := len(f.events(want.draft, want.event)); got != want.count {
			t.Errorf("%s audit rows: %d, want %d", want.event, got, want.count)
		}
	}

	// 10. The scheduled sweep (the same wiring main uses: Reconcile under the advisory lock, started and stopped like in
	// shutdown) removes an old orphan on its first, immediate run and stops cleanly.
	late, _, err := storage.Put(ctx, bytes.NewReader(bytesPDF(64)), documents.MaxBytes)
	if err != nil {
		t.Fatal(err)
	}
	scheduler := documents.NewReconcileScheduler(reconciler.WithClock(aged), documentspostgres.NewAdvisoryLock(f.h.pool), nil)
	stop := startDocumentReconcile(ctx, scheduler)
	deadline := time.Now().Add(20 * time.Second)
	for storedObjects(t, storage)[late] {
		if time.Now().After(deadline) {
			stop()
			t.Fatal("the scheduled run did not remove the orphan")
		}
		time.Sleep(20 * time.Millisecond)
	}
	stop()
	if left := storedObjects(t, storage); len(left) != 0 {
		t.Fatalf("objects after the scheduled sweep: %v", left)
	}
}
