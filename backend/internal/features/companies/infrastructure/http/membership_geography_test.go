package http

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	companies "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/domain"
	identity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestMembershipCompanyLocationAndTokenAllMembers(t *testing.T) {
	for _, role := range []valueobjects.MemberRole{valueobjects.OwnerRole, valueobjects.RecruiterRole} {
		for _, located := range []bool{false, true} {
			name := role.String() + "/null"
			if located {
				name = role.String() + "/location"
			}
			t.Run(name, func(t *testing.T) {
				user, id := uuid.New(), uuid.New()
				member, company := makeMemberAndCompany(user, id, role)
				company.UpdatedAt = time.Date(2026, 5, 1, 12, 30, 0, 123456789, time.FixedZone("offset", -6*60*60))
				if located {
					company.Location = &domain.Value{Country: "MX", State: "14", Municipality: "14039", PostalCode: "44100"}
				}
				members := &stubMemberRepositoryForHandler{getByUserOut: member}
				users := &stubUserRepositoryForHandler{resolved: &identity.User{ID: user}}
				repo := &stubMemberCompanyRepositoryForHandler{getByID: company}
				router := newMemberRouter(t, newMemberHandlerService(members, users, repo), "sub", security.CompanyContext{})
				rec := doReq(t, router, http.MethodGet, "/me/company", "")
				if rec.Code != 200 {
					t.Fatalf("GET: %d %s", rec.Code, rec.Body.String())
				}
				root := companyObject(t, rec.Body.Bytes())
				assertCompanyKeys(t, root, "company_id", "role", "company")
				obj := companyObject(t, root["company"])
				assertCompanyKeys(t, obj, "id", "name", "rfc", "industry_id", "status", "location", "updated_at")
				if string(obj["updated_at"]) != `"`+company.UpdatedAt.UTC().Format(time.RFC3339Nano)+`"` {
					t.Fatalf("UTC nanosecond token: %s", obj["updated_at"])
				}
				if located {
					assertCompanyLocationKeys(t, obj["location"])
				} else if string(obj["location"]) != "null" {
					t.Fatalf("location: %s", obj["location"])
				}
			})
		}
	}
}

func TestMembershipCatalogFailureFailsClosed(t *testing.T) {
	user, id := uuid.New(), uuid.New()
	member, company := makeMemberAndCompany(user, id, valueobjects.RecruiterRole)
	company.Location = &domain.Value{Country: "MX", State: "14", Municipality: "14039"}
	members := &stubMemberRepositoryForHandler{getByUserOut: member}
	users := &stubUserRepositoryForHandler{resolved: &identity.User{ID: user}}
	repo := &stubMemberCompanyRepositoryForHandler{getByID: company}
	service := usecases.NewCompanyMemberService(members, users, repo, failingCompanyCatalog{level: "state"})
	router := newMemberRouter(t, service, "sub", security.CompanyContext{})
	rec := doReq(t, router, http.MethodGet, "/me/company", "")
	memberAssertCatalogEnvelope(t, rec, 500, httpjson.CodeInternalError)
	if strings.Contains(rec.Body.String(), "catalog read failed") || strings.Contains(rec.Body.String(), "Jalisco") {
		t.Fatal("failed membership read exposed partial data")
	}
}

type membershipCASRepo struct{ *stubRepo }

func (r *membershipCASRepo) GetByID(ctx context.Context, id uuid.UUID) (*companies.Company, error) {
	return r.GetCompanyForUpdate(ctx, id)
}

func (r *membershipCASRepo) UpdateCompany(ctx context.Context, id uuid.UUID, patch repositories.UpdateCompanyPatch, cas time.Time, event audit.AuditEvent) error {
	if err := r.stubRepo.UpdateCompany(ctx, id, patch, cas, event); err != nil {
		return err
	}
	r.getForUpdateOut.UpdatedAt = r.getForUpdateOut.UpdatedAt.UTC().Add(time.Microsecond)
	return nil
}

func TestMembershipTokenRoundTripsIntoOwnerPatch(t *testing.T) {
	user, id := uuid.New(), uuid.New()
	member, company := makeMemberAndCompany(user, id, valueobjects.OwnerRole)
	company.UpdatedAt = time.Date(2026, 5, 1, 12, 30, 0, 123456789, time.FixedZone("offset", -6*60*60))
	repo := &membershipCASRepo{&stubRepo{getForUpdateOut: company}}
	members := &stubMemberRepositoryForHandler{getByUserOut: member}
	users := &stubUserRepositoryForHandler{resolved: &identity.User{ID: user}}
	membership := NewMemberHandler(usecases.NewCompanyMemberService(members, users, repo, companyCatalog{}))
	editor := NewCompanyHandler(usecases.NewCompanyService(repo, companyCatalog{}))
	router := chi.NewRouter()
	router.Get("/me/company", membership.getMyMembership)
	router.Patch("/me/company", editor.updateCompany)
	request := func(method, body, token string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/me/company", strings.NewReader(body))
		req.Header.Set("If-Unmodified-Since", token)
		ctx := security.ContextWithClaims(req.Context(), security.Claims{Subject: "sub"})
		ctx = security.ContextWithCompanyContext(ctx, security.CompanyContext{CompanyID: id, UserID: user, Role: valueobjects.OwnerRole})
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req.WithContext(ctx))
		return rec
	}
	read := request("GET", "", "")
	if read.Code != 200 {
		t.Fatal(read.Code, read.Body.String())
	}
	companyJSON := companyObject(t, companyObject(t, read.Body.Bytes())["company"])
	tokenJSON, present := companyJSON["updated_at"]
	if !present {
		t.Fatal("membership lacks PATCH token")
	}
	token := strings.Trim(string(tokenJSON), `"`)
	if token != company.UpdatedAt.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("token: %s", token)
	}
	saved := request("PATCH", `{"location":{"country":"MX","state":"14","municipality":"14039"}}`, token)
	if saved.Code != 200 || repo.updateCalls != 1 {
		t.Fatalf("PATCH: %d %s", saved.Code, saved.Body.String())
	}
	assertCompanyLocationKeys(t, companyObject(t, saved.Body.Bytes())["location"])
	reread := request("GET", "", "")
	if reread.Code != 200 {
		t.Fatal(reread.Code, reread.Body.String())
	}
	fresh := companyObject(t, companyObject(t, reread.Body.Bytes())["company"])
	if string(fresh["updated_at"]) != string(companyObject(t, saved.Body.Bytes())["updated_at"]) || string(fresh["updated_at"]) == string(tokenJSON) {
		t.Fatal("membership/editor tokens diverged or did not advance")
	}
	conflict := request("PATCH", `{}`, token)
	memberAssertCatalogEnvelope(t, conflict, 409, httpjson.CodeConflict)
	if repo.updateCalls != 1 {
		t.Fatal("stale token reached storage")
	}
	conflictData := companyObject(t, companyObject(t, conflict.Body.Bytes())["data"])
	if string(conflictData["updated_at"]) != string(fresh["updated_at"]) {
		t.Fatal("conflict carries a different token")
	}
}
