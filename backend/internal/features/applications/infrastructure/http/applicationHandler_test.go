// Unit tests for the applications HTTP handler.
//
// These tests build the real ApplicationService against handler-side
// stubs (mirroring the design §6 inventory items 3 + 4), mount the five
// routes on a chi router, and exercise the per-endpoint contracts:
//
//   - apply (applyToJob): 10 tests (S20–S29, S44–S50 subset)
//   - my applications (listMyApplications): 4 tests (S52, S55, S57–S60)
//   - recruiter list (listJobApplications): 4 tests (S65–S67, S81)
//   - recruiter detail (getApplication): 6 tests (S73, S76–S80, S82)
//   - transition (transitionApplication): 10 tests (S83–S102)
//
// The 401/403 short-circuit for the gated routes is covered by the AST
// guards in main_test.go (TestApplicationApply_BehindRequireAuth /
// TestApplicationRoutes_AllRecruiterGated); the handler tests focus on
// the per-endpoint contract.
package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	applicationsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/usecases"
	applicationsentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	applicationsrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/repositories"
	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	identityentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/entities"
	identitysecurity "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// --- handler-side stubs (design §6 items 3 + 4) -------------------------

// stubApplicationRepo (handler) satisfies usecases.ApplicationRepoPort.
// Mirrors the use-case test stub but lives in this file so the handler
// tests stay self-contained. Programmable per-method errors + call
// capture so tests can assert the wire-level outcomes.
type handlerStubRepo struct {
	mu sync.Mutex

	createErr   error
	createApp   *applicationsentities.Application
	createCalls int

	getByIDErr   error
	getByIDApp   *applicationsentities.ApplicationWithCandidate
	getByIDCalls int

	listByJobErr   error
	listByJobApps  []applicationsentities.ApplicationWithCandidate
	listByJobCalls int

	listByCandidateErr   error
	listByCandidateApps  []applicationsentities.MyApplication
	listByCandidateCalls int

	transitionErr   error
	transitionApp   *applicationsentities.Application
	transitionCalls int
	// lastTransitionEvent is the AuditEvent the use case passed to Transition
	// on the most recent invocation — the handler tests assert the actor came
	// from CompanyContext.UserID, not from any body field.
	lastTransitionEvent *auditentities.AuditEvent
}

func (s *handlerStubRepo) Create(ctx context.Context, p applicationsrepositories.CreateParams, event auditentities.AuditEvent) (*applicationsentities.Application, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.createCalls++
	if s.createErr != nil {
		return nil, s.createErr
	}
	if s.createApp != nil {
		return s.createApp, nil
	}
	app := &applicationsentities.Application{
		ID:          p.ID,
		JobID:       p.JobID,
		CandidateID: p.CandidateID,
		Status:      applicationsvalueobjects.Submitted,
		CreatedAt:   fixedTime(),
		UpdatedAt:   fixedTime(),
	}
	if p.Source != nil {
		v := *p.Source
		app.Source = &v
	}
	if p.CoverLetter != nil {
		v := *p.CoverLetter
		app.CoverLetter = &v
	}
	return app, nil
}

func (s *handlerStubRepo) GetByID(ctx context.Context, id, jobID, companyID uuid.UUID) (*applicationsentities.ApplicationWithCandidate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.getByIDCalls++
	if s.getByIDErr != nil {
		return nil, s.getByIDErr
	}
	return s.getByIDApp, nil
}

func (s *handlerStubRepo) ListByJob(ctx context.Context, jobID, companyID uuid.UUID) ([]applicationsentities.ApplicationWithCandidate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listByJobCalls++
	if s.listByJobErr != nil {
		return nil, s.listByJobErr
	}
	return s.listByJobApps, nil
}

func (s *handlerStubRepo) ListByCandidate(ctx context.Context, candidateID uuid.UUID) ([]applicationsentities.MyApplication, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.listByCandidateCalls++
	if s.listByCandidateErr != nil {
		return nil, s.listByCandidateErr
	}
	return s.listByCandidateApps, nil
}

func (s *handlerStubRepo) Transition(ctx context.Context, id, jobID, companyID uuid.UUID, from, to applicationsvalueobjects.ApplicationStatus, event auditentities.AuditEvent) (*applicationsentities.Application, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.transitionCalls++
	ev := event
	s.lastTransitionEvent = &ev
	if s.transitionErr != nil {
		return nil, s.transitionErr
	}
	if s.transitionApp != nil {
		return s.transitionApp, nil
	}
	return &applicationsentities.Application{
		ID: id, JobID: jobID, CandidateID: uuid.Nil, Status: to,
		CreatedAt: fixedTime(), UpdatedAt: fixedTime(),
	}, nil
}

// --- handler-side stubUserRepo ------------------------------------------

type handlerStubUserRepo struct {
	getByCognitoSubErr  error
	getByCognitoSubUser *identityentities.User
}

func (s *handlerStubUserRepo) GetByCognitoSub(ctx context.Context, cognitoSub string) (*identityentities.User, error) {
	if s.getByCognitoSubErr != nil {
		return nil, s.getByCognitoSubErr
	}
	if s.getByCognitoSubUser != nil {
		return s.getByCognitoSubUser, nil
	}
	return nil, errors.New("handlerStubUserRepo: not configured")
}

func (s *handlerStubUserRepo) GetByID(ctx context.Context, id uuid.UUID) (*identityentities.User, error) {
	return nil, errors.New("not used")
}

func (s *handlerStubUserRepo) Create(ctx context.Context, user *identityentities.User) (*identityentities.User, error) {
	return nil, errors.New("not used")
}

// --- test fixture: build a fully wired handler + chi router --------------

type harness struct {
	repo     *handlerStubRepo
	userRepo *handlerStubUserRepo
	handler  *ApplicationHandler
	router   chi.Router
}

// newHarness wires the real ApplicationService over the stubs, mounts
// the five routes on a chi router with the same shape main.go uses, and
// returns the bundle. The router uses the `With(requireAuth, ...)`
// shape in front of each handler — but the handlers themselves enforce
// the per-method gates (the `With(...)` wrapper is exercised in main.go's
// real wiring; here we mount directly because we're testing the handlers,
// not the middleware).
func newHarness() *harness {
	repo := &handlerStubRepo{}
	userRepo := &handlerStubUserRepo{}
	svc := applicationsusecases.NewApplicationService(repo, userRepo)
	h := NewApplicationHandler(svc)

	r := chi.NewRouter()
	hh := h.ApplicationHandlers()
	r.Post("/jobs/{jobId}/applications", hh.ApplyToJob)
	r.Get("/me/applications", hh.ListMyApplications)
	r.Get("/jobs/{jobId}/applications", hh.ListJobApplications)
	r.Get("/jobs/{jobId}/applications/{id}", hh.GetApplication)
	r.Patch("/jobs/{jobId}/applications/{id}/transition", hh.TransitionApplication)

	return &harness{repo: repo, userRepo: userRepo, handler: h, router: r}
}

// withClaims returns a copy of r with the JWT claims injected into the
// context. Mirrors the production wiring (identityhttp.RequireAuth
// injects Claims).
func withClaims(r *http.Request, sub string) *http.Request {
	claims := identitysecurity.Claims{Subject: sub}
	ctx := identitysecurity.ContextWithClaims(r.Context(), claims)
	return r.WithContext(ctx)
}

// withCompanyContext returns a copy of r with the CompanyContext
// injected (mirrors RequireCompanyRole).
func withCompanyContext(r *http.Request, cc identitysecurity.CompanyContext) *http.Request {
	ctx := identitysecurity.ContextWithCompanyContext(r.Context(), cc)
	return r.WithContext(ctx)
}

// fixedTime returns a stable time.Time so JSON assertions are deterministic.
func fixedTime() time.Time {
	return time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
}

// makeRecruiterID returns a stable, non-nil actor id for the transition-path
// CompanyContext literals (D8: the handler must pass cc.UserID through to the
// use case so the Transitioned audit event records the acting recruiter).
func makeRecruiterID() uuid.UUID {
	return uuid.MustParse("018f0000-0000-7000-8000-0000000000dd")
}

// --- apply tests ----------------------------------------------------------

func TestApplyToJob_MissingClaims401(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+uuid.New().String()+"/applications", strings.NewReader("{}"))
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d (body %s)", w.Code, w.Body.String())
	}
}

func TestApplyToJob_InvalidJobID400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/not-a-uuid/applications", strings.NewReader("{}"))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d (body %s)", w.Code, w.Body.String())
	}
	// Catalog canonical message for direct parse errors.
	if !strings.Contains(w.Body.String(), "invalid request") {
		t.Errorf("want body to contain 'invalid request', got %s", w.Body.String())
	}
}

func TestApplyToJob_InvalidJSON400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+uuid.New().String()+"/applications", strings.NewReader("{not json"))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
	// Catalog canonical message for direct parse errors.
	if !strings.Contains(w.Body.String(), "invalid request") {
		t.Errorf("want body to contain 'invalid request', got %s", w.Body.String())
	}
}

func TestApplyToJob_UnknownSub401(t *testing.T) {
	h := newHarness()
	h.userRepo.getByCognitoSubErr = identityentities.ErrUserNotFound
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+uuid.New().String()+"/applications", strings.NewReader("{}"))
	req = withClaims(req, "sub-unknown")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d (body %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "unauthenticated") {
		t.Errorf("want body to contain 'unauthenticated', got %s", w.Body.String())
	}
}

func TestApplyToJob_CoverLetterEmpty400(t *testing.T) {
	h := newHarness()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+uuid.New().String()+"/applications",
		strings.NewReader(`{"cover_letter":"   "}`))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d (body %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "cover_letter") {
		t.Errorf("want body to mention cover_letter, got %s", w.Body.String())
	}
}

func TestApplyToJob_UnknownSource400(t *testing.T) {
	h := newHarness()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+uuid.New().String()+"/applications",
		strings.NewReader(`{"source":"newspaper"}`))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d (body %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "invalid source") {
		t.Errorf("want body to contain 'invalid source', got %s", w.Body.String())
	}
}

func TestApplyToJob_NotApplicable404(t *testing.T) {
	h := newHarness()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
	h.repo.createErr = applicationsentities.ErrJobNotApplicable
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+uuid.New().String()+"/applications", strings.NewReader("{}"))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d (body %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "job not applicable") {
		t.Errorf("want body to contain 'job not applicable', got %s", w.Body.String())
	}
}

func TestApplyToJob_AlreadyApplied409(t *testing.T) {
	h := newHarness()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
	h.repo.createErr = applicationsentities.ErrAlreadyApplied
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+uuid.New().String()+"/applications", strings.NewReader("{}"))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusConflict {
		t.Errorf("want 409, got %d (body %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "already applied") {
		t.Errorf("want body to contain 'already applied', got %s", w.Body.String())
	}
}

func TestApplyToJob_Success201BodyShape(t *testing.T) {
	h := newHarness()
	candidateID := uuid.New()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: candidateID}
	h.repo.createApp = &applicationsentities.Application{
		ID:          uuid.MustParse("018e0000-0000-7000-8000-000000000777"),
		JobID:       uuid.New(),
		CandidateID: candidateID,
		Status:      applicationsvalueobjects.Submitted,
		CreatedAt:   fixedTime(),
		UpdatedAt:   fixedTime(),
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/jobs/"+h.repo.createApp.JobID.String()+"/applications",
		strings.NewReader(`{"source":"linkedin","cover_letter":"Hi"}`))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d (body %s)", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["status"] != "submitted" {
		t.Errorf("status: want 'submitted', got %v", body["status"])
	}
	if body["candidate_id"] != candidateID.String() {
		t.Errorf("candidate_id: want %v (JWT-derived), got %v", candidateID, body["candidate_id"])
	}
	// cv_s3_key / anonymized_at MUST be absent (D11).
	if _, ok := body["cv_s3_key"]; ok {
		t.Errorf("body MUST NOT contain cv_s3_key, got %v", body["cv_s3_key"])
	}
	if _, ok := body["anonymized_at"]; ok {
		t.Errorf("body MUST NOT contain anonymized_at, got %v", body["anonymized_at"])
	}
}

func TestApplyToJob_ServerManagedFieldsIgnored(t *testing.T) {
	h := newHarness()
	candidateID := uuid.New()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: candidateID}
	h.repo.createApp = &applicationsentities.Application{
		ID:          uuid.MustParse("018e0000-0000-7000-8000-000000000778"),
		JobID:       uuid.New(),
		CandidateID: candidateID,
		Status:      applicationsvalueobjects.Submitted,
		CreatedAt:   fixedTime(),
		UpdatedAt:   fixedTime(),
	}
	w := httptest.NewRecorder()
	jobID := h.repo.createApp.JobID.String()
	// Body contains server-managed fields the client MUST NOT be allowed to set.
	body := `{"id":"` + uuid.New().String() +
		`","candidate_id":"` + uuid.New().String() +
		`","status":"hired","cv_s3_key":"x","anonymized_at":"2026-01-01T00:00:00Z"}`
	req := httptest.NewRequest("POST", "/jobs/"+jobID+"/applications", strings.NewReader(body))
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d", w.Code)
	}
	// The response MUST echo the server-supplied candidate_id (JWT-derived),
	// NOT the one from the body.
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if resp["candidate_id"] != candidateID.String() {
		t.Errorf("candidate_id: want server-supplied %v, got %v", candidateID, resp["candidate_id"])
	}
	if resp["status"] != "submitted" {
		t.Errorf("status: want 'submitted', got %v (client tried 'hired')", resp["status"])
	}
}

// --- my applications tests ----------------------------------------------

func TestListMyApplications_MissingClaims401(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/me/applications", nil)
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d", w.Code)
	}
}

func TestListMyApplications_UnknownSub401(t *testing.T) {
	h := newHarness()
	h.userRepo.getByCognitoSubErr = identityentities.ErrUserNotFound
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/me/applications", nil)
	req = withClaims(req, "sub-unknown")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("want 401, got %d", w.Code)
	}
}

func TestListMyApplications_EmptyList200(t *testing.T) {
	h := newHarness()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: uuid.New()}
	h.repo.listByCandidateApps = nil // use case normalizes to non-nil empty
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/me/applications", nil)
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("want 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"applications":[]`) {
		t.Errorf("want body to contain '\"applications\":[]', got %s", w.Body.String())
	}
}

func TestListMyApplications_ItemShapeHasJobSummary(t *testing.T) {
	h := newHarness()
	candidateID := uuid.New()
	h.userRepo.getByCognitoSubUser = &identityentities.User{ID: candidateID}
	h.repo.listByCandidateApps = []applicationsentities.MyApplication{
		{
			Application: applicationsentities.Application{
				ID:          uuid.New(),
				JobID:       uuid.New(),
				CandidateID: candidateID,
				Status:      applicationsvalueobjects.InReview,
				Source:      ptr(applicationsvalueobjects.LinkedIn),
				CreatedAt:   fixedTime(),
				UpdatedAt:   fixedTime(),
			},
			Job: applicationsentities.JobSummary{
				ID: uuid.New(), Title: "Backend Engineer",
				CompanyID: uuid.New(), CompanyName: "Acme SA",
			},
		},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/me/applications", nil)
	req = withClaims(req, "sub-1")
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body %s)", w.Code, w.Body.String())
	}
	var body struct {
		Applications []map[string]any `json:"applications"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Applications) != 1 {
		t.Fatalf("want 1 application, got %d", len(body.Applications))
	}
	item := body.Applications[0]
	if item["status"] != "in_review" {
		t.Errorf("status: want in_review, got %v", item["status"])
	}
	if item["source"] != "linkedin" {
		t.Errorf("source: want linkedin, got %v", item["source"])
	}
	// Job summary fields present.
	job, ok := item["job"].(map[string]any)
	if !ok {
		t.Fatalf("want job summary, got %v", item["job"])
	}
	if job["title"] != "Backend Engineer" {
		t.Errorf("job.title: want 'Backend Engineer', got %v", job["title"])
	}
	company, ok := job["company"].(map[string]any)
	if !ok {
		t.Fatalf("want job.company, got %v", job["company"])
	}
	if company["name"] != "Acme SA" {
		t.Errorf("job.company.name: want 'Acme SA', got %v", company["name"])
	}
	// Reserved / extraneous fields MUST be absent.
	for _, forbidden := range []string{"cv_s3_key", "anonymized_at", "candidate_id", "salary_min", "salary_max", "description", "location"} {
		if _, present := item[forbidden]; present {
			t.Errorf("item MUST NOT contain %q, got %v", forbidden, item[forbidden])
		}
	}
}

// --- recruiter list tests ------------------------------------------------

func TestListJobApplications_InvalidJobID400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/not-a-uuid/applications", nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
	// Catalog canonical message for direct parse errors.
	if !strings.Contains(w.Body.String(), "invalid request") {
		t.Errorf("want body to contain 'invalid request', got %s", w.Body.String())
	}
}

func TestListJobApplications_CrossCompany404(t *testing.T) {
	h := newHarness()
	h.repo.listByJobErr = applicationsentities.ErrApplicationNotFound
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications", nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d (body %s)", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "application not found") {
		t.Errorf("want body to contain 'application not found', got %s", w.Body.String())
	}
}

func TestListJobApplications_Empty200(t *testing.T) {
	h := newHarness()
	h.repo.listByJobApps = nil // adapter normalizes to non-nil empty
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications", nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("want 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"applications":[]`) {
		t.Errorf("want empty applications array, got %s", w.Body.String())
	}
}

func TestListJobApplications_ItemShapeHasCandidateSnippet(t *testing.T) {
	h := newHarness()
	h.repo.listByJobApps = []applicationsentities.ApplicationWithCandidate{
		{
			Application: applicationsentities.Application{
				ID: uuid.New(), JobID: uuid.New(), CandidateID: uuid.New(),
				Status: applicationsvalueobjects.Submitted,
			},
			Candidate: applicationsentities.CandidateSnippet{
				UserID:            uuid.New(),
				FullName:          "Alice Engineer",
				ProfessionalTitle: ptrS("Senior Go"),
				YearsOfExperience: ptrI(7),
			},
		},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications", nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var body struct {
		Applications []map[string]any `json:"applications"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	item := body.Applications[0]
	candidate, ok := item["candidate"].(map[string]any)
	if !ok {
		t.Fatalf("want candidate snippet, got %v", item["candidate"])
	}
	if candidate["full_name"] != "Alice Engineer" {
		t.Errorf("candidate.full_name: want 'Alice Engineer', got %v", candidate["full_name"])
	}
	if candidate["professional_title"] != "Senior Go" {
		t.Errorf("candidate.professional_title: want 'Senior Go', got %v", candidate["professional_title"])
	}
	// PII minimization: no salary / birth_date / phone / email.
	for _, forbidden := range []string{"salary_min", "salary_max", "birth_date", "phone", "email"} {
		if _, present := candidate[forbidden]; present {
			t.Errorf("candidate MUST NOT contain %q (D12 PII), got %v", forbidden, candidate[forbidden])
		}
	}
}

// --- recruiter detail tests ---------------------------------------------

func TestGetApplication_InvalidJobID400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/not-a-uuid/applications/"+uuid.New().String(), nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestGetApplication_InvalidAppID400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications/not-a-uuid", nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
	// Catalog canonical message for direct parse errors.
	if !strings.Contains(w.Body.String(), "invalid request") {
		t.Errorf("want body to contain 'invalid request', got %s", w.Body.String())
	}
}

func TestGetApplication_CrossCompany404(t *testing.T) {
	h := newHarness()
	h.repo.getByIDErr = applicationsentities.ErrApplicationNotFound
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String(), nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", w.Code)
	}
}

func TestGetApplication_NonExistent404(t *testing.T) {
	h := newHarness()
	h.repo.getByIDErr = applicationsentities.ErrApplicationNotFound
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String(), nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", w.Code)
	}
}

func TestGetApplication_Success200(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{
			ID: uuid.New(), JobID: uuid.New(), CandidateID: uuid.New(),
			Status: applicationsvalueobjects.InReview,
		},
		Candidate: applicationsentities.CandidateSnippet{
			UserID: uuid.New(), FullName: "Alice",
		},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String(), nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body %s)", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "in_review" {
		t.Errorf("status: want in_review, got %v", body["status"])
	}
}

func TestGetApplication_CandidateSnippetPII(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{
			ID: uuid.New(), JobID: uuid.New(), CandidateID: uuid.New(),
			Status: applicationsvalueobjects.Submitted,
		},
		Candidate: applicationsentities.CandidateSnippet{
			UserID: uuid.New(), FullName: "Alice",
			ProfessionalTitle: ptrS("Engineer"),
			YearsOfExperience: ptrI(7),
		},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String(), nil)
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	candidate := body["candidate"].(map[string]any)
	for _, forbidden := range []string{"salary_min", "salary_max", "salary_currency", "birth_date", "phone", "email", "skills", "languages", "expected_salary", "city", "address", "bio"} {
		if _, present := candidate[forbidden]; present {
			t.Errorf("candidate MUST NOT contain %q (D12 PII), got %v", forbidden, candidate[forbidden])
		}
	}
}

// --- transition tests ----------------------------------------------------

func TestTransitionApplication_InvalidJobID400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/not-a-uuid/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"in_review"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestTransitionApplication_InvalidAppID400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/not-a-uuid/transition",
		strings.NewReader(`{"status":"in_review"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestTransitionApplication_InvalidJSON400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader("{not json"))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestTransitionApplication_MissingStatus400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "status is required") {
		t.Errorf("want body to contain 'status is required', got %s", w.Body.String())
	}
}

func TestTransitionApplication_UnknownStatus400(t *testing.T) {
	h := newHarness()
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"withdrawn"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
}

func TestTransitionApplication_IllegalTransition400(t *testing.T) {
	h := newHarness()
	// Stub the read-for-update with status=submitted so submitted→rejected
	// hits the matrix branch.
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{
			Status: applicationsvalueobjects.Submitted,
		},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"rejected"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("want 400, got %d", w.Code)
	}
	// JSON HTML-escapes ">" as \u003e; check the unescaped form.
	body := w.Body.String()
	if !strings.Contains(body, "invalid status transition") || !strings.Contains(body, "submitted") || !strings.Contains(body, "rejected") {
		t.Errorf("want body to mention 'invalid status transition: submitted -> rejected', got %s", body)
	}
}

func TestTransitionApplication_Success200(t *testing.T) {
	h := newHarness()
	// The use case will GetByID first → stub submitted → matrix allows
	// submitted→in_review → Transition called → stub returns in_review row.
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{
			Status: applicationsvalueobjects.Submitted,
		},
	}
	h.repo.transitionApp = &applicationsentities.Application{
		ID: uuid.New(), JobID: uuid.New(), CandidateID: uuid.New(),
		Status: applicationsvalueobjects.InReview, CreatedAt: fixedTime(), UpdatedAt: fixedTime(),
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"in_review"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body %s)", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body["status"] != "in_review" {
		t.Errorf("status: want in_review, got %v", body["status"])
	}
}

func TestTransitionApplication_CrossCompany404(t *testing.T) {
	h := newHarness()
	h.repo.getByIDErr = applicationsentities.ErrApplicationNotFound
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"in_review"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", w.Code)
	}
}

func TestTransitionApplication_LostRace404(t *testing.T) {
	h := newHarness()
	// submitted → in_review passes the matrix, but the SQL guard loses
	// the race (concurrent transition) so Transition returns ErrApplicationNotFound.
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{
			Status: applicationsvalueobjects.Submitted,
		},
	}
	h.repo.transitionErr = applicationsentities.ErrApplicationNotFound
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"in_review"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("want 404, got %d", w.Code)
	}
}

// TestTransitionApplication_MissingUserIDReturns500 pins D8's fail-closed
// wire contract: a CompanyContext with zero UserID (middleware bypassed or
// mis-wired) → 500 internal server error, and the transition is never
// attempted (no status change, no event).
func TestTransitionApplication_MissingUserIDReturns500(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{
			Status: applicationsvalueobjects.Submitted,
		},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"in_review"}`))
	// Note: UserID deliberately omitted → zero value uuid.Nil.
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Errorf("want 500, got %d (body %s)", w.Code, w.Body.String())
	}
	// Catalog canonical message for fail-closed internal error.
	if !strings.Contains(w.Body.String(), "an internal error occurred") {
		t.Errorf("want canonical 500 body, got %s", w.Body.String())
	}
	if h.repo.transitionCalls != 0 {
		t.Errorf("Transition MUST NOT be called when CompanyContext.UserID is missing; got %d calls", h.repo.transitionCalls)
	}
}

// TestTransitionApplication_BodyActorIDIgnored pins D8's actor provenance:
// the wire body may smuggle an actor_id, but encoding/json ignores it (the
// DTO has no such field) and the use case records the CompanyContext.UserID
// as the event actor — never the body value.
func TestTransitionApplication_BodyActorIDIgnored(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{
			Status: applicationsvalueobjects.Submitted,
		},
	}
	h.repo.transitionApp = &applicationsentities.Application{
		ID: uuid.New(), JobID: uuid.New(), CandidateID: uuid.New(),
		Status: applicationsvalueobjects.InReview, CreatedAt: fixedTime(), UpdatedAt: fixedTime(),
	}
	w := httptest.NewRecorder()
	bodyActor := uuid.New().String()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"in_review","actor_id":"`+bodyActor+`"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body %s)", w.Code, w.Body.String())
	}
	if h.repo.lastTransitionEvent == nil {
		t.Fatal("lastTransitionEvent: want non-nil (the use case must pass an event)")
	}
	if h.repo.lastTransitionEvent.ActorID == nil {
		t.Fatal("ActorID: want non-nil")
	}
	if *h.repo.lastTransitionEvent.ActorID != makeRecruiterID() {
		t.Errorf("ActorID: want CompanyContext.UserID %v, got %v (body actor_id must be ignored)",
			makeRecruiterID(), *h.repo.lastTransitionEvent.ActorID)
	}
	if strings.Contains(w.Body.String(), bodyActor) {
		t.Errorf("the body actor_id %q must never reach the wire or the event", bodyActor)
	}
}

// catalogEnv decodes {"error":string, "code":string, ...}.
type catalogEnv struct {
	Error string `json:"error"`
	Code  string `json:"code"`
}

// assertCatalogEnvelope asserts exact HTTP status, catalog code, and
// canonical generic message for internal_error (no injected detail).
func assertCatalogEnvelope(t testing.TB, w *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	if w.Code != wantStatus {
		t.Errorf("status: want %d, got %d (body %s)", wantStatus, w.Code, w.Body.String())
	}
	var env catalogEnv
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode body as catalog envelope: %v (body %s)", err, w.Body.String())
	}
	if env.Code == "" {
		t.Errorf("code: want %q, got empty (body %s)", wantCode, w.Body.String())
		return
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
	if wantCode == "internal_error" {
		if !strings.Contains(env.Error, "an internal error occurred") {
			t.Errorf("code=internal_error: want canonical generic message, got %q", env.Error)
		}
		if strings.Contains(w.Body.String(), "missing actor") || strings.Contains(w.Body.String(), "kaboom") || strings.Contains(w.Body.String(), "surprise") {
			t.Errorf("code=internal_error MUST NOT contain injected detail, got %s", w.Body.String())
		}
	}
}

// Direct classifier: 12 cases (11 sentinels + unknown default).
func TestClassifyApplicationError_CatalogDefinition(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantCode   httpjson.Code
		wantStatus int
		wantMsg    string
	}{
		// sentinels with exact messages
		{"UnknownSubject_unauthenticated", applicationsusecases.ErrUnknownSubject, httpjson.CodeUnauthenticated, http.StatusUnauthorized, "unauthenticated"},
		{"ApplicationNotFound_notFound", applicationsentities.ErrApplicationNotFound, httpjson.CodeNotFound, http.StatusNotFound, "application not found"},
		{"JobNotApplicable_notFound", applicationsentities.ErrJobNotApplicable, httpjson.CodeNotFound, http.StatusNotFound, "job not applicable"},
		{"AlreadyApplied_alreadyExists", applicationsentities.ErrAlreadyApplied, httpjson.CodeAlreadyExists, http.StatusConflict, "already applied"},
		{"StatusRequired_invalidRequest", applicationsentities.ErrStatusRequired, httpjson.CodeInvalidRequest, http.StatusBadRequest, "status is required"},
		{"CoverLetterEmpty_invalidRequest", applicationsentities.ErrCoverLetterEmpty, httpjson.CodeInvalidRequest, http.StatusBadRequest, "cover_letter must not be empty"},
		{"CoverLetterTooLong_invalidRequest", applicationsentities.ErrCoverLetterTooLong, httpjson.CodeInvalidRequest, http.StatusBadRequest, "cover_letter must be at most 2000 characters"},
		{"InvalidSource_invalidRequest", applicationsvalueobjects.ErrInvalidSource, httpjson.CodeInvalidRequest, http.StatusBadRequest, "invalid source"},
		{"InvalidApplicationReference_invalidRequest", applicationsentities.ErrInvalidApplicationReference, httpjson.CodeInvalidRequest, http.StatusBadRequest, "invalid application reference"},
		{"InvalidStatusTransition_directSentinel", applicationsvalueobjects.ErrInvalidStatusTransition, httpjson.CodeInvalidStatusTransition, http.StatusBadRequest, "invalid status transition"},
		{"MissingActorIdentity_internalError", applicationsusecases.ErrMissingActorIdentity, httpjson.CodeInternalError, http.StatusInternalServerError, "an internal error occurred"},
		// unknown/default
		{"unknown_default", errors.New("kaboom"), httpjson.CodeInternalError, http.StatusInternalServerError, "an internal error occurred"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := classifyApplicationError(tt.err)
			if def.Code != tt.wantCode {
				t.Errorf("code: want %q, got %q", tt.wantCode, def.Code)
			}
			if def.Status != tt.wantStatus {
				t.Errorf("status: want %d, got %d", tt.wantStatus, def.Status)
			}
			if def.Message != tt.wantMsg {
				t.Errorf("message: want %q, got %q", tt.wantMsg, def.Message)
			}
		})
	}
}

// Wrapped sentinels: 9 cases prove errors.Is chain resolution.
func TestClassifyApplicationError_WrappedSentinals(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		wantCode httpjson.Code
		wantMsg  string
	}{
		{"ApplicationNotFound_wrapped", fmt.Errorf("repository failed: %w", applicationsentities.ErrApplicationNotFound), httpjson.CodeNotFound, "application not found"},
		{"JobNotApplicable_wrapped", fmt.Errorf("service: %w", applicationsentities.ErrJobNotApplicable), httpjson.CodeNotFound, "job not applicable"},
		{"AlreadyApplied_wrapped", fmt.Errorf("db error: %w", applicationsentities.ErrAlreadyApplied), httpjson.CodeAlreadyExists, "already applied"},
		{"CoverLetterEmpty_wrapped", fmt.Errorf("validation: %w", applicationsentities.ErrCoverLetterEmpty), httpjson.CodeInvalidRequest, "cover_letter must not be empty"},
		{"InvalidSource_wrapped", fmt.Errorf("handler: %w", applicationsvalueobjects.ErrInvalidSource), httpjson.CodeInvalidRequest, "invalid source"},
		{"InvalidStatusTransition_wrappedMatrixCollapses", fmt.Errorf("transition rejected: %w", applicationsvalueobjects.ErrInvalidStatusTransition), httpjson.CodeInvalidStatusTransition, "invalid status transition"},
		{"InvalidStatusTransition_preservesWrappedDetail", fmt.Errorf("%w: submitted -> rejected", applicationsvalueobjects.ErrInvalidStatusTransition), httpjson.CodeInvalidStatusTransition, "invalid status transition: submitted -> rejected"},
		{"InvalidStatusTransition_nonSentinelWrapperFallsThrough", fmt.Errorf("repository failed: %w", fmt.Errorf("invalid status transition: in_review -> hired")), httpjson.CodeInternalError, "an internal error occurred"},
		{"MissingActorIdentity_wrapped", fmt.Errorf("internal: %w", applicationsusecases.ErrMissingActorIdentity), httpjson.CodeInternalError, "an internal error occurred"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			def := classifyApplicationError(tt.err)
			if def.Code != tt.wantCode {
				t.Errorf("code: want %q, got %q", tt.wantCode, def.Code)
			}
			if def.Message != tt.wantMsg {
				t.Errorf("message: want %q, got %q", tt.wantMsg, def.Message)
			}
		})
	}
}

// triangulation: not_found code shared by two sentinels with different messages
func TestTriangulation_NotFoundMessagesDiffer(t *testing.T) {
	defApp := classifyApplicationError(applicationsentities.ErrApplicationNotFound)
	defJob := classifyApplicationError(applicationsentities.ErrJobNotApplicable)
	if defApp.Code != httpjson.CodeNotFound || defJob.Code != httpjson.CodeNotFound {
		t.Errorf("codes: want not_found, got %q and %q", defApp.Code, defJob.Code)
	}
	if defApp.Message != "application not found" || defJob.Message != "job not applicable" || defApp.Message == defJob.Message {
		t.Errorf("messages: got application=%q job=%q", defApp.Message, defJob.Message)
	}
}

// triangulation: invalid_request code shared by multiple sentinels with different messages
func TestTriangulation_InvalidRequestMessagesDiffer(t *testing.T) {
	defStatus := classifyApplicationError(applicationsentities.ErrStatusRequired)
	defCover := classifyApplicationError(applicationsentities.ErrCoverLetterEmpty)
	defSource := classifyApplicationError(applicationsvalueobjects.ErrInvalidSource)
	if defStatus.Code != httpjson.CodeInvalidRequest || defCover.Code != httpjson.CodeInvalidRequest || defSource.Code != httpjson.CodeInvalidRequest {
		t.Errorf("codes: want invalid_request, got %q, %q, %q", defStatus.Code, defCover.Code, defSource.Code)
	}
	if defStatus.Message != "status is required" || defCover.Message != "cover_letter must not be empty" || defSource.Message != "invalid source" || defStatus.Message == defCover.Message || defCover.Message == defSource.Message || defStatus.Message == defSource.Message {
		t.Errorf("messages: got %q, %q, %q", defStatus.Message, defCover.Message, defSource.Message)
	}
}

// Handler catalog compatibility (4 cases).
func TestTransitionApplication_MissingCompanyContextCatalogCode500(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{Status: applicationsvalueobjects.Submitted},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"in_review"}`))
	// CompanyContext deliberately omitted.
	h.router.ServeHTTP(w, req)
	assertCatalogEnvelope(t, w, http.StatusInternalServerError, "internal_error")
}

func TestTransitionApplication_MissingStatusCatalogCode400(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{Status: applicationsvalueobjects.Submitted},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	assertCatalogEnvelope(t, w, http.StatusBadRequest, "invalid_request")
}

func TestTransitionApplication_IllegalTransitionCatalogCode400(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{Status: applicationsvalueobjects.Submitted},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"rejected"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	assertCatalogEnvelope(t, w, http.StatusBadRequest, "invalid_status_transition")
	body := w.Body.String()
	if !strings.Contains(body, "invalid status transition") || !strings.Contains(body, "submitted") || !strings.Contains(body, "rejected") {
		t.Errorf("want safe message with transition detail, got %s", body)
	}
}

func TestTransitionApplication_UnknownStatusCatalogCode400(t *testing.T) {
	h := newHarness()
	h.repo.getByIDApp = &applicationsentities.ApplicationWithCandidate{
		Application: applicationsentities.Application{Status: applicationsvalueobjects.Submitted},
	}
	w := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/jobs/"+uuid.New().String()+"/applications/"+uuid.New().String()+"/transition",
		strings.NewReader(`{"status":"withdrawn"}`))
	req = withCompanyContext(req, identitysecurity.CompanyContext{CompanyID: uuid.New(), UserID: makeRecruiterID()})
	h.router.ServeHTTP(w, req)
	assertCatalogEnvelope(t, w, http.StatusBadRequest, "invalid_status_transition")
}

// --- helpers -------------------------------------------------------------

// ptr returns &v.
func ptr[T any](v T) *T { return &v }

// ptrS returns &v for a string.
func ptrS(v string) *string { return &v }

// ptrI returns &v for an int.
func ptrI(v int) *int { return &v }

// ensure unused imports are referenced (json, http, bytes etc. are used
// elsewhere; the timeValue is consumed by fixedTime()).
var _ = bytes.NewReader
