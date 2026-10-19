package main

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

func TestDiscardRecoveryRoutesDispatchErrorsPreconditionsAndBudget(t *testing.T) {
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, op := range []string{"discard", "recover"} {
		t.Run(op, func(t *testing.T) {
			path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/" + uuid.NewString() + "/" + op
			for _, tc := range []struct {
				name   string
				err    error
				status int
				code   string
			}{
				{"success", nil, 200, ""}, {"already", app.ErrAlreadyDiscarded, 409, "already_discarded"}, {"not discarded", app.ErrNotDiscarded, 409, "not_discarded"}, {"exit", app.ErrPlacementExit, 409, "placement_exit_confirmation_required"}, {"reentry", app.ErrPlacementReentry, 409, "placement_reentry_confirmation_required"}, {"draft", app.ErrNotPublished, 409, "vacancy_not_published"}, {"malformed", app.ErrInvalidRequest, 400, "invalid_request"}, {"validation", app.ErrValidation, 400, "validation_error"}, {"stale", app.ErrVersionConflict, 412, "version_conflict"}, {"missing", app.ErrPreconditionRequired, 428, "precondition_required"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					s := &movementRouteStore{err: tc.err}
					rec := doRouteRequest(t, movementRouter(s), "POST", path, `{}`, headers)
					if rec.Code != tc.status || s.operation != op || s.calls != 1 || s.present || s.tag != "" {
						t.Fatal(rec.Code, s.operation, s.calls, s.present)
					}
					assertDraftRouteNoStore(t, rec)
					var obj map[string]any
					if err := json.Unmarshal(rec.Body.Bytes(), &obj); err != nil {
						t.Fatal(err)
					}
					if tc.code != "" {
						if len(obj) != 2 || obj["code"] != tc.code || rec.Header().Get("ETag") != "" {
							t.Fatal(obj, rec.Header())
						}
					} else if obj["etag"] != rec.Header().Get("ETag") || obj["coverage"] == nil {
						t.Fatal(obj, rec.Header())
					}
				})
			}
			s := &movementRouteStore{}
			req := httptest.NewRequest("POST", path, strings.NewReader(`{}`))
			for k, v := range headers {
				req.Header.Set(k, v)
			}
			req.Header.Add("If-Match", `"a"`)
			req.Header.Add("If-Match", `"b"`)
			rec := httptest.NewRecorder()
			movementRouter(s).ServeHTTP(rec, req)
			if rec.Code != 200 || s.tag != `"a","b"` || !s.present || s.operation != op || string(s.body) != `{}` {
				t.Fatal(rec.Code, s)
			}
			s.calls = 0
			rec = doRouteRequest(t, movementRouter(s), "POST", path, strings.Repeat("x", 1048577), headers)
			if rec.Code != 413 || s.calls != 0 {
				t.Fatal(rec.Code, s.calls)
			}
		})
	}
}
