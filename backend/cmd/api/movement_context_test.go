package main

import (
	"errors"
	"fmt"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
)

func TestMovementContextGateErrorTranslation(t *testing.T) {
	base := "/v2/me/company/job-drafts/" + routeTestDraftID.String()
	for _, tc := range []struct {
		name     string
		from, to error
		status   int
		code     string
	}{
		{"missing user", drafts.ErrUnauthenticated, app.ErrUnauthenticated, 401, "unauthenticated"},
		{"missing membership", drafts.ErrForbidden, app.ErrForbidden, 403, "forbidden"},
		{"inactive company", drafts.ErrCompanyInactive, app.ErrCompanyInactive, 403, "company_inactive"},
		{"nonactive company", drafts.ErrCompanyNotActive, app.ErrCompanyNotActive, 409, "company_not_active"},
		{"hidden draft", drafts.ErrNotFound, app.ErrNotFound, 404, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			translated := movementContextError(fmt.Errorf("live gate: %w", tc.from))
			if !errors.Is(translated, tc.to) {
				t.Fatalf("translation = %v, want %v", translated, tc.to)
			}
			s := &movementRouteStore{err: translated}
			rec := doRouteRequest(t, movementRouter(s), "GET", base+"/board", "", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
			if rec.Code != tc.status || routeCatalogCode(t, rec) != tc.code || rec.Header().Get("ETag") != "" {
				t.Fatal(rec.Code, rec.Body.String())
			}
			assertDraftRouteNoStore(t, rec)
			if s.calls != 1 {
				t.Fatal("request did not reach transactional gate")
			}
		})
	}
	unknown := errors.New("unclassified failure")
	if movementContextError(unknown) != unknown || movementContextError(nil) != nil {
		t.Fatal("unexpected errors must pass through")
	}
}
