package main

import (
	"context"
	"net/http"
	"strings"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	documentshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/infrastructure/http"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/google/uuid"
)

// Production-router boundary tests for GET /v2/me/company/job-drafts/{id}/documents
// (placement-vacancy-documents-v1, P3). The real route table and middleware order are
// the real ones; the gates and the store are fakes. The authorization matrix against a
// real database is documents_list_integration_test.go.

type routeDocumentsReader struct {
	list                documents.List
	err                 error
	company, actor, doc uuid.UUID
	calls               int
}

func (f *routeDocumentsReader) List(_ context.Context, company, actor, draft uuid.UUID) (documents.List, error) {
	f.calls++
	f.company, f.actor, f.doc = company, actor, draft
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
	deps := routerDeps{
		requireAuth: routeRequireAuth,
		// The recruiter gate refuses everyone here: the documents GET must not sit behind it, or a stakeholder could never read.
		requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, "never"),
		requireOwner:     routeRoleGate(companiesvalueobjects.OwnerRole, "never"),
		documentHandler:  documentshttp.NewHandler(reader),
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
