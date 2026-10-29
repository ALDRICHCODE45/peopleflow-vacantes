package main

import (
	"context"
	"net/http"
	"testing"
	"time"

	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/checklist"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	"github.com/google/uuid"
)

type checklistMarksRouteStore struct {
	calls int
	err   error
	mark  checklist.Mark
}

func (s *checklistMarksRouteStore) GetChecklistMarks(_ context.Context, c, a, id uuid.UUID) ([]checklist.Mark, error) {
	s.calls++
	return []checklist.Mark{}, s.err
}
func (s *checklistMarksRouteStore) PutChecklistMark(_ context.Context, c, a, id, pid, cid uuid.UUID, body []byte) (checklist.Mark, error) {
	s.calls++
	if c != routeTestCompanyID || a != routeTestActorID || id != routeTestDraftID || pid != s.mark.ParticipationID || cid != s.mark.CriterionID || string(body) != `{"verdict":"met"}` {
		panic("incorrect identity/body forwarding")
	}
	return s.mark, s.err
}
func (s *checklistMarksRouteStore) DeleteChecklistMark(_ context.Context, c, a, id, pid, cid uuid.UUID) error {
	s.calls++
	return s.err
}
func checklistMarksRoutesRouter(s *checklistMarksRouteStore) http.Handler {
	return newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(companiesvalueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(companiesvalueobjects.OwnerRole, routeTestOwnerHeader), checklistMarksHandler: jobshttp.NewChecklistMarksHandler(s)})
}

func TestChecklistMarksRoutesNoStoreAndPathIDs(t *testing.T) {
	pid, cid := uuid.New(), uuid.New()
	base := "/v2/me/company/job-drafts/" + routeTestDraftID.String()
	path := base + "/participations/" + pid.String() + "/checklist-marks/" + cid.String()
	auth := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, tc := range []struct {
		name, method, path string
		headers            map[string]string
		err                error
		status, calls      int
	}{
		{"list", "GET", base + "/checklist/marks", auth, nil, 200, 1}, {"put", "PUT", path, auth, nil, 200, 1}, {"delete", "DELETE", path, auth, nil, 204, 1},
		{"anonymous get", "GET", base + "/checklist/marks", nil, nil, 401, 0}, {"anonymous put", "PUT", path, nil, nil, 401, 0}, {"anonymous delete", "DELETE", path, nil, nil, 401, 0},
		{"role put", "PUT", path, map[string]string{"X-Test-Sub": "sub"}, nil, 403, 0}, {"role delete", "DELETE", path, map[string]string{"X-Test-Sub": "sub"}, nil, 403, 0},
		{"bad pid", "PUT", base + "/participations/bad/checklist-marks/" + cid.String(), auth, nil, 404, 0}, {"bad cid", "DELETE", base + "/participations/" + pid.String() + "/checklist-marks/bad", auth, nil, 404, 0},
		{"not found", "PUT", path, auth, drafts.ErrNotFound, 404, 1}, {"validation", "PUT", path, auth, &checklist.Invalid{Fields: []checklist.Field{{Field: "verdict", Code: "invalid"}}}, 400, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &checklistMarksRouteStore{err: tc.err, mark: checklist.Mark{ParticipationID: pid, CriterionID: cid, Verdict: "met", MarkedBy: checklist.MarkedBy{ID: routeTestActorID, FullName: "Recruiter"}, MarkedAt: time.Now()}}
			r := doRouteRequest(t, checklistMarksRoutesRouter(s), tc.method, tc.path, `{"verdict":"met"}`, tc.headers)
			assertDraftRouteNoStore(t, r)
			if r.Code != tc.status || s.calls != tc.calls || r.Header().Get("ETag") != "" {
				t.Fatalf("status=%d body=%s calls=%d", r.Code, r.Body.String(), s.calls)
			}
			if tc.status == 204 && r.Body.Len() != 0 {
				t.Fatal("204 body")
			}
		})
	}
}
