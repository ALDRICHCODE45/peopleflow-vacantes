package main

import (
	"context"
	"errors"
	"fmt"
	"testing"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
	psychometrichttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/infrastructure/http"
	"github.com/google/uuid"
)

type resultRouteStore struct{ invitationRouteStore }

func (s *resultRouteStore) GetResult(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error) {
	s.calls++
	return s.result, s.err
}
func (s *resultRouteStore) CreateComparison(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error) {
	s.calls++
	return s.result, s.err
}
func TestPsychometricResultRoutes(t *testing.T) {
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, method := range []string{"GET", "POST"} {
		suffix := "/result"
		status := 200
		if method == "POST" {
			suffix = "/comparisons"
			status = 201
		}
		for _, tc := range []struct {
			name          string
			headers       map[string]string
			err           error
			status        int
			code, message string
			calls         int
		}{
			{"success", auth, nil, status, "", "", 1},
			{"anonymous", nil, nil, 401, "unauthenticated", "unauthenticated", 0},
			{"role", map[string]string{"X-Test-Sub": "sub"}, nil, 403, "forbidden", "insufficient role", 0},
			{"membership", auth, drafts.ErrForbidden, 403, "forbidden", "forbidden", 1},
			{"foreign", auth, drafts.ErrNotFound, 404, "not_found", "not found", 1},
			{"missing", auth, invitations.ErrNotFound, 404, "not_found", "not found", 1},
			{"unconfirmed", auth, invitations.ErrProfileUnconfirmed, 409, "profile_unconfirmed", "psychometric profile unconfirmed", 1},
			{"internal", auth, errors.New("private"), 500, "internal_error", "an internal error occurred", 1},
		} {
			t.Run(method+tc.name, func(t *testing.T) {
				s := &resultRouteStore{invitationRouteStore{err: tc.err, result: invitations.Result{Status: status, Body: []byte(`{"stored":true}`)}}}
				router := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), psychometricInvitationsHandler: psychometrichttp.NewInvitationsHandler(s, writeProfileContextError)})
				path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/psychometric-invitations/" + uuid.NewString() + suffix
				r := doRouteRequest(t, router, method, path, "", tc.headers)
				assertDraftRouteNoStore(t, r)
				want := string(s.result.Body)
				if tc.code != "" {
					want = fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", tc.message, tc.code)
				}
				if r.Code != tc.status || r.Body.String() != want || s.calls != tc.calls {
					t.Fatal(r.Code, r.Body.String(), s.calls, "want", tc.status, want, tc.calls)
				}
			})
		}
	}
}
