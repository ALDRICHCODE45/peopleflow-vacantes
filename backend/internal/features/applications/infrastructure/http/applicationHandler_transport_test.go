// Concern-split Applications HTTP transport evidence (task 1.5E):
// preconditions (service: nil proves the short-circuit — a nil deref would
// panic), every classifier sentinel driven at the HTTP boundary, and every
// reachable unexpected service-error site with captured slog plus stub
// counter guards. Slog tests MUST NOT call t.Parallel() (global Default()).
package http

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	applicationsentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var allowedEnvelopeKeys = map[string]struct{}{"error": {}, "code": {}, "data": {}}

// assertTransportEnvelope pins status, catalog code, exact error string, no
// `data` key, no key outside the closed set; internal_error additionally
// requires the canonical message and forbids the supplied rejectReason.
func assertTransportEnvelope(t *testing.T, w *httptest.ResponseRecorder, wantStatus int, wantCode httpjson.Code, wantMsg, rejectReason string) {
	t.Helper()
	if w.Code != wantStatus {
		t.Fatalf("status: want %d, got %d (body %s)", wantStatus, w.Code, w.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &raw); err != nil {
		t.Fatalf("body not JSON: %v (body %s)", err, w.Body.String())
	}
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
	if env.Error != wantMsg {
		t.Errorf("error: want %q, got %q", wantMsg, env.Error)
	}
	if _, has := raw["data"]; has {
		t.Errorf("data key MUST be omitted for code=%q; body=%s", wantCode, w.Body.String())
	}
	for k := range raw {
		if _, ok := allowedEnvelopeKeys[k]; !ok {
			t.Errorf("unexpected envelope key %q in body %s", k, w.Body.String())
		}
	}
	if wantCode == httpjson.CodeInternalError {
		if env.Error != "an internal error occurred" {
			t.Errorf("internal_error: want canonical message, got %q", env.Error)
		}
		if rejectReason != "" && strings.Contains(w.Body.String(), rejectReason) {
			t.Errorf("internal_error MUST NOT carry injected detail %q; body=%s", rejectReason, w.Body.String())
		}
	}
}

// newNilServiceRouter wires service: nil, so completing a request proves no
// use-case call happened.
func newNilServiceRouter() chi.Router {
	h := NewApplicationHandler(nil)
	r := chi.NewRouter()
	hh := h.ApplicationHandlers()
	r.Post("/jobs/{jobId}/applications", hh.ApplyToJob)
	r.Get("/me/applications", hh.ListMyApplications)
	r.Get("/jobs/{jobId}/applications", hh.ListJobApplications)
	r.Get("/jobs/{jobId}/applications/{id}", hh.GetApplication)
	r.Patch("/jobs/{jobId}/applications/{id}/transition", hh.TransitionApplication)
	return r
}

func captureTransportSlog(t *testing.T) *bytes.Buffer {
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func lastSlogRecord(t *testing.T, buf *bytes.Buffer) map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	var rec map[string]any
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &rec); err != nil {
		t.Fatalf("decode slog record: %v; raw=%s", err, buf.String())
	}
	return rec
}

// submittedApp is the stored row every transition case reads back.
func submittedApp() *applicationsentities.ApplicationWithCandidate {
	return &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{Status: applicationsvalueobjects.Submitted},
	}
}

// --- 1. Precondition matrix --------------------------------------------
func TestTransport_Preconditions_NoServiceAndExactEnvelope(t *testing.T) {
	u := uuid.New().String()
	cases := []struct {
		name, method, path, body string
		injectSub, injectCC      bool
		wantStatus               int
		wantCode                 httpjson.Code
		wantMsg                  string
	}{
		{"apply/missing_subject", "POST", "/jobs/" + u + "/applications", `{}`, false, false, http.StatusUnauthorized, httpjson.CodeUnauthenticated, "unauthenticated"},
		{"apply/invalid_job_id", "POST", "/jobs/not-a-uuid/applications", `{}`, true, false, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
		{"apply/malformed_json", "POST", "/jobs/" + u + "/applications", `{bad`, true, false, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
		{"list_my/missing_subject", "GET", "/me/applications", "", false, false, http.StatusUnauthorized, httpjson.CodeUnauthenticated, "unauthenticated"},
		{"list_recruiter/missing_ctx", "GET", "/jobs/" + u + "/applications", "", false, false, http.StatusInternalServerError, httpjson.CodeInternalError, "an internal error occurred"},
		{"list_recruiter/invalid_job_id", "GET", "/jobs/not-a-uuid/applications", "", false, true, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
		{"detail/missing_ctx", "GET", "/jobs/" + u + "/applications/" + uuid.New().String(), "", false, false, http.StatusInternalServerError, httpjson.CodeInternalError, "an internal error occurred"},
		{"detail/invalid_job_id", "GET", "/jobs/not-a-uuid/applications/" + uuid.New().String(), "", false, true, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
		{"detail/invalid_app_id", "GET", "/jobs/" + u + "/applications/not-a-uuid", "", false, true, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
		{"transition/missing_ctx", "PATCH", "/jobs/" + u + "/applications/" + uuid.New().String() + "/transition", `{"status":"in_review"}`, false, false, http.StatusInternalServerError, httpjson.CodeInternalError, "an internal error occurred"},
		{"transition/invalid_job_id", "PATCH", "/jobs/not-a-uuid/applications/" + uuid.New().String() + "/transition", `{"status":"in_review"}`, false, true, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
		{"transition/invalid_app_id", "PATCH", "/jobs/" + u + "/applications/not-a-uuid/transition", `{"status":"in_review"}`, false, true, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
		{"transition/malformed_json", "PATCH", "/jobs/" + u + "/applications/" + uuid.New().String() + "/transition", `{bad`, false, true, http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid request"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var req *http.Request
			if tc.body != "" {
				req = httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
				req.Header.Set("Content-Type", "application/json")
			} else {
				req = httptest.NewRequest(tc.method, tc.path, nil)
			}
			if tc.injectSub {
				req = withClaims(req, "sub-precondition")
			}
			if tc.injectCC {
				req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
			}
			w := httptest.NewRecorder()
			newNilServiceRouter().ServeHTTP(w, req)
			assertTransportEnvelope(t, w, tc.wantStatus, tc.wantCode, tc.wantMsg, "")
		})
	}
}

// --- 2. Classifier sentinels at the HTTP boundary ----------------------
func TestTransport_Sentinels_AtHTTPBoundary(t *testing.T) {
	jobID, appID := uuid.New().String(), uuid.New().String()
	cases := []struct {
		name, method, path, body string
		injectCC, nilActor       bool
		setUp                    func(*harness)
		wantStatus               int
		wantCode                 httpjson.Code
		wantMsg                  string
	}{
		{"apply/unknown_subject_401", "POST", "/jobs/" + jobID + "/applications", `{}`, false, false,
			func(h *harness) { h.userRepo.getByCognitoSubErr = identityentities.ErrUserNotFound },
			http.StatusUnauthorized, httpjson.CodeUnauthenticated, "unauthenticated"},
		{"apply/cover_letter_too_long", "POST", "/jobs/" + jobID + "/applications", `{"cover_letter":"` + strings.Repeat("x", 2001) + `"}`, false, false,
			func(h *harness) { h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()} },
			http.StatusBadRequest, httpjson.CodeInvalidRequest, "cover_letter must be at most 2000 characters"},
		{"apply/cover_letter_empty", "POST", "/jobs/" + jobID + "/applications", `{"cover_letter":"   "}`, false, false,
			func(h *harness) { h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()} },
			http.StatusBadRequest, httpjson.CodeInvalidRequest, "cover_letter must not be empty"},
		{"apply/invalid_source", "POST", "/jobs/" + jobID + "/applications", `{"source":"newspaper"}`, false, false,
			func(h *harness) { h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()} },
			http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid source"},
		{"apply/invalid_application_reference", "POST", "/jobs/" + jobID + "/applications", `{}`, false, false,
			func(h *harness) {
				h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
				h.repo.createErr = applicationsentities.ErrInvalidApplicationReference
			},
			http.StatusBadRequest, httpjson.CodeInvalidRequest, "invalid application reference"},
		{"apply/job_not_applicable_404", "POST", "/jobs/" + jobID + "/applications", `{}`, false, false,
			func(h *harness) {
				h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
				h.repo.createErr = applicationsentities.ErrJobNotApplicable
			},
			http.StatusNotFound, httpjson.CodeNotFound, "job not applicable"},
		{"apply/already_applied_409", "POST", "/jobs/" + jobID + "/applications", `{}`, false, false,
			func(h *harness) {
				h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
				h.repo.createErr = applicationsentities.ErrAlreadyApplied
			},
			http.StatusConflict, httpjson.CodeAlreadyExists, "already applied"},
		{"detail/application_not_found_404", "GET", "/jobs/" + jobID + "/applications/" + appID, "", true, false,
			func(h *harness) { h.repo.getByIDErr = applicationsentities.ErrApplicationNotFound },
			http.StatusNotFound, httpjson.CodeNotFound, "application not found"},
		{"transition/status_required", "PATCH", "/jobs/" + jobID + "/applications/" + appID + "/transition", `{"status":"   "}`, true, false,
			nil,
			http.StatusBadRequest, httpjson.CodeInvalidRequest, "status is required"},
		{"transition/illegal_preserves_detail", "PATCH", "/jobs/" + jobID + "/applications/" + appID + "/transition", `{"status":"rejected"}`, true, false,
			func(h *harness) { h.repo.getByIDApp = submittedApp() },
			http.StatusBadRequest, httpjson.CodeInvalidStatusTransition, "invalid status transition: submitted -> rejected"},
		{"transition/unknown_status_value", "PATCH", "/jobs/" + jobID + "/applications/" + appID + "/transition", `{"status":"withdrawn"}`, true, false,
			func(h *harness) { h.repo.getByIDApp = submittedApp() },
			http.StatusBadRequest, httpjson.CodeInvalidStatusTransition, "invalid status transition"},
		// Reaches the use case with CompanyID set but UserID zero, so the D8
		// actor guard fires AFTER the matrix — not requireCompanyContext.
		{"transition/missing_actor_identity_500", "PATCH", "/jobs/" + jobID + "/applications/" + appID + "/transition", `{"status":"in_review"}`, false, true,
			func(h *harness) { h.repo.getByIDApp = submittedApp() },
			http.StatusInternalServerError, httpjson.CodeInternalError, "an internal error occurred"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newHarness()
			if tc.setUp != nil {
				tc.setUp(h)
			}
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			req = withClaims(req, "sub-sentinel")
			if tc.injectCC || tc.nilActor {
				actor := makeRecruiterID()
				if tc.nilActor {
					actor = uuid.Nil
				}
				req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: actor})
			}
			w := httptest.NewRecorder()
			h.router.ServeHTTP(w, req)
			assertTransportEnvelope(t, w, tc.wantStatus, tc.wantCode, tc.wantMsg, "")
			if tc.nilActor && h.repo.transitionCalls != 0 {
				t.Errorf("missing actor identity MUST NOT write, got %d Transition calls", h.repo.transitionCalls)
			}
		})
	}
}

// --- 3. Unexpected service-error sites ---------------------------------
func TestTransport_UnexpectedServiceErrors(t *testing.T) {
	jobID, appID := uuid.New(), uuid.New()
	cases := []struct {
		name, method, path  string
		injectSub, injectCC bool
		setUp               func(*harness)
		assertCounters      func(t *testing.T, h *harness)
		inject              string
	}{
		{"apply_user_lookup", "POST", "/jobs/" + jobID.String() + "/applications", true, false,
			func(h *harness) {
				h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
				h.userRepo.getByCognitoSubErr = errors.New("boom: user lookup failed")
			},
			func(t *testing.T, h *harness) {
				if h.repo.createCalls != 0 {
					t.Errorf("identity failed; Create MUST NOT be called, got %d", h.repo.createCalls)
				}
			},
			"boom: user lookup failed"},
		{"apply_create", "POST", "/jobs/" + jobID.String() + "/applications", true, false,
			func(h *harness) {
				h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
				h.repo.createErr = errors.New("pg: connection refused")
			},
			func(t *testing.T, h *harness) {
				if h.repo.createCalls != 1 {
					t.Errorf("Create must be called once, got %d", h.repo.createCalls)
				}
				if h.repo.transitionCalls != 0 {
					t.Errorf("Transition MUST NOT be called, got %d", h.repo.transitionCalls)
				}
			},
			"pg: connection refused"},
		{"list_my_user_lookup", "GET", "/me/applications", true, false,
			func(h *harness) { h.userRepo.getByCognitoSubErr = errors.New("boom: identity unreachable") },
			func(t *testing.T, h *harness) {
				if h.repo.listByCandidateCalls != 0 {
					t.Errorf("identity failed; ListByCandidate MUST NOT be called, got %d", h.repo.listByCandidateCalls)
				}
			},
			"boom: identity unreachable"},
		{"list_my_list", "GET", "/me/applications", true, false,
			func(h *harness) {
				h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
				h.repo.listByCandidateErr = errors.New("pg: read timeout")
			},
			func(t *testing.T, h *harness) {
				if h.repo.listByCandidateCalls != 1 {
					t.Errorf("ListByCandidate must be called once, got %d", h.repo.listByCandidateCalls)
				}
			},
			"pg: read timeout"},
		{"recruiter_list", "GET", "/jobs/" + jobID.String() + "/applications", false, true,
			func(h *harness) { h.repo.listByJobErr = errors.New("pg: read timeout") },
			func(t *testing.T, h *harness) {
				if h.repo.listByJobCalls != 1 {
					t.Errorf("ListByJob must be called once, got %d", h.repo.listByJobCalls)
				}
				if h.repo.createCalls != 0 || h.repo.getByIDCalls != 0 || h.repo.transitionCalls != 0 {
					t.Errorf("only ListByJob expected; create=%d getByID=%d transition=%d",
						h.repo.createCalls, h.repo.getByIDCalls, h.repo.transitionCalls)
				}
			},
			"pg: read timeout"},
		{"recruiter_detail", "GET", "/jobs/" + jobID.String() + "/applications/" + appID.String(), false, true,
			func(h *harness) { h.repo.getByIDErr = errors.New("pg: read timeout") },
			func(t *testing.T, h *harness) {
				if h.repo.getByIDCalls != 1 {
					t.Errorf("GetByID must be called once, got %d", h.repo.getByIDCalls)
				}
			},
			"pg: read timeout"},
		{"transition_read", "PATCH", "/jobs/" + jobID.String() + "/applications/" + appID.String() + "/transition", false, true,
			func(h *harness) { h.repo.getByIDErr = errors.New("pg: read timeout") },
			func(t *testing.T, h *harness) {
				if h.repo.getByIDCalls != 1 {
					t.Errorf("GetByID must be called once, got %d", h.repo.getByIDCalls)
				}
				if h.repo.transitionCalls != 0 {
					t.Errorf("read failed; Transition MUST NOT be called, got %d", h.repo.transitionCalls)
				}
			},
			"pg: read timeout"},
		{"transition_write", "PATCH", "/jobs/" + jobID.String() + "/applications/" + appID.String() + "/transition", false, true,
			func(h *harness) {
				h.repo.getByIDApp = submittedApp()
				h.repo.transitionErr = errors.New("pg: write timeout")
			},
			func(t *testing.T, h *harness) {
				if h.repo.getByIDCalls != 1 {
					t.Errorf("GetByID must be called once, got %d", h.repo.getByIDCalls)
				}
				if h.repo.transitionCalls != 1 {
					t.Errorf("Transition must be called once, got %d", h.repo.transitionCalls)
				}
				if h.repo.createCalls != 0 {
					t.Errorf("Create MUST NOT be called, got %d", h.repo.createCalls)
				}
			},
			"pg: write timeout"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logBuf := captureTransportSlog(t)
			h := newHarness()
			tc.setUp(h)
			req := httptest.NewRequest(tc.method, tc.path,
				strings.NewReader(`{"status":"in_review","cover_letter":"hi"}`))
			req.Header.Set("Content-Type", "application/json")
			if tc.injectSub {
				req = withClaims(req, "sub-internal")
			}
			if tc.injectCC {
				req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
			}
			w := httptest.NewRecorder()
			h.router.ServeHTTP(w, req)

			assertTransportEnvelope(t, w, http.StatusInternalServerError, httpjson.CodeInternalError,
				"an internal error occurred", tc.inject)
			tc.assertCounters(t, h)

			rec := lastSlogRecord(t, logBuf)
			if rec["method"] != tc.method {
				t.Errorf("slog method: want %q, got %v", tc.method, rec["method"])
			}
			if rec["path"] != tc.path {
				t.Errorf("slog path: want %q, got %v", tc.path, rec["path"])
			}
			if errAttr, ok := rec["error"].(string); !ok || !strings.Contains(errAttr, tc.inject) {
				t.Errorf("slog error: want to contain %q, got %v", tc.inject, rec["error"])
			}
		})
	}
}
