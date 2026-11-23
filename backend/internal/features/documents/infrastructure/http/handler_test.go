package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type fakeReader struct {
	list              documents.List
	err               error
	company, actor, v uuid.UUID
	calls             int
}

func (f *fakeReader) List(_ context.Context, company, actor, draft uuid.UUID) (documents.List, error) {
	f.calls++
	f.company, f.actor, f.v = company, actor, draft
	return f.list, f.err
}

// serve runs GET /v/{id}/documents through a chi router, optionally with a company context.
func serve(t *testing.T, h *Handler, id string, cc *identitysecurity.CompanyContext) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Get("/v/{id}/documents", h.List)
	req := httptest.NewRequest(http.MethodGet, "/v/"+id+"/documents", nil)
	if cc != nil {
		req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *cc))
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return out
}

func TestListPassesTheSessionIdentityAndWritesTheList(t *testing.T) {
	company, actor, draft := uuid.New(), uuid.New(), uuid.New()
	reader := &fakeReader{list: documents.List{
		Items: []documents.Item{{ID: "d1", Name: "Contrato", Format: documents.PDF, AllowedActions: []documents.Action{documents.ActionDownload}}},
		Links: []documents.Link{},
		Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true, Documents: 1}),
	}}
	rec := serve(t, NewHandler(reader), draft.String(), &identitysecurity.CompanyContext{CompanyID: company, UserID: actor})
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %s %s", rec.Code, rec.Header().Get("Content-Type"), rec.Body)
	}
	if reader.company != company || reader.actor != actor || reader.v != draft || reader.calls != 1 {
		t.Fatalf("store called with %+v", reader)
	}
	body := decode(t, rec)
	items := body["items"].([]any)
	first := items[0].(map[string]any)
	// participation_id is always present, null for the vacancy scope (never omitted).
	if v, ok := first["participation_id"]; !ok || v != nil {
		t.Fatalf("participation_id = %v, present=%v", v, ok)
	}
	if len(body) != 3 || body["links"] == nil || body["scope"] == nil {
		t.Fatalf("keys: %s", rec.Body)
	}
}

// An empty scope answers `[]` for both arrays, never null: the frontend decodes arrays.
func TestListEmptyShape(t *testing.T) {
	reader := &fakeReader{list: documents.List{Scope: documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true})}}
	rec := serve(t, NewHandler(reader), uuid.NewString(), &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()})
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body)
	}
	for _, fragment := range []string{`"items":[]`, `"links":[]`, `"upload_blocked_reason":null`, `"allowed_actions":["upload"]`} {
		if !strings.Contains(rec.Body.String(), fragment) {
			t.Errorf("missing %s in %s", fragment, rec.Body)
		}
	}
}

func TestListErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"not visible", documents.ErrScopeNotFound, 404, "not_found"},
		{"wrapped not visible", errors.Join(errors.New("ctx"), documents.ErrScopeNotFound), 404, "not_found"},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended"},
		{"role", documents.ErrForbidden, 403, "forbidden"},
		{"user gone", documents.ErrUnauthenticated, 401, "unauthenticated"},
		{"company gone", documents.ErrCompanyInactive, 403, "company_inactive"},
		{"company not active", documents.ErrCompanyNotActive, 409, "company_not_active"},
		{"anything else", errors.New("pq: password authentication failed for user x"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := serve(t, NewHandler(&fakeReader{err: tc.err}), uuid.NewString(), &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()})
			body := decode(t, rec)
			if rec.Code != tc.status || body["code"] != tc.code {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
			// Only the catalog envelope: never a driver or domain error string.
			if len(body) != 2 || strings.Contains(rec.Body.String(), "password") {
				t.Fatalf("envelope leaks: %s", rec.Body)
			}
		})
	}
}

func TestListRejectsBadInputBeforeTheStore(t *testing.T) {
	reader := &fakeReader{}
	good := &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
	if rec := serve(t, NewHandler(reader), "not-a-uuid", good); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" {
		t.Fatalf("bad id: %d %s", rec.Code, rec.Body)
	}
	// A router without the role gate in front never serves: fail closed with the generic 500.
	if rec := serve(t, NewHandler(reader), uuid.NewString(), nil); rec.Code != 500 || decode(t, rec)["code"] != "internal_error" {
		t.Fatalf("no company context: %d %s", rec.Code, rec.Body)
	}
	if reader.calls != 0 {
		t.Fatalf("store reached %d times", reader.calls)
	}
	// A router built without the documents store answers the generic 500, never a nil dereference.
	for _, h := range []*Handler{nil, NewHandler(nil)} {
		if rec := serve(t, h, uuid.NewString(), good); rec.Code != 500 || decode(t, rec)["code"] != "internal_error" {
			t.Fatalf("nil store: %d %s", rec.Code, rec.Body)
		}
	}
}
