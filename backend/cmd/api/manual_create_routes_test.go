package main

import (
	"context"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
	"testing"
)

func (s *movementRouteStore) CreateManual(_ context.Context, c, a, v uuid.UUID, in app.ManualInput, _ app.ManualCVInspector, _ app.ManualFileStorage) (app.ManualCreated, error) {
	s.record(c, a, v, uuid.Nil)
	return app.ManualCreated{Body: []byte(`{"created":true}`), ETag: `"created"`}, s.err
}

func TestManualCreateRouteGates(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline/candidates/manual"
	for _, tc := range []struct {
		name    string
		headers map[string]string
		status  int
		code    string
	}{
		{"anonymous", nil, 401, "unauthenticated"},
		{"candidate", map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden"},
		{"recruiter", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}, 400, "idempotency_key_required"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &movementRouteStore{}
			w := doRouteRequest(t, movementRouter(s), "POST", path, `{}`, tc.headers)
			if w.Code != tc.status || routeCatalogCode(t, w) != tc.code || s.calls != 0 {
				t.Fatal(w.Code, w.Body.String())
			}
			assertDraftRouteNoStore(t, w)
		})
	}
}
