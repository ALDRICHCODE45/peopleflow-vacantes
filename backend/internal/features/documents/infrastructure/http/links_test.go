package http

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// P7: GET P/document-sources, POST P/document-links, DELETE P/document-links/{link}, GET P/document-links/{link}/file
// (placement-vacancy-documents-v1, S3, D16-D19, D22). The same handlers serve both scopes.

func (f *fakeReader) Sources(_ context.Context, company, actor uuid.UUID, target documents.Target) (documents.Sources, error) {
	f.calls++
	f.company, f.actor, f.v, f.target = company, actor, target.DraftID, target
	return f.sources, f.sourcesErr
}

func (f *fakeFiles) Link(_ context.Context, cmd documents.LinkCommand) (documents.LinkResponse, error) {
	f.calls = append(f.calls, "link")
	f.linkCmd, f.target = cmd, cmd.Target
	return f.linkResp, f.linkErr
}

func (f *fakeFiles) Unlink(_ context.Context, company, actor uuid.UUID, target documents.Target, link uuid.UUID) (documents.ScopeResponse, error) {
	f.calls = append(f.calls, "unlink")
	f.company, f.actor, f.target = company, actor, target
	f.linkedIDs = []uuid.UUID{target.DraftID, link}
	return f.unlinkResp, f.linkErr
}

func (f *fakeFiles) DownloadLink(_ context.Context, company, actor uuid.UUID, target documents.Target, link uuid.UUID) (documents.File, error) {
	f.calls = append(f.calls, "download-link")
	f.company, f.actor, f.target = company, actor, target
	f.linkedIDs = []uuid.UUID{target.DraftID, link}
	return f.file, f.linkErr
}

// linksRouter mounts the four routes under both prefixes, as cmd/api's route table does.
func linksRouter(h *Handler) chi.Router {
	router := chi.NewRouter()
	for _, p := range []string{"/v/{id}", "/v/{id}/participations/{pid}"} {
		router.Get(p+"/document-sources", h.Sources)
		router.Post(p+"/document-links", h.Link)
		router.Delete(p+"/document-links/{link}", h.Unlink)
		router.Get(p+"/document-links/{link}/file", h.FileLink)
	}
	return router
}

func doJSON(t *testing.T, router chi.Router, method, path, body string, cc *identitysecurity.CompanyContext) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if cc != nil {
		req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *cc))
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestSourcesPassesTheIdentityAndTheTargetOfBothScopes(t *testing.T) {
	company, actor, draft, pid := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	cc := &identitysecurity.CompanyContext{CompanyID: company, UserID: actor}
	reader := &fakeReader{sources: documents.Sources{CanLink: true, Sources: []documents.SourceGroup{{ProcessID: "p", Documents: []documents.SourceDocument{}}}}}
	router := linksRouter(NewHandler(reader, &fakeFiles{}))

	rec := doJSON(t, router, http.MethodGet, "/v/"+draft.String()+"/document-sources", "", cc)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" || !sameTarget(reader.target, documents.VacancyTarget(draft)) ||
		reader.company != company || reader.actor != actor {
		t.Fatalf("vacancy: %d %s %+v", rec.Code, rec.Body, reader)
	}
	if body := decode(t, rec); body["can_link"] != true || len(body["sources"].([]any)) != 1 {
		t.Fatalf("body %s", rec.Body)
	}
	rec = doJSON(t, router, http.MethodGet, "/v/"+draft.String()+"/participations/"+pid.String()+"/document-sources", "", cc)
	if rec.Code != 200 || !sameTarget(reader.target, documents.ParticipationTarget(draft, pid)) {
		t.Fatalf("participation: %d %s %+v", rec.Code, rec.Body, reader.target)
	}
}

// `sources` is `[]`, never null, even when the store hands back nothing.
func TestSourcesEmptyShape(t *testing.T) {
	router := linksRouter(NewHandler(&fakeReader{}, &fakeFiles{}))
	rec := doJSON(t, router, http.MethodGet, "/v/"+uuid.NewString()+"/document-sources", "", sessionCtx)
	if rec.Code != 200 || strings.TrimSpace(rec.Body.String()) != `{"can_link":false,"sources":[]}` {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

func TestLinkRoutesRejectBadInputBeforeTheStore(t *testing.T) {
	reader, files := &fakeReader{}, &fakeFiles{}
	router := linksRouter(NewHandler(reader, files))
	draft, doc := uuid.NewString(), uuid.NewString()
	for name, tc := range map[string]struct{ method, path, body string }{
		"sources, bad id":  {"GET", "/v/nope/document-sources", ""},
		"sources, bad pid": {"GET", "/v/" + draft + "/participations/nope/document-sources", ""},
		"link, bad id":     {"POST", "/v/nope/document-links", `{"source_document_id":"` + doc + `"}`},
		"link, bad pid":    {"POST", "/v/" + draft + "/participations/nope/document-links", `{"source_document_id":"` + doc + `"}`},
		"unlink, bad link": {"DELETE", "/v/" + draft + "/document-links/nope", ""},
		"unlink, bad id":   {"DELETE", "/v/nope/document-links/" + doc, ""},
		"unlink, bad pid":  {"DELETE", "/v/" + draft + "/participations/nope/document-links/" + doc, ""},
		"file, bad link":   {"GET", "/v/" + draft + "/document-links/nope/file", ""},
		"file, bad id":     {"GET", "/v/nope/document-links/" + doc + "/file", ""},
		"file, bad pid":    {"GET", "/v/" + draft + "/participations/nope/document-links/" + doc + "/file", ""},
	} {
		rec := doJSON(t, router, tc.method, tc.path, tc.body, sessionCtx)
		if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	// No session: the generic 500, never the store.
	for _, tc := range [][2]string{{"GET", "/v/" + draft + "/document-sources"}, {"POST", "/v/" + draft + "/document-links"}, {"DELETE", "/v/" + draft + "/document-links/" + doc}, {"GET", "/v/" + draft + "/document-links/" + doc + "/file"}} {
		if rec := doJSON(t, router, tc[0], tc[1], `{"source_document_id":"`+doc+`"}`, nil); rec.Code != 500 || decode(t, rec)["code"] != "internal_error" {
			t.Fatalf("%v without a session: %d %s", tc, rec.Code, rec.Body)
		}
	}
	// A router built without the stores answers the generic 500 instead of dereferencing nil.
	for _, h := range []*Handler{nil, NewHandler(nil, nil)} {
		r := linksRouter(h)
		for _, tc := range [][2]string{{"GET", "/v/" + draft + "/document-sources"}, {"POST", "/v/" + draft + "/document-links"}, {"DELETE", "/v/" + draft + "/document-links/" + doc}, {"GET", "/v/" + draft + "/document-links/" + doc + "/file"}} {
			if rec := doJSON(t, r, tc[0], tc[1], `{"source_document_id":"`+doc+`"}`, sessionCtx); rec.Code != 500 || decode(t, rec)["code"] != "internal_error" {
				t.Fatalf("nil stores %v: %d %s", tc, rec.Code, rec.Body)
			}
		}
	}
	if reader.calls != 0 || len(files.calls) != 0 {
		t.Fatalf("a store was reached: reader %d files %v", reader.calls, files.calls)
	}
}

func TestLinkParsesTheBodyIntoACommand(t *testing.T) {
	company, actor, draft, pid, doc := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	cc := &identitysecurity.CompanyContext{CompanyID: company, UserID: actor}
	scope := documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, CanReceiveLinks: true, Links: 1})
	files := &fakeFiles{linkResp: documents.LinkResponse{Link: documents.Link{ID: "l1", State: documents.LinkAvailable, AllowedActions: []documents.Action{documents.ActionDownload, documents.ActionUnlink}}, Scope: scope}}
	router := linksRouter(NewHandler(&fakeReader{}, files))

	rec := doJSON(t, router, http.MethodPost, "/v/"+draft.String()+"/document-links", `{"source_document_id":"`+doc.String()+`","version":3}`, cc)
	body := decode(t, rec)
	if rec.Code != 201 || rec.Header().Get("Content-Type") != "application/json" || len(body) != 2 || body["link"] == nil || body["scope"] == nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	cmd := files.linkCmd
	if cmd.CompanyID != company || cmd.ActorID != actor || cmd.SourceDocumentID != doc || cmd.Version == nil || *cmd.Version != 3 || !sameTarget(cmd.Target, documents.VacancyTarget(draft)) {
		t.Fatalf("cmd %+v", cmd)
	}

	// No version: the store pins the current one. Whitespace around the JSON is fine; the participation prefix makes the target.
	rec = doJSON(t, router, http.MethodPost, "/v/"+draft.String()+"/participations/"+pid.String()+"/document-links", " \n{ \"source_document_id\" : \""+strings.ToUpper(doc.String())+"\" }\n", cc)
	if rec.Code != 201 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	cmd = files.linkCmd
	if cmd.Version != nil || cmd.SourceDocumentID != doc || !sameTarget(cmd.Target, documents.ParticipationTarget(draft, pid)) {
		t.Fatalf("cmd %+v", cmd)
	}
}

func TestLinkRejectsAMalformedBodyBeforeTheStore(t *testing.T) {
	doc := uuid.NewString()
	files := &fakeFiles{}
	router := linksRouter(NewHandler(&fakeReader{}, files))
	for name, body := range map[string]string{
		"empty":              "",
		"not json":           "source_document_id=" + doc,
		"an array":           "[]",
		"null":               "null",
		"no source":          `{}`,
		"not a uuid":         `{"source_document_id":"contrato"}`,
		"a number":           `{"source_document_id":7}`,
		"nil uuid":           `{"source_document_id":"00000000-0000-0000-0000-000000000000"}`,
		"unknown key":        `{"source_document_id":"` + doc + `","copy":true}`,
		"version zero":       `{"source_document_id":"` + doc + `","version":0}`,
		"negative version":   `{"source_document_id":"` + doc + `","version":-1}`,
		"string version":     `{"source_document_id":"` + doc + `","version":"1"}`,
		"decimal version":    `{"source_document_id":"` + doc + `","version":1.5}`,
		"exponent version":   `{"source_document_id":"` + doc + `","version":1e0}`,
		"null version":       `{"source_document_id":"` + doc + `","version":null}`,
		"huge version":       `{"source_document_id":"` + doc + `","version":99999999999999999999}`,
		"two documents":      `{"source_document_id":"` + doc + `"}{"source_document_id":"` + doc + `"}`,
		"trailing garbage":   `{"source_document_id":"` + doc + `"} x`,
		"over the body size": `{"source_document_id":"` + doc + `","x":"` + strings.Repeat("a", 8192) + `"}`,
	} {
		rec := doJSON(t, router, http.MethodPost, "/v/"+uuid.NewString()+"/document-links", body, sessionCtx)
		if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
	if len(files.calls) != 0 {
		t.Fatalf("the store was reached: %v", files.calls)
	}
}

func TestLinkErrorMapping(t *testing.T) {
	existing := uuid.New()
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
		data   string
	}{
		{"already linked", &documents.AlreadyLinkedError{LinkID: existing}, 409, "document_already_linked", `{"link_id":"` + existing.String() + `"}`},
		{"not a replacement", &documents.LinkInvalidError{Reason: documents.LinkNotReplacement}, 422, "document_link_invalid", `{"reason":"not_replacement"}`},
		{"not in the chain", &documents.LinkInvalidError{Reason: documents.LinkSourceNotInChain}, 422, "document_link_invalid", `{"reason":"source_not_in_chain"}`},
		{"no such version", &documents.LinkInvalidError{Reason: documents.LinkVersionNotFound}, 422, "document_link_invalid", `{"reason":"version_not_found"}`},
		{"limit", &documents.LimitReachedError{Kind: "documents", Limit: 50}, 409, "document_limit_reached", `{"kind":"documents","limit":50}`},
		{"source not visible", documents.ErrScopeNotFound, 404, "not_found", ""},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended", ""},
		{"a role that may not write", documents.ErrForbidden, 403, "forbidden", ""},
		{"anything else", io.ErrUnexpectedEOF, 500, "internal_error", ""},
	} {
		files := &fakeFiles{linkErr: tc.err}
		rec := doJSON(t, linksRouter(NewHandler(&fakeReader{}, files)), http.MethodPost, "/v/"+uuid.NewString()+"/document-links", `{"source_document_id":"`+uuid.NewString()+`"}`, sessionCtx)
		body := decode(t, rec)
		if rec.Code != tc.status || body["code"] != tc.code {
			t.Fatalf("%s: %d %s", tc.name, rec.Code, rec.Body)
		}
		if tc.data != "" && !strings.Contains(rec.Body.String(), `"data":`+tc.data) {
			t.Fatalf("%s: data %s", tc.name, rec.Body)
		}
		if tc.data == "" && body["data"] != nil {
			t.Fatalf("%s: unexpected data %s", tc.name, rec.Body)
		}
	}
}

func TestUnlinkAnswersTheScopeOnly(t *testing.T) {
	company, actor, draft, pid, link := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	cc := &identitysecurity.CompanyContext{CompanyID: company, UserID: actor}
	files := &fakeFiles{unlinkResp: documents.ScopeResponse{Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeParticipation, CanManage: true, CanReceiveLinks: true})}}
	router := linksRouter(NewHandler(&fakeReader{}, files))

	rec := doJSON(t, router, http.MethodDelete, "/v/"+draft.String()+"/participations/"+pid.String()+"/document-links/"+link.String(), "", cc)
	body := decode(t, rec)
	if rec.Code != 200 || len(body) != 1 || body["scope"] == nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if files.company != company || files.actor != actor || !sameTarget(files.target, documents.ParticipationTarget(draft, pid)) || files.linkedIDs[1] != link {
		t.Fatalf("store got %+v", files)
	}
	for name, err := range map[string]error{"gone": documents.ErrScopeNotFound, "forbidden": documents.ErrForbidden} {
		files.linkErr = err
		rec := doJSON(t, router, http.MethodDelete, "/v/"+draft.String()+"/document-links/"+link.String(), "", sessionCtx)
		want := map[string]int{"gone": 404, "forbidden": 403}[name]
		if rec.Code != want {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
}

func TestFileLinkStreamsAnAttachment(t *testing.T) {
	company, actor, draft, link := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	cc := &identitysecurity.CompanyContext{CompanyID: company, UserID: actor}
	files := &fakeFiles{file: documents.File{Name: "Contrato original.pdf", ContentType: "application/pdf", Size: 5, Reader: io.NopCloser(strings.NewReader("hello"))}}
	router := linksRouter(NewHandler(&fakeReader{}, files))

	rec := doJSON(t, router, http.MethodGet, "/v/"+draft.String()+"/document-links/"+link.String()+"/file", "", cc)
	if rec.Code != 200 || rec.Body.String() != "hello" || rec.Header().Get("Content-Type") != "application/pdf" ||
		rec.Header().Get("Content-Disposition") != `attachment; filename="Contrato original.pdf"` || rec.Header().Get("X-Content-Type-Options") != "nosniff" ||
		rec.Header().Get("Content-Length") != "5" {
		t.Fatalf("%d %q %v", rec.Code, rec.Body, rec.Header())
	}
	if files.company != company || files.actor != actor || files.linkedIDs[0] != draft || files.linkedIDs[1] != link || !sameTarget(files.target, documents.VacancyTarget(draft)) {
		t.Fatalf("store got %+v", files)
	}
	// A failure never opens a stream; the error is the catalog's.
	for err, want := range map[error]int{documents.ErrScopeNotFound: 404, documents.ErrStorageUnavailable: 503, documents.ErrNotFound: 404, documents.ErrTeamAccessEnded: 404} {
		files.linkErr = err
		rec := doJSON(t, router, http.MethodGet, "/v/"+draft.String()+"/document-links/"+link.String()+"/file", "", cc)
		if rec.Code != want || rec.Header().Get("Content-Disposition") != "" {
			t.Fatalf("%v: %d %s", err, rec.Code, rec.Body)
		}
	}
}
