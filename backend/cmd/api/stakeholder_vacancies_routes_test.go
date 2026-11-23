package main

import (
	"context"
	"net/http"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/stakeholdervacancies"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

// GET /v2/me/company/stakeholder/vacancies on the production route table (placement-vacancy-documents-v1, P7c): the route sits behind the
// owner + stakeholder gate (the metrics viewer's), NoStore runs before both gates, and a recruiter never reaches the store. The gate
// and the store are fakes; the real ones are stakeholder_vacancies_integration_test.go.

const stakeholderVacanciesURL = "/v2/me/company/stakeholder/vacancies"

type routeStakeholderLister struct {
	calls          int
	company, actor uuid.UUID
	req            stakeholdervacancies.Request
}

func (f *routeStakeholderLister) ListStakeholderVacancies(_ context.Context, company, actor uuid.UUID, req stakeholdervacancies.Request) (stakeholdervacancies.Page, error) {
	f.calls++
	f.company, f.actor, f.req = company, actor, req
	return stakeholdervacancies.Page{}, nil
}

// routeMetricsViewerGate stands in for identityhttp.RequireMetricsViewer: the owner and the stakeholder pass, everyone else gets the
// same 403 envelope the metrics routes answer.
func routeMetricsViewerGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := companiesvalueobjects.MemberRole(0)
		switch r.Header.Get("X-Test-Role") {
		case "owner":
			role = companiesvalueobjects.OwnerRole
		case "stakeholder":
			role = companiesvalueobjects.StakeholderRole
		default:
			routeRoleGate(companiesvalueobjects.OwnerRole, "never")(next).ServeHTTP(w, r)
			return
		}
		cc := identitysecurity.CompanyContext{CompanyID: routeTestCompanyID, UserID: routeTestActorID, Role: role}
		next.ServeHTTP(w, r.WithContext(identitysecurity.ContextWithCompanyContext(r.Context(), cc)))
	})
}

func stakeholderVacanciesRouter(lister stakeholdervacancies.Lister, gate func(http.Handler) http.Handler) http.Handler {
	deps := routerDeps{
		requireAuth:                 routeRequireAuth,
		requireRecruiter:            routeRoleGate(companiesvalueobjects.RecruiterRole, "recruiter"),
		requireOwner:                routeRoleGate(companiesvalueobjects.OwnerRole, "never"),
		stakeholderVacanciesHandler: jobshttp.NewStakeholderVacanciesHandler(lister),
	}
	if gate != nil {
		deps.requireMetricsViewer = gate
	}
	return newRouter(deps)
}

func TestStakeholderVacanciesRouteAdmitsOwnerAndStakeholderOnly(t *testing.T) {
	lister := &routeStakeholderLister{}
	router := stakeholderVacanciesRouter(lister, routeMetricsViewerGate)
	for _, role := range []string{"owner", "stakeholder"} {
		lister.calls = 0
		rec := doRouteRequest(t, router, "GET", stakeholderVacanciesURL, "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": role})
		if rec.Code != 200 || lister.calls != 1 {
			t.Fatalf("%s: %d %s calls=%d", role, rec.Code, rec.Body, lister.calls)
		}
		assertDraftRouteNoStore(t, rec)
		if lister.company != routeTestCompanyID || lister.actor != routeTestActorID || lister.req.Limit != 20 {
			t.Fatalf("%s: the store got %+v", role, lister)
		}
		if got, want := rec.Body.String(), `{"items":[],"next_cursor":null}`+"\n"; got != want {
			t.Fatalf("%s: %s", role, got)
		}
	}
}

// A recruiter is refused with the metrics routes' 403, NoStore wraps the refusal, and nothing reaches the store.
func TestStakeholderVacanciesRouteRefusesEveryoneElseBeforeTheStore(t *testing.T) {
	lister := &routeStakeholderLister{}
	router := stakeholderVacanciesRouter(lister, routeMetricsViewerGate)
	for name, tc := range map[string]struct {
		headers map[string]string
		status  int
		code    string
	}{
		"recruiter": {map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "recruiter"}, 403, "forbidden"},
		"candidate": {map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "candidate"}, 403, "forbidden"},
		"anonymous": {nil, 401, "unauthenticated"},
	} {
		rec := doRouteRequest(t, router, "GET", stakeholderVacanciesURL, "", tc.headers)
		if rec.Code != tc.status || routeCatalogCode(t, rec) != tc.code {
			t.Fatalf("%s: %d %s", name, rec.Code, rec.Body)
		}
		assertDraftRouteNoStore(t, rec)
	}
	if lister.calls != 0 {
		t.Fatalf("the store was reached %d times", lister.calls)
	}
	metrics := doRouteRequest(t, router, "GET", "/v2/me/company/metrics/vacancies", "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "recruiter"})
	rec := doRouteRequest(t, router, "GET", stakeholderVacanciesURL, "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "recruiter"})
	if metrics.Code != rec.Code || routeCatalogCode(t, metrics) != routeCatalogCode(t, rec) {
		t.Fatalf("recruiter: metrics %d %s, stakeholder list %d %s", metrics.Code, metrics.Body, rec.Code, rec.Body)
	}
}

// A router assembled without the gate refuses everyone (fail closed), the same default as the metrics routes.
func TestStakeholderVacanciesRouteFailsClosedWithoutTheGate(t *testing.T) {
	lister := &routeStakeholderLister{}
	router := stakeholderVacanciesRouter(lister, nil)
	rec := doRouteRequest(t, router, "GET", stakeholderVacanciesURL, "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": "owner"})
	if rec.Code != 403 || lister.calls != 0 {
		t.Fatalf("%d %s calls=%d", rec.Code, rec.Body, lister.calls)
	}
}
