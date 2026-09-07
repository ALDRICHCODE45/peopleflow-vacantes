// Unit tests for the jobs HTTP handler.
//
// The handler depends on `*usecases.JobService`, which is a thin wrapper
// around the `repositories.JobRepository` port. To keep these tests
// fast and DB-free, we hand-roll a `stubRepo` that satisfies the port,
// route it through a real `JobService`, and stand up the handler over
// that. This mirrors the pattern in
// `companies/infrastructure/http/handler_test.go` — same severity of
// stubs, same `chi.Mux` mount on `/jobs`, same `httptest` round-trip.
package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/dtos"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// stubRepo is a hand-rolled stub of `repositories.JobRepository`. It
// captures every call so the assertions can pin what the use case (and
// thereby the handler) forwarded.
type stubRepo struct {
	searchCalls  int
	searchParams []repositories.SearchParams
	searchOut    []entities.Job
	searchErr    error

	getByIDCalls int
	lastGetByID  uuid.UUID
	getByIDOut   *entities.Job
	getByIDErr   error

	// Create (port-method stub added in jobs-create Phase 1.2 atomic
	// stub repair). Default ErrCompanyNotActive keeps the existing
	// list/detail tests passing; Phase 5's create handler tests
	// program this method via the dedicated writeStubHandlerRepo
	// fixture (updateJobHandler_test.go).
	createErr error

	// SoftDelete (port-method stub added in jobs-soft-delete Phase 1.2
	// atomic stub repair). Default nil keeps the port compilable and
	// the existing list/detail tests green; Phase 4's soft-delete
	// handler tests program this method via the dedicated
	// writeStubHandlerRepo fixture (updateJobHandler_test.go).
	softDeleteErr error
}

func (r *stubRepo) Search(_ context.Context, p repositories.SearchParams) ([]entities.Job, error) {
	r.searchCalls++
	r.searchParams = append(r.searchParams, p)
	if r.searchErr != nil {
		return nil, r.searchErr
	}
	out := make([]entities.Job, len(r.searchOut))
	copy(out, r.searchOut)
	return out, nil
}

func (r *stubRepo) GetByID(_ context.Context, id uuid.UUID) (*entities.Job, error) {
	r.getByIDCalls++
	r.lastGetByID = id
	if r.getByIDErr != nil {
		return nil, r.getByIDErr
	}
	if r.getByIDOut != nil {
		j := *r.getByIDOut
		return &j, nil
	}
	return nil, entities.ErrJobNotFound
}

// GetForUpdate is a port-method stub (Phase 1.4 stub repair). The
// default ErrJobNotFound return keeps the existing list/detail tests
// passing; Phase 5's handler tests program this method with a
// configurable write surface for the PATCH handler scenarios.
func (r *stubRepo) GetForUpdate(_ context.Context, _, _ uuid.UUID) (*entities.JobForUpdate, error) {
	return nil, entities.ErrJobNotFound
}

// Update is a port-method stub (Phase 1.4 stub repair). Default nil
// keeps the package compilable; Phase 5's handler tests assert on a
// captured Update call.
func (r *stubRepo) Update(_ context.Context, _, _ uuid.UUID, _ repositories.UpdatePatch, _ time.Time) error {
	return nil
}

// Create is a port-method stub (Phase 1.2 stub repair). Default
// ErrCompanyNotActive keeps the package compilable and matches the
// postgres adapter's 0-rows response; Phase 5's create handler tests
// program this method via the dedicated writeStubHandlerRepo
// fixture (updateJobHandler_test.go).
func (r *stubRepo) Create(_ context.Context, _, _ uuid.UUID, _ repositories.CreateJobParams) (*entities.JobForUpdate, error) {
	return nil, r.createErr
}

// SoftDelete is a port-method stub (jobs-soft-delete Phase 1.2 atomic
// stub repair). Default nil keeps the package compilable and matches
// the postgres adapter's success path; Phase 4's soft-delete handler
// tests program this method via the dedicated writeStubHandlerRepo
// fixture (updateJobHandler_test.go).
func (r *stubRepo) SoftDelete(_ context.Context, _, _ uuid.UUID, _ time.Time) error {
	return r.softDeleteErr
}

// Compile-time guard against accidental port drift.
var _ repositories.JobRepository = (*stubRepo)(nil)

// --- helpers --------------------------------------------------------------

// makeJob returns a synthetic published job the tests can return from
// the stub repo. Fields are stable and explicit so assertions can pin
// the wire shape without per-test boilerplate.
func makeJob(id uuid.UUID, withLocation bool, withSalary bool) entities.Job {
	j := entities.Job{
		ID:             id,
		Title:          "Backend Engineer",
		Description:    "Go + Postgres",
		WorkMode:       valueobjects.Remote,
		EmploymentType: valueobjects.FullTime,
		Seniority:      valueobjects.SeniorSeniority,
		JobStatus:      valueobjects.Published,
		SalaryCurrency: valueobjects.MXN,
		PublishedAt:    timePtr(time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)),
		Company: entities.CompanyRef{
			ID:   uuid.MustParse("018e0000-0000-7000-8000-000000000001"),
			Name: "Acme SA",
		},
	}
	if withLocation {
		l := "CDMX"
		j.Location = &l
	}
	if withSalary {
		smin := 40000
		smax := 60000
		j.SalaryMin = &smin
		j.SalaryMax = &smax
	}
	return j
}

func timePtr(t time.Time) *time.Time { return &t }
func strPtr(s string) *string        { return &s }
func intPtr(i int) *int              { return &i }

var _ = strPtr // silence unused — present for future refactors
var _ = intPtr // silence unused — present for future refactors

// newTestRouter wires the stub repo through a real use-case service
// into a new handler, mounted under `/jobs` to mirror the production
// mount path in `cmd/api/main.go`.
func newTestRouter(repo *stubRepo) *chi.Mux {
	svc := usecases.NewJobService(repo)
	h := NewJobHandler(svc)
	r := chi.NewRouter()
	r.Mount("/jobs", h.Routes())
	return r
}

// doGet fires a GET against the test router and returns the recorder.
func doGet(t *testing.T, router http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// captureSlogJSON swaps the process-global default slog logger for a
// JSON handler writing into the returned buffer and registers the
// restore via t.Cleanup. Tests using it MUST stay non-parallel because
// slog.Default is shared state.
func captureSlogJSON(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

// decodeSlogRecords splits a captured JSON slog stream into one
// key/value map per emitted record.
func decodeSlogRecords(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var rec map[string]any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			t.Fatalf("captured slog line is not JSON: %v: %q", err, line)
		}
		records = append(records, rec)
	}
	return records
}

// assertBoundedErrorRecord pins the exact bounded shape of the
// unexpected-error log: exactly one record carrying precisely the keys
// time/level/msg/code_class, the fixed message and ERROR severity, and
// the given catalog code class — never method, path, or raw error.
func assertBoundedErrorRecord(t *testing.T, records []map[string]any, wantCodeClass string) {
	t.Helper()
	if len(records) != 1 {
		t.Fatalf("error log records: want exactly 1, got %d: %v", len(records), records)
	}
	rec := records[0]
	for key := range rec {
		switch key {
		case "time", "level", "msg", "code_class":
		default:
			t.Errorf("error log has unbounded key %q (record: %v)", key, rec)
		}
	}
	if got, ok := rec["msg"].(string); !ok || got != "jobs handler failed" {
		t.Errorf("msg: want fixed %q, got %v", "jobs handler failed", rec["msg"])
	}
	if got, ok := rec["level"].(string); !ok || got != slog.LevelError.String() {
		t.Errorf("level: want %q, got %v", slog.LevelError.String(), rec["level"])
	}
	if got, ok := rec["code_class"].(string); !ok || got != wantCodeClass {
		t.Errorf("code_class: want %q, got %v", wantCodeClass, rec["code_class"])
	}
	ts, ok := rec["time"].(string)
	if !ok {
		t.Fatalf("time: want RFC3339 string, got %v", rec["time"])
	}
	if _, err := time.Parse(time.RFC3339, ts); err != nil {
		t.Errorf("time %q is not RFC3339: %v", ts, err)
	}
}

// assertNoLeak scans raw captured text for synthetic sensitive markers
// and request-identity artifacts the bounded contract forbids.
func assertNoLeak(t *testing.T, what, raw string, secrets ...string) {
	t.Helper()
	for _, s := range secrets {
		if strings.Contains(raw, s) {
			t.Errorf("%s must not contain %q: %s", what, s, raw)
		}
	}
}

// --- list endpoint --------------------------------------------------------

// TestListJobs_EmptyPageIsNonNilArray covers the JSON wire invariant
// stated in the design: an empty page MUST serialize as `"items": []`,
// never `"items": null`. The use-case guarantees a non-nil slice; the
// envelope's `omitempty` keeps the cursor field out of the wire when
// there is no next page.
func TestListJobs_EmptyPageIsNonNilArray(t *testing.T) {
	repo := &stubRepo{} // empty
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got dtos.SearchJobsResult
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Items == nil {
		t.Fatal("Items: want non-nil empty slice, got nil")
	}
	if len(got.Items) != 0 {
		t.Errorf("Items: want 0, got %d", len(got.Items))
	}
	if got.NextCursor != nil {
		t.Errorf("NextCursor: want nil on empty page, got %q", *got.NextCursor)
	}

	// Defense in depth: scan raw body for "items":null which would
	// sneak past Unmarshal if a future refactor introduces a typed nil.
	if strings.Contains(rec.Body.String(), `"items":null`) {
		t.Errorf("raw body must not contain `items:null`: %s", rec.Body.String())
	}
}

// TestListJobs_ReturnsPageWithItems covers the happy path: items
// arrive and the wire shape matches the design envelope.
func TestListJobs_ReturnsPageWithItems(t *testing.T) {
	jobs := []entities.Job{
		makeJob(uuid.MustParse("018e0000-0000-7000-8000-0000000000aa"), true, true),
		makeJob(uuid.MustParse("018e0000-0000-7000-8000-0000000000bb"), false, false),
	}
	repo := &stubRepo{searchOut: jobs}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Decode the raw body via a generic shape so the test survives
	// snake_case rename of internal struct fields.
	var raw struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(raw.Items) != 2 {
		t.Fatalf("Items: want 2, got %d", len(raw.Items))
	}

	// First item is fully populated — Location/SalaryMin/SalaryMax
	// present, snake_case keys.
	first := raw.Items[0]
	for _, key := range []string{"id", "title", "description", "work_mode", "employment_type", "seniority", "location", "salary_min", "salary_max", "salary_currency", "published_at", "company"} {
		if _, ok := first[key]; !ok {
			t.Errorf("first item missing key %q: %+v", key, first)
		}
	}
	if loc := first["location"]; loc != "CDMX" {
		t.Errorf("first item location: want CDMX, got %v", loc)
	}
	company, ok := first["company"].(map[string]any)
	if !ok {
		t.Fatalf("first item company shape: %+v", first["company"])
	}
	if company["id"] != "018e0000-0000-7000-8000-000000000001" {
		t.Errorf("company.id: %v", company["id"])
	}
	if company["name"] != "Acme SA" {
		t.Errorf("company.name: %v", company["name"])
	}

	// Second item omits the optional fields; the omitempty tags must
	// elide them entirely (NOT emit `"location": null`).
	second := raw.Items[1]
	if _, ok := second["location"]; ok {
		t.Errorf("second item must omit location, got %v", second["location"])
	}
	if _, ok := second["salary_min"]; ok {
		t.Errorf("second item must omit salary_min, got %v", second["salary_min"])
	}
}

// TestListJobs_DefaultLimit covers the design rule "page size 20 by
// default": the handler MUST forward `limit=20` (the use case inflates
// it to 21 internally) when the client omits `limit`.
func TestListJobs_DefaultLimit(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if len(repo.searchParams) != 1 {
		t.Fatalf("expected 1 search call, got %d", len(repo.searchParams))
	}
	if repo.searchParams[0].Limit != 21 {
		t.Errorf("Limit: want 21 (page 20 + 1 has-more), got %d", repo.searchParams[0].Limit)
	}
}

// TestListJobs_RespectsLimit covers the override path: an explicit
// `limit=5` must round-trip to the use case (which inflates to 6).
func TestListJobs_RespectsLimit(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs?limit=5")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	if repo.searchParams[0].Limit != 6 {
		t.Errorf("Limit: want 6 (5 + 1), got %d", repo.searchParams[0].Limit)
	}
}

// TestListJobs_ForwardsQueryParams covers the spec scenarios
// `?seniority=senior&work_mode=remote`: each filter must surface on
// the SearchParams the use case forwards.
func TestListJobs_ForwardsQueryParams(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs?q=go&seniority=senior&work_mode=remote&employment_type=full_time&location=CDMX&currency=USD")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(repo.searchParams) != 1 {
		t.Fatalf("expected 1 search call, got %d", len(repo.searchParams))
	}
	got := repo.searchParams[0]
	if got.Q == nil || *got.Q != "go" {
		t.Errorf("Q: %v", got.Q)
	}
	if got.Seniority == nil || *got.Seniority != "senior" {
		t.Errorf("Seniority: %v", got.Seniority)
	}
	if got.WorkMode == nil || *got.WorkMode != "remote" {
		t.Errorf("WorkMode: %v", got.WorkMode)
	}
	if got.EmploymentType == nil || *got.EmploymentType != "full_time" {
		t.Errorf("EmploymentType: %v", got.EmploymentType)
	}
	if got.Location == nil || *got.Location != "CDMX" {
		t.Errorf("Location: %v", got.Location)
	}
	if got.SalaryCurrency == nil || *got.SalaryCurrency != "USD" {
		t.Errorf("SalaryCurrency: %v", got.SalaryCurrency)
	}
}

// TestListJobs_MalformedQueryIgnored covers the spec scenario
// `?q=<bad>`: a malformed `q` MUST NOT 400 — `websearch_to_tsquery` is
// a safe parser and the handler treats the value like any other
// optional text, leaving validation to the DB.
func TestListJobs_MalformedQueryIgnored(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs?q=trailing:")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestListJobs_UnknownParamIgnored covers the spec scenario
// `?foo=bar`: unknown query params MUST be silently ignored (no 400).
func TestListJobs_UnknownParamIgnored(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs?foo=bar")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.searchParams[0].Q != nil {
		t.Errorf("Q: want nil (unknown param ignored), got %v", *repo.searchParams[0].Q)
	}
}

// TestListJobs_InvalidFilterValueIgnored covers the spec scenario
// `?seniority=expert`: invalid filter values MUST be silently ignored
// — there is no 400, the handler treats them as "no filter" and the
// use case forwards a nil pointer for that field.
func TestListJobs_InvalidFilterValueIgnored(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	// `seniority=expert` is not a valid closed-set value; the handler
	// must accept the request, treat the field as unfiltered, and
	// return 200.
	rec := doGet(t, router, "/jobs?seniority=expert")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestListJobs_NextCursorOnLastPage covers the wire invariant: when
// the repo returns more rows than the page size, the envelope must
// carry a non-empty `next_cursor` string.
func TestListJobs_NextCursorOnLastPage(t *testing.T) {
	// 21 rows for a 20-page: the use case will trim to 20 and emit a
	// cursor anchored on rows[19].
	jobs := make([]entities.Job, 21)
	base := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	for i := 0; i < 21; i++ {
		j := makeJob(uuid.New(), false, false)
		j.PublishedAt = timePtr(base.Add(time.Duration(i) * time.Minute))
		jobs[i] = j
	}
	repo := &stubRepo{searchOut: jobs}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs")
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var raw struct {
		Items      []map[string]any `json:"items"`
		NextCursor *string          `json:"next_cursor"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(raw.Items) != 20 {
		t.Errorf("Items: want 20, got %d", len(raw.Items))
	}
	if raw.NextCursor == nil {
		t.Errorf("NextCursor: want non-nil on +1 row, got nil")
	}
}

// TestListJobs_InternalErrorReturns500 covers the generic error path:
// the repo returns a non-ErrJobNotFound error and the handler MUST
// surface it as a 500 with a generic message.
func TestListJobs_InternalErrorReturns500(t *testing.T) {
	repo := &stubRepo{searchErr: errors.New("kaboom")}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d: %s", rec.Code, rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, httpjson.CodeInternalError)
}

// --- detail endpoint ------------------------------------------------------

// TestGetJob_ReturnsJob covers the spec scenario "GET /jobs/{id}
// returns a published job": the response is the same item shape as
// the list endpoint (Decision 4).
func TestGetJob_ReturnsJob(t *testing.T) {
	id := uuid.MustParse("018e0000-0000-7000-8000-0000000000aa")
	repo := &stubRepo{getByIDOut: ptr(makeJob(id, true, true))}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs/"+id.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var got dtos.SearchJobsItem
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.ID != id.String() {
		t.Errorf("ID: %v", got.ID)
	}
	if got.Title != "Backend Engineer" {
		t.Errorf("Title: %v", got.Title)
	}
	if got.Location == nil || *got.Location != "CDMX" {
		t.Errorf("Location: %v", got.Location)
	}
	if got.Company.ID != "018e0000-0000-7000-8000-000000000001" {
		t.Errorf("Company.ID: %v", got.Company.ID)
	}
	if repo.lastGetByID != id {
		t.Errorf("GetByID id: %v", repo.lastGetByID)
	}
}

// TestGetJob_NotFound covers the spec scenario "GET /jobs/{id} hides
// non-visible jobs": ErrJobNotFound from the repo maps to a 404.
func TestGetJob_NotFound(t *testing.T) {
	repo := &stubRepo{} // default returns ErrJobNotFound
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs/"+uuid.New().String())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestGetJob_InvalidID covers the malformed-uuid rule: a path
// parameter that doesn't parse as a UUID MUST 400, NOT 404 or 500.
func TestGetJob_InvalidID(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs/not-a-uuid")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, httpjson.CodeInvalidRequest)
}

// TestGetJob_InternalErrorReturns500 covers the generic error path.
func TestGetJob_InternalErrorReturns500(t *testing.T) {
	repo := &stubRepo{getByIDErr: errors.New("kaboom")}
	router := newTestRouter(repo)

	rec := doGet(t, router, "/jobs/"+uuid.New().String())
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d: %s", rec.Code, rec.Body.String())
	}
	assertCatalogEnvelope(t, rec, httpjson.CodeInternalError)
}

// TestGetJob_InternalErrorLogIsBounded covers the bounded-log contract
// for unexpected errors: when GetByID fails, the handler writes a 500
// internal_error envelope and emits exactly ONE structured log record
// with the fixed message/severity and the catalog code_class — never
// method, path, the query marker, or any part of the raw error (the
// synthetic DSN/token/email/CV-key markers must not survive anywhere).
func TestGetJob_InternalErrorLogIsBounded(t *testing.T) {
	buf := captureSlogJSON(t)

	dsn := "postgres://svc:hunter2-dsn-SECRET-1234@db.internal:5432/app"
	token := "bearer-token-ABCDEF-SECRET"
	email := "victim-cv@example.com"
	cvKey := "cv-blob-s3://cv/secret-resume.pdf"
	rawErr := fmt.Sprintf("get job failed: dsn=%s token=%s email=%s cv=%s", dsn, token, email, cvKey)
	repo := &stubRepo{getByIDErr: errors.New(rawErr)}
	router := newTestRouter(repo)

	id := uuid.MustParse("018e0000-0000-7000-8000-0000000000cc")
	rec := doGet(t, router, "/jobs/"+id.String()+"?marker=sentinel-6a")

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d: %s", rec.Code, rec.Body.String())
	}
	if repo.getByIDCalls != 1 {
		t.Fatalf("GetByID calls: want 1, got %d", repo.getByIDCalls)
	}
	assertCatalogEnvelope(t, rec, httpjson.CodeInternalError)
	assertNoLeak(t, "response body", rec.Body.String(),
		rawErr, dsn, token, email, cvKey, id.String(), "sentinel-6a", "/jobs/")

	assertBoundedErrorRecord(t, decodeSlogRecords(t, buf), string(httpjson.CodeInternalError))
	assertNoLeak(t, "error log", buf.String(),
		rawErr, dsn, token, email, cvKey, id.String(), "sentinel-6a", "/jobs/")
}

// TestGetJob_ErrorLogTriangulation triangulates the bounded-log
// contract across the other classification outcomes: a second distinct
// error/UUID still emits the same bounded schema; a 404
// (ErrJobNotFound) emits zero unexpected-error logs; an invalid UUID
// emits zero repo calls and zero logs.
func TestGetJob_ErrorLogTriangulation(t *testing.T) {
	t.Run("second error uuid emits same bounded schema", func(t *testing.T) {
		buf := captureSlogJSON(t)
		repo := &stubRepo{getByIDErr: errors.New("second failure token=ZZZ-9-cv-blob")}
		router := newTestRouter(repo)

		id := uuid.MustParse("018e0000-0000-7000-8000-0000000000dd")
		rec := doGet(t, router, "/jobs/"+id.String())

		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("want 500, got %d: %s", rec.Code, rec.Body.String())
		}
		if repo.getByIDCalls != 1 {
			t.Fatalf("GetByID calls: want 1, got %d", repo.getByIDCalls)
		}
		assertBoundedErrorRecord(t, decodeSlogRecords(t, buf), string(httpjson.CodeInternalError))
		assertNoLeak(t, "error log", buf.String(), "second failure", "ZZZ-9-cv-blob", id.String(), "/jobs/")
	})

	t.Run("not found emits zero unexpected error logs", func(t *testing.T) {
		buf := captureSlogJSON(t)
		repo := &stubRepo{} // default GetByID → ErrJobNotFound
		router := newTestRouter(repo)

		rec := doGet(t, router, "/jobs/"+uuid.New().String())
		if rec.Code != http.StatusNotFound {
			t.Fatalf("want 404, got %d: %s", rec.Code, rec.Body.String())
		}
		if records := decodeSlogRecords(t, buf); len(records) != 0 {
			t.Errorf("unexpected error logs on 404: want 0, got %d: %v", len(records), records)
		}
	})

	t.Run("invalid uuid zero repo calls and zero logs", func(t *testing.T) {
		buf := captureSlogJSON(t)
		repo := &stubRepo{}
		router := newTestRouter(repo)

		rec := doGet(t, router, "/jobs/not-a-uuid")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("want 400, got %d: %s", rec.Code, rec.Body.String())
		}
		if repo.getByIDCalls != 0 {
			t.Errorf("GetByID calls: want 0, got %d", repo.getByIDCalls)
		}
		if records := decodeSlogRecords(t, buf); len(records) != 0 {
			t.Errorf("unexpected logs on invalid UUID: want 0, got %d: %v", len(records), records)
		}
	})
}

// --- misc -----------------------------------------------------------------

// TestRoutesArePublic covers the spec rule "GET /jobs is public, no
// Authorization header required". The handler is built without any
// middleware (no RequireAuth), so any request — including one with a
// bogus Authorization header — must reach the use case.
func TestRoutesArePublic(t *testing.T) {
	repo := &stubRepo{}
	router := newTestRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/jobs", nil)
	req.Header.Set("Authorization", "Bearer bogus-token")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (public), got %d", rec.Code)
	}
}

func ptr[T any](v T) *T { return &v }

// assertCatalogEnvelope checks that rec carries the catalog code field.
// Use after any test that expects a non-2xx response.
func assertCatalogEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantCode httpjson.Code) {
	t.Helper()
	var env httpjson.ErrorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if env.Code != wantCode {
		t.Errorf("code: want %q, got %q", wantCode, env.Code)
	}
}
