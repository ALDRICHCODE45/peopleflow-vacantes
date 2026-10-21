package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

func (s *movementRouteStore) DuplicatesCheck(_ context.Context, c, a, v uuid.UUID, body []byte) (app.DuplicateMatches, error) {
	s.record(c, a, v, uuid.Nil)
	if s.err != nil {
		return app.DuplicateMatches{}, s.err
	}
	request, err := app.ParseDuplicateRequest(body)
	if err != nil {
		return app.DuplicateMatches{}, err
	}
	if fields := request.Validate(); len(fields) > 0 {
		return app.DuplicateMatches{}, &app.ManualValidationError{Fields: fields}
	}
	return app.DuplicateMatches{Matches: []app.DuplicateMatch{}}, nil
}

func TestManualDuplicatesRoute(t *testing.T) {
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/pipeline/candidates/manual/duplicates-check"
	headers := map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}
	for _, tc := range []struct {
		name, body string
		headers    map[string]string
		status     int
		code       string
		err        error
	}{
		{"anonymous", `{}`, nil, 401, "unauthenticated", nil},
		{"candidate", `{}`, map[string]string{"X-Test-Sub": "candidate"}, 403, "forbidden", nil},
		{"success", `{"email":"a@example.com","phone":null}`, headers, 200, "", nil},
		{"foreign", `{"email":"a@example.com","phone":null}`, headers, 404, "not_found", app.ErrNotFound},
		{"shape", `{"email":null}`, headers, 400, "invalid_request", nil},
		{"contact", `{"email":null,"phone":null}`, headers, 400, "validation_error", nil},
		{"all_invalid", `{"email":"bad","phone":"bad"}`, headers, 400, "validation_error", nil},
		{"budget", strings.Repeat(" ", 1048577), headers, 413, "payload_too_large", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &movementRouteStore{err: tc.err}
			w := doRouteRequest(t, movementRouter(s), "POST", path, tc.body, tc.headers)
			if w.Code != tc.status {
				t.Fatal(w.Code, w.Body.String())
			}
			assertDraftRouteNoStore(t, w)
			if tc.code != "" && routeCatalogCode(t, w) != tc.code {
				t.Fatal(w.Body.String())
			}
			if tc.status == 401 || tc.status == 403 || tc.status == 413 {
				if s.calls != 0 {
					t.Fatal(s.calls)
				}
				return
			}
			if s.company != routeTestCompanyID || s.actor != routeTestActorID || s.vacancy != routeTestDraftID {
				t.Fatal(s)
			}
			if tc.status == 200 && strings.TrimSpace(w.Body.String()) != `{"matches":[]}` {
				t.Fatal(w.Body.String())
			}
			if tc.code == "validation_error" {
				var obj map[string]json.RawMessage
				_ = json.Unmarshal(w.Body.Bytes(), &obj)
				want := `[{"field":"contact","code":"required"}]`
				if tc.name == "all_invalid" {
					want = `[{"field":"email","code":"invalid"},{"field":"phone","code":"invalid"}]`
				}
				if len(obj) != 3 || string(obj["fields"]) != want {
					t.Fatal(w.Body.String())
				}
			}
		})
	}
}
