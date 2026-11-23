package http

import (
	"context"
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

// GET V/document-overview (placement-vacancy-documents-v1, L20).

type overviewCall struct {
	company, actor, draft uuid.UUID
	participation         *uuid.UUID
}

type fakeOverviewReader struct {
	fakeReader
	overview documents.Overview
	err      error
	calls    []overviewCall
}

func (f *fakeOverviewReader) Overview(_ context.Context, company, actor, draft uuid.UUID, participation *uuid.UUID) (documents.Overview, error) {
	f.calls = append(f.calls, overviewCall{company, actor, draft, participation})
	return f.overview, f.err
}

func serveOverview(t *testing.T, h *Handler, id, query string, cc *identitysecurity.CompanyContext) *httptest.ResponseRecorder {
	t.Helper()
	router := chi.NewRouter()
	router.Get("/v/{id}/document-overview", h.Overview)
	target := "/v/" + id + "/document-overview"
	if query != "" {
		target += "?" + query
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if cc != nil {
		req = req.WithContext(identitysecurity.ContextWithCompanyContext(req.Context(), *cc))
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestOverviewPassesTheIdentityTheDraftAndTheFilter(t *testing.T) {
	company, actor, draft, pid := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	cc := &identitysecurity.CompanyContext{CompanyID: company, UserID: actor}
	reader := &fakeOverviewReader{}
	h := NewHandler(reader, nil)

	if rec := serveOverview(t, h, draft.String(), "", cc); rec.Code != 200 {
		t.Fatalf("no filter: %d %s", rec.Code, rec.Body)
	}
	if rec := serveOverview(t, h, draft.String(), "participation_id="+pid.String(), cc); rec.Code != 200 {
		t.Fatalf("filter: %d %s", rec.Code, rec.Body)
	}
	// unknown parameters are ignored, as on the other reads
	if rec := serveOverview(t, h, draft.String(), "x=1", cc); rec.Code != 200 {
		t.Fatalf("unknown parameter: %d %s", rec.Code, rec.Body)
	}
	if len(reader.calls) != 3 {
		t.Fatalf("calls: %+v", reader.calls)
	}
	first, second, third := reader.calls[0], reader.calls[1], reader.calls[2]
	if first.company != company || first.actor != actor || first.draft != draft || first.participation != nil || third.participation != nil {
		t.Fatalf("first call: %+v", first)
	}
	if second.participation == nil || *second.participation != pid || second.draft != draft {
		t.Fatalf("second call: %+v", second)
	}
}

// «malformed → 400 invalid_request»: refused before the store is reached, for every spelling that is not one canonical uuid.
func TestOverviewRejectsAMalformedFilterBeforeTheStore(t *testing.T) {
	cc := &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
	pid := uuid.NewString()
	for name, query := range map[string]string{
		"not a uuid":        "participation_id=abc",
		"empty":             "participation_id=",
		"twice":             "participation_id=" + pid + "&participation_id=" + pid,
		"braces":            "participation_id=%7B" + pid + "%7D",
		"urn":               "participation_id=urn:uuid:" + pid,
		"no dashes":         "participation_id=" + strings.ReplaceAll(pid, "-", ""),
		"trailing space":    "participation_id=" + pid + "%20",
		"broken escape":     "participation_id=%zz",
		"array style":       "participation_id[]=" + pid,
		"only the vacancy":  "participation_id=vacancy",
		"nil-ish with text": "participation_id=0000000z-0000-0000-0000-000000000000",
	} {
		t.Run(name, func(t *testing.T) {
			reader := &fakeOverviewReader{}
			rec := serveOverview(t, NewHandler(reader, nil), uuid.NewString(), query, cc)
			if name == "array style" { // another parameter name: ignored like any unknown one
				if rec.Code != 200 {
					t.Fatalf("%d %s", rec.Code, rec.Body)
				}
				return
			}
			if rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" || len(reader.calls) != 0 {
				t.Fatalf("%d %s calls=%d", rec.Code, rec.Body, len(reader.calls))
			}
		})
	}
	// a malformed draft id is the same 400 as on every draft route
	reader := &fakeOverviewReader{}
	if rec := serveOverview(t, NewHandler(reader, nil), "nope", "", cc); rec.Code != 400 || decode(t, rec)["code"] != "invalid_request" || len(reader.calls) != 0 {
		t.Fatalf("bad draft id: %d %s", rec.Code, rec.Body)
	}
}

func TestOverviewErrorMapping(t *testing.T) {
	cc := &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"not visible or foreign participation", documents.ErrScopeNotFound, 404, "not_found"},
		{"former member", documents.ErrTeamAccessEnded, 404, "team_access_ended"},
		{"role", documents.ErrForbidden, 403, "forbidden"},
		{"user gone", documents.ErrUnauthenticated, 401, "unauthenticated"},
		{"anything else", errors.New("pq: password authentication failed"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := serveOverview(t, NewHandler(&fakeOverviewReader{err: tc.err}, nil), uuid.NewString(), "", cc)
			body := decode(t, rec)
			if rec.Code != tc.status || body["code"] != tc.code || len(body) != 2 || strings.Contains(rec.Body.String(), "password") {
				t.Fatalf("%d %s", rec.Code, rec.Body)
			}
		})
	}
}

// Without a company context, or without a store that reads the overview, the route fails closed with the generic 500.
func TestOverviewFailsClosedWithoutContextOrStore(t *testing.T) {
	if rec := serveOverview(t, NewHandler(&fakeOverviewReader{}, nil), uuid.NewString(), "", nil); rec.Code != 500 {
		t.Fatalf("no company context: %d", rec.Code)
	}
	cc := &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
	if rec := serveOverview(t, NewHandler(nil, nil), uuid.NewString(), "", cc); rec.Code != 500 {
		t.Fatalf("no store: %d", rec.Code)
	}
}

// The arrays are never null whatever the store returned; every key of L20 is present.
func TestOverviewBodyKeysAndEmptyArrays(t *testing.T) {
	cc := &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
	reader := &fakeOverviewReader{overview: documents.Overview{
		Vacancy: documents.OverviewVacancy{ID: "v", Kind: "original"},
		Scope:   documents.BuildScope(documents.ScopeInput{Kind: documents.ScopeVacancy, CanManage: true}),
	}}
	rec := serveOverview(t, NewHandler(reader, nil), uuid.NewString(), "", cc)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	body := decode(t, rec)
	if len(body) != 6 {
		t.Fatalf("keys: %s", rec.Body)
	}
	for _, fragment := range []string{`"items":[]`, `"links":[]`, `"participations":[]`, `"truncated":false`, `"visibility":null`, `"publication":null`, `"title":null`} {
		if !strings.Contains(rec.Body.String(), fragment) {
			t.Errorf("missing %s in %s", fragment, rec.Body)
		}
	}
}

func ccFor(t *testing.T) *identitysecurity.CompanyContext {
	t.Helper()
	return &identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: uuid.New()}
}
