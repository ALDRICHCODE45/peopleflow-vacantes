package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	documentshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/http"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Production-router boundary tests for GET /v2/me/company/job-drafts/{id}/documents
// (placement-vacancy-documents-v1, P3). The real route table and middleware order are
// the real ones; the gates and the store are fakes. The authorization matrix against a
// real database is documents_list_integration_test.go.

type routeFiles struct {
	preflight, downloads int
	err                  error
	// P5: replace pre-flights, deletes and downloads of a numbered version
	replaces, deletes, versionDownloads int
	// P7: link, unlink and download through a link
	links, unlinks, linkDownloads int
	linkTarget                    documents.Target
}

func (f *routeFiles) Link(_ context.Context, cmd documents.LinkCommand) (documents.LinkResponse, error) {
	f.links++
	f.linkTarget = cmd.Target
	return documents.LinkResponse{}, f.err
}
func (f *routeFiles) Unlink(_ context.Context, _, _ uuid.UUID, target documents.Target, _ uuid.UUID) (documents.ScopeResponse, error) {
	f.unlinks++
	f.linkTarget = target
	return documents.ScopeResponse{}, f.err
}
func (f *routeFiles) DownloadLink(_ context.Context, _, _ uuid.UUID, target documents.Target, _ uuid.UUID) (documents.File, error) {
	f.linkDownloads++
	f.linkTarget = target
	return documents.File{}, f.err
}

func (f *routeFiles) PreflightReplace(context.Context, uuid.UUID, uuid.UUID, documents.Target, uuid.UUID) (int, error) {
	f.replaces++
	return 0, f.err
}
func (f *routeFiles) Replace(context.Context, documents.ReplaceCommand) (documents.UploadResponse, error) {
	return documents.UploadResponse{}, f.err
}
func (f *routeFiles) Delete(context.Context, uuid.UUID, uuid.UUID, documents.Target, uuid.UUID) (documents.ScopeResponse, error) {
	f.deletes++
	return documents.ScopeResponse{}, f.err
}
func (f *routeFiles) DownloadVersion(context.Context, uuid.UUID, uuid.UUID, documents.Target, uuid.UUID, int) (documents.File, error) {
	f.versionDownloads++
	return documents.File{}, f.err
}

func (f *routeFiles) PreflightUpload(context.Context, uuid.UUID, uuid.UUID, documents.Target) error {
	f.preflight++
	return f.err
}
func (f *routeFiles) Stage(context.Context, string, io.Reader) (documents.Staged, error) {
	return documents.Staged{}, f.err
}
func (f *routeFiles) Upload(context.Context, documents.UploadCommand) (documents.UploadResult, error) {
	return documents.UploadResult{}, f.err
}
func (f *routeFiles) Discard(context.Context, string) {}
func (f *routeFiles) Download(context.Context, uuid.UUID, uuid.UUID, documents.Target, uuid.UUID) (documents.File, error) {
	f.downloads++
	return documents.File{}, f.err
}

type routeDocumentsReader struct {
	list                documents.List
	err                 error
	company, actor, doc uuid.UUID
	// target is the scope the route asked for (P6).
	target documents.Target
	calls  int
}

func (f *routeDocumentsReader) Sources(_ context.Context, company, actor uuid.UUID, target documents.Target) (documents.Sources, error) {
	f.calls++
	f.company, f.actor, f.doc, f.target = company, actor, target.DraftID, target
	return documents.Sources{}, f.err
}

func (f *routeDocumentsReader) Versions(_ context.Context, company, actor uuid.UUID, target documents.Target, _ uuid.UUID) (documents.VersionList, error) {
	f.calls++
	f.company, f.actor, f.doc, f.target = company, actor, target.DraftID, target
	return documents.VersionList{}, f.err
}

func (f *routeDocumentsReader) List(_ context.Context, company, actor uuid.UUID, target documents.Target) (documents.List, error) {
	f.calls++
	f.company, f.actor, f.doc, f.target = company, actor, target.DraftID, target
	return f.list, f.err
}

// routeDocumentReaderGate stands in for identityhttp.RequireDocumentReader: owner, recruiter and stakeholder pass.
func routeDocumentReaderGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := companiesvalueobjects.MemberRole(0)
		switch r.Header.Get("X-Test-Role") {
		case "owner":
			role = companiesvalueobjects.OwnerRole
		case "recruiter":
			role = companiesvalueobjects.RecruiterRole
		case "stakeholder":
			role = companiesvalueobjects.StakeholderRole
		default:
			routeRoleGate(companiesvalueobjects.OwnerRole, "never")(next).ServeHTTP(w, r) // the same 403 envelope
			return
		}
		cc := identitysecurity.CompanyContext{CompanyID: routeTestCompanyID, UserID: routeTestActorID, Role: role}
		next.ServeHTTP(w, r.WithContext(identitysecurity.ContextWithCompanyContext(r.Context(), cc)))
	})
}

func documentsRouteRouter(reader documents.Reader, withGate bool) http.Handler {
	return documentsRouteRouterWithFiles(reader, nil, withGate, "never")
}

// documentsRouteRouterWithFiles also wires the file service and lets the recruiter gate admit the role named by
// recruiterHeader ("never" refuses everyone: the documents GET must not sit behind it, or a stakeholder could never read).
func documentsRouteRouterWithFiles(reader documents.Reader, files documents.Files, withGate bool, recruiterHeader string) http.Handler {
	deps := routerDeps{
		requireAuth:      routeRequireAuth,
		requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, recruiterHeader),
		requireOwner:     routeRoleGate(companiesvalueobjects.OwnerRole, "never"),
		documentHandler:  documentshttp.NewHandler(reader, files),
	}
	if withGate {
		deps.requireDocumentReader = routeDocumentReaderGate
	}
	return newRouter(deps)
}

var documentsListPath = "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/documents"

func TestDocumentsListRouteAdmitsEveryReadRoleBehindTheReaderGate(t *testing.T) {
	reader := &routeDocumentsReader{list: documents.List{Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy})}}
	router := documentsRouteRouter(reader, true)
	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		reader.calls = 0
		rec := doRouteRequest(t, router, "GET", documentsListPath, "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": role})
		if rec.Code != 200 || reader.calls != 1 {
			t.Fatalf("%s: %d %s calls=%d", role, rec.Code, rec.Body, reader.calls)
		}
		assertDraftRouteNoStore(t, rec)
		if reader.company != routeTestCompanyID || reader.actor != routeTestActorID || reader.doc != routeTestDraftID {
			t.Fatalf("%s: the store got %+v", role, reader)
		}
		if !strings.Contains(rec.Body.String(), `"items":[]`) || !strings.Contains(rec.Body.String(), `"links":[]`) {
			t.Fatalf("%s: empty shape %s", role, rec.Body)
		}
	}
}

// NoStore wraps the gate rejections too, and a gate that refuses never reaches the store.
func TestDocumentsListRouteRejectionsAreNoStoreAndNeverReachTheStore(t *testing.T) {
	reader := &routeDocumentsReader{}
	router := documentsRouteRouter(reader, true)
	for name, tc := range map[string]struct {
		headers map[string]string
		status  int
		code    string
	}{
		"anonymous":            {nil, 401, "unauthenticated"},
		"a role outside three": {map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "candidate"}, 403, "forbidden"},
	} {
		rec := doRouteRequest(t, router, "GET", documentsListPath, "", tc.headers)
		if rec.Code != tc.status || routeCatalogCode(t, rec) != tc.code {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
		assertDraftRouteNoStore(t, rec)
	}
	if reader.calls != 0 {
		t.Fatalf("the store was reached %d times", reader.calls)
	}
}

// A router assembled without the reader gate never serves documents: it refuses everyone.
func TestDocumentsListRouteFailsClosedWithoutTheReaderGate(t *testing.T) {
	reader := &routeDocumentsReader{}
	router := documentsRouteRouter(reader, false)
	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		rec := doRouteRequest(t, router, "GET", documentsListPath, "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": role})
		if rec.Code != 403 || routeCatalogCode(t, rec) != "forbidden" || reader.calls != 0 {
			t.Fatalf("%s: %d %s calls=%d", role, rec.Code, rec.Body, reader.calls)
		}
		assertDraftRouteNoStore(t, rec)
	}
}

// D5: candidate-pool routes serve no documents; only the vacancy route exists in P3.
func TestDocumentsRoutesDoNotExistUnderTheCandidatePool(t *testing.T) {
	reader := &routeDocumentsReader{}
	router := documentsRouteRouter(reader, true)
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "owner"}
	id, pid := uuid.NewString(), uuid.NewString()
	for _, path := range []string{
		"/v2/me/company/candidates/organic/" + id + "/documents",
		"/v2/me/company/candidates/organic/" + id + "/participations/" + pid + "/documents",
		"/v2/me/company/candidates/documents",
		"/v2/me/company/documents",
	} {
		rec := doRouteRequest(t, router, "GET", path, "", headers)
		if rec.Code != 404 && rec.Code != 403 {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body)
		}
	}
	if reader.calls != 0 {
		t.Fatalf("a pool route reached the documents store %d times", reader.calls)
	}
}

var (
	documentsUploadPath = documentsListPath
	documentsFilePath   = documentsListPath + "/" + uuid.NewString() + "/file"
)

// The upload sits in the recruiter group (a stakeholder never reaches the service and gets the generic 403); the file
// download sits in the read group (a stakeholder downloads). Both are NoStore, including the gate rejections.
func TestDocumentsUploadAndFileRoutesSitBehindTheirGates(t *testing.T) {
	files := &routeFiles{err: documents.ErrScopeNotFound}
	router := documentsRouteRouterWithFiles(&routeDocumentsReader{}, files, true, "recruiter")
	asRole := func(role string) map[string]string {
		return map[string]string{"X-Test-Sub": "sub", "X-Test-Role": role}
	}

	rec := doRouteRequest(t, router, "POST", documentsUploadPath, "", asRole("stakeholder"))
	if rec.Code != 403 || routeCatalogCode(t, rec) != "forbidden" || files.preflight != 0 {
		t.Fatalf("stakeholder upload: %d %s preflight=%d", rec.Code, rec.Body, files.preflight)
	}
	assertDraftRouteNoStore(t, rec)
	rec = doRouteRequest(t, router, "POST", documentsUploadPath, "", nil)
	if rec.Code != 401 || routeCatalogCode(t, rec) != "unauthenticated" {
		t.Fatalf("anonymous upload: %d %s", rec.Code, rec.Body)
	}
	// An admitted role reaches the service, which answers its own error.
	rec = doRouteRequest(t, router, "POST", documentsUploadPath, "", asRole("recruiter"))
	if rec.Code != 404 || files.preflight != 1 {
		t.Fatalf("recruiter upload: %d %s preflight=%d", rec.Code, rec.Body, files.preflight)
	}
	assertDraftRouteNoStore(t, rec)

	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		before := files.downloads
		rec := doRouteRequest(t, router, "GET", documentsFilePath, "", asRole(role))
		if rec.Code != 404 || files.downloads != before+1 {
			t.Fatalf("%s download: %d %s", role, rec.Code, rec.Body)
		}
		assertDraftRouteNoStore(t, rec)
	}
	rec = doRouteRequest(t, router, "GET", documentsFilePath, "", asRole("candidate"))
	if rec.Code != 403 || files.downloads != 3 {
		t.Fatalf("a role outside the three: %d %s", rec.Code, rec.Body)
	}
	assertDraftRouteNoStore(t, rec)
}

// Without the reader gate the download is refused to everyone, like the list.
func TestDocumentsFileRouteFailsClosedWithoutTheReaderGate(t *testing.T) {
	files := &routeFiles{}
	router := documentsRouteRouterWithFiles(&routeDocumentsReader{}, files, false, "recruiter")
	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		rec := doRouteRequest(t, router, "GET", documentsFilePath, "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": role})
		if rec.Code != 403 || files.downloads != 0 {
			t.Fatalf("%s: %d %s", role, rec.Code, rec.Body)
		}
	}
}

var (
	documentsVersionsPath    = documentsListPath + "/" + uuid.NewString() + "/versions"
	documentsVersionFilePath = documentsVersionsPath + "/2/file"
	documentsDeletePath      = documentsListPath + "/" + uuid.NewString()
	documentsRouteAsRole     = func(role string) map[string]string {
		return map[string]string{"X-Test-Sub": "sub", "X-Test-Role": role}
	}
	documentsRouteStakeholder = documentsRouteAsRole("stakeholder")
)

// P5: replace and delete sit in the recruiter group (a stakeholder never reaches the service: the ladder's 403); the version
// list and the download by version sit in the read group (a stakeholder reads and downloads). All NoStore.
func TestDocumentsVersionRoutesSitBehindTheirGates(t *testing.T) {
	files := &routeFiles{err: documents.ErrScopeNotFound}
	reader := &routeDocumentsReader{err: documents.ErrScopeNotFound}
	router := documentsRouteRouterWithFiles(reader, files, true, "recruiter")

	for _, tc := range []struct {
		method, path string
		calls        func() int
	}{
		{"POST", documentsVersionsPath, func() int { return files.replaces }},
		{"DELETE", documentsDeletePath, func() int { return files.deletes }},
	} {
		rec := doRouteRequest(t, router, tc.method, tc.path, "", documentsRouteStakeholder)
		if rec.Code != 403 || routeCatalogCode(t, rec) != "forbidden" || tc.calls() != 0 {
			t.Fatalf("stakeholder %s %s: %d %s calls=%d", tc.method, tc.path, rec.Code, rec.Body, tc.calls())
		}
		assertDraftRouteNoStore(t, rec)
		rec = doRouteRequest(t, router, tc.method, tc.path, "", nil)
		if rec.Code != 401 || routeCatalogCode(t, rec) != "unauthenticated" {
			t.Fatalf("anonymous %s: %d %s", tc.method, rec.Code, rec.Body)
		}
		rec = doRouteRequest(t, router, tc.method, tc.path, "", documentsRouteAsRole("recruiter"))
		if rec.Code != 404 || tc.calls() != 1 {
			t.Fatalf("recruiter %s: %d %s calls=%d", tc.method, rec.Code, rec.Body, tc.calls())
		}
		assertDraftRouteNoStore(t, rec)
	}

	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		before := reader.calls
		rec := doRouteRequest(t, router, "GET", documentsVersionsPath, "", documentsRouteAsRole(role))
		if rec.Code != 404 || reader.calls != before+1 {
			t.Fatalf("%s versions: %d %s", role, rec.Code, rec.Body)
		}
		assertDraftRouteNoStore(t, rec)
		beforeFiles := files.versionDownloads
		rec = doRouteRequest(t, router, "GET", documentsVersionFilePath, "", documentsRouteAsRole(role))
		if rec.Code != 404 || files.versionDownloads != beforeFiles+1 {
			t.Fatalf("%s version download: %d %s", role, rec.Code, rec.Body)
		}
		assertDraftRouteNoStore(t, rec)
	}
	for _, path := range []string{documentsVersionsPath, documentsVersionFilePath} {
		if rec := doRouteRequest(t, router, "GET", path, "", documentsRouteAsRole("candidate")); rec.Code != 403 {
			t.Fatalf("a role outside the three on %s: %d", path, rec.Code)
		}
	}
}

// Without the reader gate the two new GET routes are refused to everyone, like the list and the download.
func TestDocumentsVersionReadRoutesFailClosedWithoutTheReaderGate(t *testing.T) {
	files := &routeFiles{}
	reader := &routeDocumentsReader{}
	router := documentsRouteRouterWithFiles(reader, files, false, "recruiter")
	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		for _, path := range []string{documentsVersionsPath, documentsVersionFilePath} {
			if rec := doRouteRequest(t, router, "GET", path, "", documentsRouteAsRole(role)); rec.Code != 403 {
				t.Fatalf("%s %s: %d", role, path, rec.Code)
			}
		}
	}
	if reader.calls != 0 || files.versionDownloads != 0 {
		t.Fatalf("the store was reached: reader %d downloads %d", reader.calls, files.versionDownloads)
	}
}

// --- P6: participation documents -----------------------------------------------------------------------------------

var documentsParticipationBase = "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/" + uuid.NewString() + "/documents"

// The participation routes sit behind the same gates as the vacancy ones (D4): writes in the recruiter group (a stakeholder
// never reaches the service), reads in the reader group (a stakeholder reads and downloads); all NoStore.
func TestParticipationDocumentRoutesSitBehindTheSameGates(t *testing.T) {
	files := &routeFiles{err: documents.ErrScopeNotFound}
	reader := &routeDocumentsReader{err: documents.ErrScopeNotFound}
	router := documentsRouteRouterWithFiles(reader, files, true, "recruiter")
	doc := uuid.NewString()

	writes := []struct {
		method, path string
		calls        func() int
	}{
		{"POST", documentsParticipationBase, func() int { return files.preflight }},
		{"POST", documentsParticipationBase + "/" + doc + "/versions", func() int { return files.replaces }},
		{"DELETE", documentsParticipationBase + "/" + doc, func() int { return files.deletes }},
	}
	for _, tc := range writes {
		rec := doRouteRequest(t, router, tc.method, tc.path, "", documentsRouteStakeholder)
		if rec.Code != 403 || routeCatalogCode(t, rec) != "forbidden" || tc.calls() != 0 {
			t.Fatalf("stakeholder %s %s: %d %s calls=%d", tc.method, tc.path, rec.Code, rec.Body, tc.calls())
		}
		assertDraftRouteNoStore(t, rec)
		rec = doRouteRequest(t, router, tc.method, tc.path, "", nil)
		if rec.Code != 401 || routeCatalogCode(t, rec) != "unauthenticated" {
			t.Fatalf("anonymous %s %s: %d %s", tc.method, tc.path, rec.Code, rec.Body)
		}
		rec = doRouteRequest(t, router, tc.method, tc.path, "", documentsRouteAsRole("recruiter"))
		if rec.Code != 404 || tc.calls() != 1 {
			t.Fatalf("recruiter %s %s: %d %s calls=%d", tc.method, tc.path, rec.Code, rec.Body, tc.calls())
		}
		assertDraftRouteNoStore(t, rec)
	}

	reads := []string{
		documentsParticipationBase,
		documentsParticipationBase + "/" + doc + "/file",
		documentsParticipationBase + "/" + doc + "/versions",
		documentsParticipationBase + "/" + doc + "/versions/2/file",
	}
	for _, path := range reads {
		for _, role := range []string{"owner", "recruiter", "stakeholder"} {
			rec := doRouteRequest(t, router, "GET", path, "", documentsRouteAsRole(role))
			if rec.Code != 404 {
				t.Fatalf("%s GET %s: %d %s", role, path, rec.Code, rec.Body)
			}
			assertDraftRouteNoStore(t, rec)
		}
		if rec := doRouteRequest(t, router, "GET", path, "", documentsRouteAsRole("candidate")); rec.Code != 403 {
			t.Fatalf("a role outside the three on %s: %d", path, rec.Code)
		}
	}
	// The list route carries the participation target and the same session identity.
	if reader.target.ParticipationID == nil || reader.target.DraftID != routeTestDraftID {
		t.Fatalf("the store got %+v", reader.target)
	}
}

// Without the reader gate the participation reads are refused to everyone, and a malformed pid never reaches a store.
func TestParticipationDocumentReadRoutesFailClosedAndRejectABadPid(t *testing.T) {
	files, reader := &routeFiles{}, &routeDocumentsReader{}
	closed := documentsRouteRouterWithFiles(reader, files, false, "recruiter")
	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		if rec := doRouteRequest(t, closed, "GET", documentsParticipationBase, "", documentsRouteAsRole(role)); rec.Code != 403 {
			t.Fatalf("%s: %d", role, rec.Code)
		}
	}
	open := documentsRouteRouterWithFiles(reader, files, true, "recruiter")
	bad := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/nope/documents"
	for _, tc := range [][2]string{{"GET", bad}, {"POST", bad}, {"DELETE", bad + "/" + uuid.NewString()}} {
		rec := doRouteRequest(t, open, tc[0], tc[1], "", documentsRouteAsRole("recruiter"))
		if rec.Code != 400 || routeCatalogCode(t, rec) != "invalid_request" {
			t.Fatalf("%s %s: %d %s", tc[0], tc[1], rec.Code, rec.Body)
		}
	}
	if reader.calls != 0 || files.preflight != 0 || files.deletes != 0 {
		t.Fatalf("a store was reached: reader %d preflight %d deletes %d", reader.calls, files.preflight, files.deletes)
	}
}

// D5: no route under /v2/me/company/candidates serves a document, whatever its verb: pool access grants nothing because
// there is nothing to grant. Walks the whole route table of the production router.
func TestNoDocumentRouteIsRegisteredUnderTheCandidatePool(t *testing.T) {
	router, ok := documentsRouteRouter(&routeDocumentsReader{}, true).(chi.Routes)
	if !ok {
		t.Fatal("the production router is not a chi router")
	}
	documentRoutes := 0
	err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.Contains(route, "/document") {
			documentRoutes++
			if strings.HasPrefix(route, "/v2/me/company/candidates") {
				t.Errorf("%s %s serves documents under the candidate pool", method, route)
			}
			if !strings.HasPrefix(route, "/v2/me/company/job-drafts/{id}/document") && !strings.HasPrefix(route, "/v2/me/company/job-drafts/{id}/participations/{pid}/document") {
				t.Errorf("%s %s is a document route outside the two scopes", method, route)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// Per scope: list, file, versions, version file (reads) and upload, replace, delete (writes) = 7, plus the replacement links of
	// P7 (sources, link file, link, unlink) = 4; two scopes.
	if documentRoutes != 22 {
		t.Fatalf("document routes registered: %d, want 22", documentRoutes)
	}
}

// --- P7: replacement links ------------------------------------------------------------------------------------------------

var (
	documentsLinkBase  = "/v2/me/company/job-drafts/" + routeTestDraftID.String()
	documentsLinkParts = documentsLinkBase + "/participations/" + uuid.NewString()
)

// Linking and unlinking sit in the recruiter group (a stakeholder never reaches the service: the ladder's 403); the sources list and
// the download through a link sit in the read group (a stakeholder reads and downloads). Both scopes, all NoStore.
func TestLinkRoutesSitBehindTheirGates(t *testing.T) {
	files := &routeFiles{err: documents.ErrScopeNotFound}
	reader := &routeDocumentsReader{err: documents.ErrScopeNotFound}
	router := documentsRouteRouterWithFiles(reader, files, true, "recruiter")
	link := uuid.NewString()

	for _, base := range []string{documentsLinkBase, documentsLinkParts} {
		writes := []struct {
			method, path string
			calls        func() int
		}{
			{"POST", base + "/document-links", func() int { return files.links }},
			{"DELETE", base + "/document-links/" + link, func() int { return files.unlinks }},
		}
		for _, tc := range writes {
			before := tc.calls()
			rec := doRouteRequest(t, router, tc.method, tc.path, `{"source_document_id":"`+uuid.NewString()+`"}`, documentsRouteStakeholder)
			if rec.Code != 403 || routeCatalogCode(t, rec) != "forbidden" || tc.calls() != before {
				t.Fatalf("stakeholder %s %s: %d %s calls=%d", tc.method, tc.path, rec.Code, rec.Body, tc.calls())
			}
			assertDraftRouteNoStore(t, rec)
			rec = doRouteRequest(t, router, tc.method, tc.path, "", nil)
			if rec.Code != 401 || routeCatalogCode(t, rec) != "unauthenticated" {
				t.Fatalf("anonymous %s %s: %d %s", tc.method, tc.path, rec.Code, rec.Body)
			}
			rec = doRouteRequest(t, router, tc.method, tc.path, `{"source_document_id":"`+uuid.NewString()+`"}`, documentsRouteAsRole("recruiter"))
			if rec.Code != 404 || tc.calls() != before+1 {
				t.Fatalf("recruiter %s %s: %d %s calls=%d", tc.method, tc.path, rec.Code, rec.Body, tc.calls())
			}
			assertDraftRouteNoStore(t, rec)
		}
		for _, path := range []string{base + "/document-sources", base + "/document-links/" + link + "/file"} {
			for _, role := range []string{"owner", "recruiter", "stakeholder"} {
				rec := doRouteRequest(t, router, "GET", path, "", documentsRouteAsRole(role))
				if rec.Code != 404 {
					t.Fatalf("%s GET %s: %d %s", role, path, rec.Code, rec.Body)
				}
				assertDraftRouteNoStore(t, rec)
			}
			if rec := doRouteRequest(t, router, "GET", path, "", documentsRouteAsRole("candidate")); rec.Code != 403 {
				t.Fatalf("a role outside the three on %s: %d", path, rec.Code)
			}
		}
	}
	// The participation prefix is what makes the scope a participation.
	if files.linkTarget.ParticipationID == nil || reader.target.ParticipationID == nil {
		t.Fatalf("participation targets: files %+v reader %+v", files.linkTarget, reader.target)
	}
}

// Without the reader gate the two link reads are refused to everyone; a stakeholder never reaches a link write.
func TestLinkReadRoutesFailClosedWithoutTheReaderGate(t *testing.T) {
	files, reader := &routeFiles{}, &routeDocumentsReader{}
	router := documentsRouteRouterWithFiles(reader, files, false, "recruiter")
	for _, role := range []string{"owner", "recruiter", "stakeholder"} {
		for _, path := range []string{documentsLinkBase + "/document-sources", documentsLinkBase + "/document-links/" + uuid.NewString() + "/file", documentsLinkParts + "/document-sources"} {
			if rec := doRouteRequest(t, router, "GET", path, "", documentsRouteAsRole(role)); rec.Code != 403 {
				t.Fatalf("%s %s: %d", role, path, rec.Code)
			}
		}
	}
	if reader.calls != 0 || files.linkDownloads != 0 {
		t.Fatalf("a store was reached: reader %d downloads %d", reader.calls, files.linkDownloads)
	}
}
