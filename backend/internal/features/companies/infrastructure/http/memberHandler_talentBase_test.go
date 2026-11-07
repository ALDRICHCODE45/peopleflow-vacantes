package http

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/talentbase"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	identity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type stubTalentBaseAccess struct {
	allowed bool
	err     error
	role    string
}

func (s *stubTalentBaseAccess) CanView(_ context.Context, _, _ uuid.UUID, role string) (bool, error) {
	s.role = role
	return s.allowed, s.err
}

var _ talentbase.Access = (*stubTalentBaseAccess)(nil)

func getMyMembership(t *testing.T, role valueobjects.MemberRole, access talentbase.Access) (int, map[string]string) {
	t.Helper()
	user, id := uuid.New(), uuid.New()
	member, company := makeMemberAndCompany(user, id, role)
	members := &stubMemberRepositoryForHandler{getByUserOut: member}
	users := &stubUserRepositoryForHandler{resolved: &identity.User{ID: user}}
	repo := &stubMemberCompanyRepositoryForHandler{getByID: company}
	handler := NewMemberHandler(newMemberHandlerService(members, users, repo))
	if access != nil {
		handler.WithTalentBaseAccess(access)
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: "sub"})))
		})
	})
	r.Mount("/me/company", handler.Routes())
	rec := doReq(t, r, http.MethodGet, "/me/company", "")
	out := map[string]string{}
	if rec.Code == 200 {
		root := companyObject(t, rec.Body.Bytes())
		out["can"] = string(root["can"])
	}
	return rec.Code, out
}

func TestMembershipCapabilityFlag(t *testing.T) {
	for _, tc := range []struct {
		name   string
		role   valueobjects.MemberRole
		access *stubTalentBaseAccess
		want   string
	}{
		{"recruiter allowed", valueobjects.RecruiterRole, &stubTalentBaseAccess{allowed: true}, `{"view_talent_base":true,"view_metrics":false}`},
		{"recruiter restricted", valueobjects.RecruiterRole, &stubTalentBaseAccess{}, `{"view_talent_base":false,"view_metrics":false}`},
		{"owner allowed", valueobjects.OwnerRole, &stubTalentBaseAccess{allowed: true}, `{"view_talent_base":true,"view_metrics":true}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, got := getMyMembership(t, tc.role, tc.access)
			if status != 200 || got["can"] != tc.want || tc.access.role != tc.role.String() {
				t.Fatalf("status=%d can=%s role=%s", status, got["can"], tc.access.role)
			}
		})
	}
	t.Run("without a capability source only owners see it", func(t *testing.T) {
		if _, got := getMyMembership(t, valueobjects.OwnerRole, nil); got["can"] != `{"view_talent_base":true,"view_metrics":true}` {
			t.Fatal(got)
		}
		if _, got := getMyMembership(t, valueobjects.RecruiterRole, nil); got["can"] != `{"view_talent_base":false,"view_metrics":false}` {
			t.Fatal(got)
		}
	})
	// A stakeholder never sees the talent base, even when the source would allow
	// it, and the source is not asked (stakeholder-metrics-v1 §1.2, D3).
	t.Run("stakeholder sees metrics, never the talent base", func(t *testing.T) {
		access := &stubTalentBaseAccess{allowed: true}
		status, got := getMyMembership(t, valueobjects.StakeholderRole, access)
		if status != 200 || got["can"] != `{"view_talent_base":false,"view_metrics":true}` || access.role != "" {
			t.Fatalf("status=%d can=%s role=%s", status, got["can"], access.role)
		}
	})
	t.Run("access failure fails closed", func(t *testing.T) {
		status, _ := getMyMembership(t, valueobjects.RecruiterRole, &stubTalentBaseAccess{err: errors.New("down")})
		if status != http.StatusInternalServerError {
			t.Fatalf("status=%d", status)
		}
	})
}
