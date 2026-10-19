package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func TestSubstateRoutesDispatchErrorsAndPreconditions(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/" + uuid.NewString() + "/substate"
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"success", nil, 200, ""}, {"wrong stage", app.ErrSubstateRequiresInProcess, 409, "substate_requires_in_process"},
		{"unknown id", app.ErrValidation, 400, "validation_error"}, {"draft", app.ErrNotPublished, 409, "vacancy_not_published"},
		{"missing", app.ErrPreconditionRequired, 428, "precondition_required"}, {"stale", app.ErrVersionConflict, 412, "version_conflict"},
		{"malformed", app.ErrInvalidRequest, 400, "invalid_request"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &movementRouteStore{err: tc.err}
			req := httptest.NewRequest("POST", path, strings.NewReader(`{"substate_id":null}`))
			req.Header.Set("X-Test-Sub", "sub")
			req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
			req.Header.Add("If-Match", `"first"`)
			req.Header.Add("If-Match", `"second"`)
			rec := httptest.NewRecorder()
			movementRouter(s).ServeHTTP(rec, req)
			if rec.Code != tc.status || s.operation != "substate" || s.tag != `"first","second"` || !s.present || string(s.body) != `{"substate_id":null}` {
				t.Fatal(rec.Code, rec.Body.String(), s)
			}
			assertDraftRouteNoStore(t, rec)
			if tc.code != "" && (routeCatalogCode(t, rec) != tc.code || rec.Header().Get("ETag") != "") {
				t.Fatal(rec.Body.String())
			}
		})
	}
	s := &movementRouteStore{}
	rec := doRouteRequest(t, movementRouter(s), "POST", path, strings.Repeat("x", 1048577), map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
	if rec.Code != 413 || s.calls != 0 {
		t.Fatal(rec.Code, s)
	}
}

func TestSubstateCatalogInUseDetailsOverRealRouter(t *testing.T) {
	ids := []string{uuid.NewString(), uuid.NewString()}
	s := &substatesRouteStore{err: &substatecatalog.InUseError{IDs: ids}}
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline/substates"
	rec := doRouteRequest(t, substatesRoutesRouter(s), "PUT", path, `{"substates":[]}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader, "If-Match": `"catalog"`})
	if rec.Code != 409 || routeCatalogCode(t, rec) != "substate_in_use" || rec.Header().Get("ETag") != "" {
		t.Fatal(rec.Code, rec.Body.String())
	}
	assertDraftRouteNoStore(t, rec)
	var obj map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &obj); err != nil {
		t.Fatal(err)
	}
	if len(obj) != 3 {
		t.Fatal(obj)
	}
	list := obj["details"].([]any)
	if len(list) != len(ids) {
		t.Fatal(obj)
	}
	for i, raw := range list {
		detail := raw.(map[string]any)
		if len(detail) != 1 || detail["substate_id"] != ids[i] {
			t.Fatal(obj)
		}
	}
}
