package http

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/google/uuid"
)

// gateWith serves one request for a member with role through gate and reports
// whether the handler ran and which role it saw.
func gateWith(t *testing.T, role valueobjects.MemberRole, gate func(*stubUserRepo, *stubMemberRepo, *stubLivenessRepo) func(http.Handler) http.Handler) (*httptest.ResponseRecorder, bool, valueobjects.MemberRole) {
	t.Helper()
	userID := uuid.New()
	users := &stubUserRepo{resolved: &identityentities.User{ID: userID, CognitoSub: "sub"}}
	members := &stubMemberRepo{resolvedMember: &entities.CompanyMember{ID: uuid.New(), UserID: userID, CompanyID: uuid.New(), Role: role}}
	invoked := false
	seen := valueobjects.UnknownMemberRole
	h := gate(users, members, &stubLivenessRepo{live: true})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		invoked = true
		if cc, ok := identitysecurity.CompanyContextFromContext(r.Context()); ok {
			seen = cc.Role
		}
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithSub(http.MethodGet, "/x", "sub"))
	return rec, invoked, seen
}

func assertInsufficientRole(t *testing.T, rec *httptest.ResponseRecorder, invoked bool) {
	t.Helper()
	assertCatalogEnvelope(t, rec, httpjson.CodeForbidden, http.StatusForbidden)
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil || env.Error != "insufficient role" {
		t.Fatalf("body = %s", rec.Body.String())
	}
	if invoked {
		t.Fatal("handler ran for a rejected role")
	}
}

// A stakeholder passes neither ladder gate (stakeholder-metrics-v1 §1.2).
func TestRequireCompanyRole_StakeholderIsForbidden(t *testing.T) {
	for _, min := range []valueobjects.MemberRole{valueobjects.RecruiterRole, valueobjects.OwnerRole} {
		rec, invoked, _ := gateWith(t, valueobjects.StakeholderRole, func(u *stubUserRepo, m *stubMemberRepo, l *stubLivenessRepo) func(http.Handler) http.Handler {
			return RequireCompanyRole(u, m, l, min)
		})
		assertInsufficientRole(t, rec, invoked)
	}
}

// Owner and recruiter keep passing the gates they passed before.
func TestRequireCompanyRole_LadderStillHolds(t *testing.T) {
	for _, tc := range []struct {
		role, min valueobjects.MemberRole
		pass      bool
	}{
		{valueobjects.OwnerRole, valueobjects.RecruiterRole, true},
		{valueobjects.OwnerRole, valueobjects.OwnerRole, true},
		{valueobjects.RecruiterRole, valueobjects.RecruiterRole, true},
		{valueobjects.RecruiterRole, valueobjects.OwnerRole, false},
	} {
		rec, invoked, seen := gateWith(t, tc.role, func(u *stubUserRepo, m *stubMemberRepo, l *stubLivenessRepo) func(http.Handler) http.Handler {
			return RequireCompanyRole(u, m, l, tc.min)
		})
		if !tc.pass {
			assertInsufficientRole(t, rec, invoked)
			continue
		}
		if rec.Code != http.StatusOK || !invoked || seen != tc.role {
			t.Fatalf("%v under %v: %d invoked=%v seen=%v", tc.role, tc.min, rec.Code, invoked, seen)
		}
	}
}

// RequireMetricsViewer passes owner and stakeholder only.
func TestRequireMetricsViewer(t *testing.T) {
	gate := func(u *stubUserRepo, m *stubMemberRepo, l *stubLivenessRepo) func(http.Handler) http.Handler {
		return RequireMetricsViewer(u, m, l)
	}
	for _, role := range []valueobjects.MemberRole{valueobjects.OwnerRole, valueobjects.StakeholderRole} {
		rec, invoked, seen := gateWith(t, role, gate)
		if rec.Code != http.StatusOK || !invoked || seen != role {
			t.Fatalf("%v: %d invoked=%v seen=%v", role, rec.Code, invoked, seen)
		}
	}
	for _, role := range []valueobjects.MemberRole{valueobjects.RecruiterRole, valueobjects.UnknownMemberRole} {
		rec, invoked, _ := gateWith(t, role, gate)
		assertInsufficientRole(t, rec, invoked)
	}
	// Non-members are refused before any role check, like every company gate.
	users := &stubUserRepo{resolved: &identityentities.User{ID: uuid.New(), CognitoSub: "sub"}}
	rec := httptest.NewRecorder()
	RequireMetricsViewer(users, &stubMemberRepo{}, &stubLivenessRepo{live: true})(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler ran for a non-member")
	})).ServeHTTP(rec, reqWithSub(http.MethodGet, "/x", "sub"))
	assertCatalogEnvelope(t, rec, httpjson.CodeForbidden, http.StatusForbidden)
}
