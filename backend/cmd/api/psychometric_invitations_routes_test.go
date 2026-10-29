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

type invitationRouteStore struct {
	calls  int
	err    error
	result invitations.Result
}

func (s *invitationRouteStore) ListInvitations(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error) {
	s.calls++
	return s.result, s.err
}
func (s *invitationRouteStore) CreateInvitation(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error) {
	s.calls++
	return s.result, s.err
}
func (s *invitationRouteStore) RemindInvitation(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error) {
	s.calls++
	return s.result, s.err
}
func (s *invitationRouteStore) RevokeInvitation(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error) {
	s.calls++
	return s.result, s.err
}
func (s *invitationRouteStore) MintLink(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID) (invitations.Result, error) {
	s.calls++
	return s.result, s.err
}
func TestPsychometricInvitationRoutes(t *testing.T) {
	base := "/v2/me/company/job-drafts/" + routeTestDraftID.String()
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, route := range []struct{ method, path string }{{"POST", base + "/psychometric-invitations/" + uuid.NewString() + "/link"}, {"GET", base + "/psychometric-invitations"}, {"POST", base + "/participations/" + uuid.NewString() + "/psychometric-invitations"}, {"POST", base + "/psychometric-invitations/" + uuid.NewString() + "/reminders"}, {"POST", base + "/psychometric-invitations/" + uuid.NewString() + "/revoke"}} {
		for _, tc := range []struct {
			name          string
			headers       map[string]string
			err           error
			status        int
			code, message string
			calls         int
		}{
			{"ok", auth, nil, 200, "", "", 1},
			{"anonymous", nil, nil, 401, "unauthenticated", "unauthenticated", 0},
			{"role", map[string]string{"X-Test-Sub": "sub"}, nil, 403, "forbidden", "insufficient role", 0},
			{"membership", auth, drafts.ErrForbidden, 403, "forbidden", "forbidden", 1},
			{"foreign", auth, drafts.ErrNotFound, 404, "not_found", "not found", 1},
			{"disabled", auth, invitations.ErrProfileDisabled, 409, "profile_disabled", "psychometric profile disabled", 1},
			{"finished", auth, invitations.ErrAlreadyFinished, 409, "already_finished", "psychometric assessment already finished", 1},
			{"inactive", auth, invitations.ErrParticipationInactive, 409, "participation_inactive", "participation inactive", 1},
			{"closed", auth, invitations.ErrInvitationClosed, 409, "invitation_closed", "psychometric invitation closed", 1},
			{"internal", auth, errors.New("private"), 500, "internal_error", "an internal error occurred", 1},
		} {
			t.Run(route.method+route.path+tc.name, func(t *testing.T) {
				s := &invitationRouteStore{err: tc.err, result: invitations.Result{Body: []byte(`{"items":[]}`), Status: 200}}
				router := newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), psychometricInvitationsHandler: psychometrichttp.NewInvitationsHandler(s, writeProfileContextError)})
				r := doRouteRequest(t, router, route.method, route.path, "", tc.headers)
				assertDraftRouteNoStore(t, r)
				want := string(s.result.Body)
				if tc.code != "" {
					want = fmt.Sprintf("{\"error\":%q,\"code\":%q}\n", tc.message, tc.code)
				}
				if r.Code != tc.status || r.Body.String() != want || s.calls != tc.calls {
					t.Fatalf("%d %s calls=%d want %d %s calls=%d", r.Code, r.Body.String(), s.calls, tc.status, want, tc.calls)
				}
			})
		}
	}
}
