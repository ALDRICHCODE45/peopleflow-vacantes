package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	movementhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

type movementRouteStore struct {
	err                          error
	calls                        int
	company, actor, vacancy, pid uuid.UUID
	tag                          string
	present                      bool
	body                         []byte
	operation                    string
}

func (s *movementRouteStore) record(c, a, v, p uuid.UUID) {
	s.calls++
	s.company = c
	s.actor = a
	s.vacancy = v
	s.pid = p
}
func (s *movementRouteStore) Board(_ context.Context, c, a, v uuid.UUID) (app.Board, error) {
	s.record(c, a, v, uuid.Nil)
	return app.Board{Stages: []app.Stage{}, Participations: []app.Item{}}, s.err
}
func (s *movementRouteStore) Move(_ context.Context, c, a, v, p uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	s.record(c, a, v, p)
	s.operation = "move"
	s.tag = tag
	s.present = present
	s.body = body
	return app.Moved{Item: app.Item{ID: p, ETag: `"item-tag"`, Version: "2", CorrectedFields: []string{}, CV: app.CV{Source: "candidate"}}}, s.err
}
func (s *movementRouteStore) Discard(ctx context.Context, c, a, v, p uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	out, err := s.Move(ctx, c, a, v, p, tag, present, body)
	s.operation = "discard"
	return out, err
}
func (s *movementRouteStore) Recover(ctx context.Context, c, a, v, p uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	out, err := s.Move(ctx, c, a, v, p, tag, present, body)
	s.operation = "recover"
	return out, err
}
func (s *movementRouteStore) SetSubstate(ctx context.Context, c, a, v, p uuid.UUID, tag string, present bool, body []byte) (app.Moved, error) {
	out, err := s.Move(ctx, c, a, v, p, tag, present, body)
	s.operation = "substate"
	return out, err
}
func (s *movementRouteStore) Detail(_ context.Context, c, a, v, p uuid.UUID) (app.Detail, error) {
	s.record(c, a, v, p)
	return app.Detail{Item: app.Item{ID: p, ETag: `"item-tag"`, Version: "1", CorrectedFields: []string{}, CV: app.CV{Source: "candidate"}}, Screening: []app.Screening{}}, s.err
}
func (s *movementRouteStore) History(_ context.Context, c, a, v, p uuid.UUID) (app.History, error) {
	s.record(c, a, v, p)
	return app.History{Items: []app.Entry{}}, s.err
}
func (s *movementRouteStore) File(_ context.Context, c, a, v, p uuid.UUID) (app.File, error) {
	s.record(c, a, v, p)
	return app.File{Name: "Resume", ContentType: "application/pdf", Size: 6, Reader: io.NopCloser(strings.NewReader("%PDF-1"))}, s.err
}
func movementRouter(s *movementRouteStore) http.Handler {
	return newRouter(routerDeps{requireAuth: routeRequireAuth, requireRecruiter: routeRoleGate(valueobjects.RecruiterRole, routeTestRecruiterHeader), requireOwner: routeRoleGate(valueobjects.OwnerRole, routeTestOwnerHeader), movementHandler: movementhttp.NewHandler(s)})
}
func TestMovementRoutesGatesErrorsAndSuccess(t *testing.T) {
	base := "/v2/me/company/job-drafts/" + routeTestDraftID.String()
	pid := uuid.New()
	item := base + "/participations/" + pid.String()
	for _, route := range []struct{ method, path string }{{"GET", base + "/board"}, {"POST", item + "/moves"}, {"POST", item + "/discard"}, {"POST", item + "/recover"}, {"POST", item + "/substate"}, {"GET", item}, {"GET", item + "/history"}, {"GET", item + "/cv"}} {
		t.Run(route.method+route.path, func(t *testing.T) {
			for _, tc := range []struct {
				name    string
				headers map[string]string
				err     error
				status  int
				code    string
			}{
				{"unauthenticated", nil, nil, 401, "unauthenticated"}, {"candidate", map[string]string{"X-Test-Sub": "candidate"}, nil, 403, "forbidden"},
				{"ok", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}, nil, 200, ""},
				{"foreign", map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader}, app.ErrNotFound, 404, "not_found"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					s := &movementRouteStore{err: tc.err}
					rec := doRouteRequest(t, movementRouter(s), route.method, route.path, `{}`, tc.headers)
					if rec.Code != tc.status {
						t.Fatal(rec.Code, rec.Body.String())
					}
					assertDraftRouteNoStore(t, rec)
					if tc.status == 401 || tc.status == 403 {
						if s.calls != 0 {
							t.Fatal("gate called store")
						}
						return
					}
					if s.company != routeTestCompanyID || s.actor != routeTestActorID || s.vacancy != routeTestDraftID {
						t.Fatal("untrusted identity", s)
					}
					if tc.code != "" {
						if routeCatalogCode(t, rec) != tc.code {
							t.Fatal(rec.Body.String())
						}
						return
					}
					if route.method == "POST" {
						var out map[string]any
						if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || out["etag"] != `"item-tag"` || out["coverage"] == nil || rec.Header().Get("ETag") != `"item-tag"` {
							t.Fatal(rec.Body.String(), rec.Header())
						}
					}
					if strings.HasSuffix(route.path, "/cv") {
						if rec.Header().Get("Content-Type") != "application/pdf" || !strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment;") || rec.Body.String() != "%PDF-1" {
							t.Fatal(rec.Header(), rec.Body.String())
						}
					}
				})
			}
		})
	}
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"skip", app.ErrStageSkip, 409, "stage_skip_not_allowed"}, {"exit", app.ErrPlacementExit, 409, "placement_exit_confirmation_required"}, {"draft", app.ErrNotPublished, 409, "vacancy_not_published"}, {"limit", app.ErrTooLarge, 422, "board_too_large"}, {"stale", app.ErrVersionConflict, 412, "version_conflict"}, {"missing", app.ErrPreconditionRequired, 428, "precondition_required"}, {"invalid", app.ErrInvalidRequest, 400, "invalid_request"}, {"validation", app.ErrValidation, 400, "validation_error"}, {"storage", app.ErrStorageUnavailable, 503, "cv_storage_unavailable"}, {"internal", errors.New("private data"), 500, "internal_error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &movementRouteStore{err: tc.err}
			rec := doRouteRequest(t, movementRouter(s), "POST", item+"/moves", `{}`, map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
			if rec.Code != tc.status || routeCatalogCode(t, rec) != tc.code || rec.Header().Get("ETag") != "" {
				t.Fatal(rec.Code, rec.Body.String())
			}
			var obj map[string]any
			_ = json.Unmarshal(rec.Body.Bytes(), &obj)
			if len(obj) != 2 {
				t.Fatal(obj)
			}
		})
	}
}
func TestMovementRoutesForwardPreconditionAndBudget(t *testing.T) {
	s := &movementRouteStore{}
	path := "/v2/me/company/job-drafts/" + routeTestDraftID.String() + "/participations/" + uuid.NewString() + "/moves"
	req := httptest.NewRequest("POST", path, strings.NewReader(`{"to_stage_id":"target"}`))
	req.Header.Set("X-Test-Sub", "sub")
	req.Header.Set("X-Test-Role", routeTestRecruiterHeader)
	req.Header.Add("If-Match", `"a"`)
	req.Header.Add("If-Match", `"b"`)
	rec := httptest.NewRecorder()
	movementRouter(s).ServeHTTP(rec, req)
	if rec.Code != 200 || s.tag != `"a","b"` || !s.present || string(s.body) != `{"to_stage_id":"target"}` {
		t.Fatal(rec.Code, s)
	}
	s.calls = 0
	rec = doRouteRequest(t, movementRouter(s), "POST", path, strings.Repeat("x", 1048577), map[string]string{"X-Test-Sub": "sub", "X-Test-Role": routeTestRecruiterHeader})
	if rec.Code != 413 || s.calls != 0 {
		t.Fatal(rec.Code, s.calls)
	}
}
