// Package postgres implements the applications persistence port against
// PostgreSQL.
//
// The adapter is the only place where the sqlc-generated row types
// (`db.CreateApplicationRow`, `db.GetApplicationByIDRow`, etc.) are
// converted into domain entities. The domain layer never imports
// `internal/db` so the conversion is locked behind this seam — the
// entities, VOs, and the `ApplicationRepository` port stay free of
// generated SQL types.
//
// A narrow `Querier` interface (D13) keeps the adapter's dependency on
// the *db package minimal and lets the adapter tests stub the surface
// without spinning up Postgres. `*db.Queries` satisfies `Querier` at
// compile time (`var _ Querier = (*db.Queries)(nil)`).
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/repositories"
	applicationsvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Querier is the narrow sqlc-generated surface the adapter needs.
// Defining it here (mirroring identity and company_member) lets the
// adapter tests stub the surface without spinning up Postgres.
type Querier interface {
	CreateApplication(ctx context.Context, arg db.CreateApplicationParams) (db.CreateApplicationRow, error)
	GetApplicationByID(ctx context.Context, arg db.GetApplicationByIDParams) (db.GetApplicationByIDRow, error)
	ListApplicationsByJob(ctx context.Context, arg db.ListApplicationsByJobParams) ([]db.ListApplicationsByJobRow, error)
	ListMyApplications(ctx context.Context, candidateID uuid.UUID) ([]db.ListMyApplicationsRow, error)
	TransitionStatus(ctx context.Context, arg db.TransitionStatusParams) (db.TransitionStatusRow, error)
	GetJobForApplicationsScope(ctx context.Context, arg db.GetJobForApplicationsScopeParams) (uuid.UUID, error)
}

// Compile-time assertion that *db.Queries satisfies the adapter's seam.
var _ Querier = (*db.Queries)(nil)

// ApplicationRepository is the PostgreSQL adapter for
// repositories.ApplicationRepository.
type ApplicationRepository struct {
	queries Querier
}

// NewApplicationRepository wraps the (typed) sqlc-generated data layer.
// The parameter type is the narrow `Querier` seam — the composition root
// passes `*db.Queries` (which satisfies the seam at compile time) and the
// unit tests pass the stubQuerier from applicationRepository_test.go.
func NewApplicationRepository(queries Querier) *ApplicationRepository {
	return &ApplicationRepository{queries: queries}
}

// Compile-time assertion that the adapter satisfies the domain port.
var _ repositories.ApplicationRepository = (*ApplicationRepository)(nil)

// --- sentinels (package-local aliases for the entity / valueobject sentinels
// the test file references; defined in production code so the test file
// does not need to import the entities package directly).

var (
	sentinelApplicationNotFound         = entities.ErrApplicationNotFound
	sentinelJobNotApplicable            = entities.ErrJobNotApplicable
	sentinelAlreadyApplied              = entities.ErrAlreadyApplied
	sentinelInvalidApplicationReference = entities.ErrInvalidApplicationReference
	sentinelInvalidStatusTransition     = applicationsvalueobjects.ErrInvalidStatusTransition
)

// --- Create --------------------------------------------------------------

// Create atomically inserts an application guarded by the eligibility
// predicate (design D1). On success the returned *entities.Application is
// the persisted row mapped from the sqlc CreateApplicationRow (status is
// the DB-default 'submitted').
//
// On failure mapCreateError translates the pgx / pgconn error into the
// domain sentinel the HTTP classifier dispatches on (404 / 409 / 400).
func (r *ApplicationRepository) Create(
	ctx context.Context,
	p repositories.CreateParams,
) (*entities.Application, error) {
	row, err := r.queries.CreateApplication(ctx, buildCreateApplicationParams(
		p.ID, p.JobID, p.CandidateID, p.Source, p.CoverLetter,
	))
	if err != nil {
		return nil, mapCreateError(err)
	}
	app, err := toApplication(row)
	if err != nil {
		return nil, err
	}
	return &app, nil
}

// --- GetByID -------------------------------------------------------------

// GetByID scopes by (id, job_id, company_id) and returns the row + the
// PII-minimized candidate snippet (D12). 0 rows → ErrApplicationNotFound.
func (r *ApplicationRepository) GetByID(
	ctx context.Context,
	id, jobID, companyID uuid.UUID,
) (*entities.ApplicationWithCandidate, error) {
	row, err := r.queries.GetApplicationByID(ctx, db.GetApplicationByIDParams{
		ID:        id,
		JobID:     jobID,
		CompanyID: companyID,
	})
	if err != nil {
		return nil, mapGetError(err)
	}
	out, err := toApplicationWithCandidate(row)
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// --- ListByJob -----------------------------------------------------------

// ListByJob is the two-step D5 scope check + list:
//  1. GetJobForApplicationsScope :one — 0 rows → ErrApplicationNotFound
//     (cross-company / non-existent job).
//  2. ListApplicationsByJob :many — ordered created_at DESC, capped 100.
//     Empty result → non-nil empty slice (JSON `[]` not `null`).
func (r *ApplicationRepository) ListByJob(
	ctx context.Context,
	jobID, companyID uuid.UUID,
) ([]entities.ApplicationWithCandidate, error) {
	if _, err := r.queries.GetJobForApplicationsScope(ctx, db.GetJobForApplicationsScopeParams{
		JobID:     jobID,
		CompanyID: companyID,
	}); err != nil {
		return nil, mapGetError(err)
	}
	rows, err := r.queries.ListApplicationsByJob(ctx, db.ListApplicationsByJobParams{
		JobID:     jobID,
		CompanyID: companyID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]entities.ApplicationWithCandidate, 0, len(rows))
	for _, row := range rows {
		item, err := toApplicationWithCandidateFromListByJobRow(row)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

// --- ListByCandidate -----------------------------------------------------

// ListByCandidate returns the caller's own applications with a job
// summary (joined from jobs + companies). NOT redacted by jobs.deleted_at
// on purpose — the candidate's own history persists. Hard cap 100.
func (r *ApplicationRepository) ListByCandidate(
	ctx context.Context,
	candidateID uuid.UUID,
) ([]entities.MyApplication, error) {
	rows, err := r.queries.ListMyApplications(ctx, candidateID)
	if err != nil {
		return nil, err
	}
	out := make([]entities.MyApplication, 0, len(rows))
	for _, row := range rows {
		item, err := toMyApplication(row)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, nil
}

// --- Transition ----------------------------------------------------------

// Transition advances the row from `from` to `to`, guarded by (id,
// job_id, company_id, status = from) inside the UPDATE WHERE (D3). 0 rows
// (lost race / cross-company / non-existent / mismatched job) →
// ErrApplicationNotFound (404).
func (r *ApplicationRepository) Transition(
	ctx context.Context,
	id, jobID, companyID uuid.UUID,
	from, to applicationsvalueobjects.ApplicationStatus,
) (*entities.Application, error) {
	row, err := r.queries.TransitionStatus(ctx, buildTransitionParams(
		id, jobID, companyID, from, to,
	))
	if err != nil {
		return nil, mapTransitionError(err)
	}
	app, err := toApplicationFromTransitionRow(row)
	if err != nil {
		return nil, err
	}
	return &app, nil
}

// --- builders ------------------------------------------------------------

// buildCreateApplicationParams translates the domain CreateParams into the
// sqlc `CreateApplicationParams` struct. The arg order is pinned by the
// SQL first-textual-appearance order:
//
//	id, job_id, candidate_id, source, cover_letter
//
// sqlc.narg columns (source / cover_letter) are pgtype.Text: nil pointer
// → invalid pgtype (SQL NULL); non-nil pointer → valid pgtype carrying
// the canonical String() form.
func buildCreateApplicationParams(
	id, jobID, candidateID uuid.UUID,
	source *applicationsvalueobjects.ApplicationSource,
	coverLetter *string,
) db.CreateApplicationParams {
	return db.CreateApplicationParams{
		ID:          id,
		JobID:       jobID,
		CandidateID: candidateID,
		Source:      sourcePtrToText(source),
		CoverLetter: stringPtrToText(coverLetter),
	}
}

// buildTransitionParams translates the domain transition input into the
// sqlc `TransitionStatusParams` struct. The arg order is pinned by first
// textual appearance in the UPDATE statement:
//
//	to_status, id, job_id, from_status, company_id
//
// `from` and `to` carry the canonical String() form so the SQL guard
// compares against the same wire value the CREATE INSERT emitted.
func buildTransitionParams(
	id, jobID, companyID uuid.UUID,
	from, to applicationsvalueobjects.ApplicationStatus,
) db.TransitionStatusParams {
	return db.TransitionStatusParams{
		ToStatus:   to.String(),
		ID:         id,
		JobID:      jobID,
		FromStatus: from.String(),
		CompanyID:  companyID,
	}
}

// sourcePtrToText folds a `*ApplicationSource` into a `pgtype.Text`.
// nil → invalid (SQL NULL); non-nil → valid carrying the canonical
// String() form.
func sourcePtrToText(s *applicationsvalueobjects.ApplicationSource) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s.String(), Valid: true}
}

// stringPtrToText folds a `*string` into a `pgtype.Text`. nil → invalid
// (SQL NULL); non-nil → valid carrying the trimmed value.
func stringPtrToText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// --- mappers -------------------------------------------------------------

// toApplication rebuilds a domain Application from a sqlc row.
// CreateApplicationRow and TransitionStatusRow have the same column list
// (the eight application columns), so they share this mapper.
//
// VOs are reconstructed via Parse* so an unrecognized DB value (which
// would only happen if someone bypassed the CHECK constraint) FAILS LOUD
// rather than silently zeroing — a corrupted row never reaches the wire.
// Optional DB columns (Source, CoverLetter) translate to pointers through
// the pgtype `Valid` flag.
func toApplication(row db.CreateApplicationRow) (entities.Application, error) {
	return toApplicationFromFields(
		row.ID, row.JobID, row.CandidateID, row.Status,
		row.Source, row.CoverLetter,
		row.CreatedAt, row.UpdatedAt,
	)
}

// toApplicationFromTransitionRow reuses toApplicationFromFields for the
// TransitionStatusRow shape (identical column list).
func toApplicationFromTransitionRow(row db.TransitionStatusRow) (entities.Application, error) {
	return toApplicationFromFields(
		row.ID, row.JobID, row.CandidateID, row.Status,
		row.Source, row.CoverLetter,
		row.CreatedAt, row.UpdatedAt,
	)
}

// toApplicationFromFields is the shared field-by-field mapper. Defining it
// here lets the two row-type callers share a single body.
func toApplicationFromFields(
	id, jobID, candidateID uuid.UUID,
	status string,
	source pgtype.Text,
	coverLetter pgtype.Text,
	createdAt, updatedAt pgtype.Timestamptz,
) (entities.Application, error) {
	st, err := applicationsvalueobjects.ParseApplicationStatus(status)
	if err != nil {
		return entities.Application{}, err
	}

	app := entities.Application{
		ID:          id,
		JobID:       jobID,
		CandidateID: candidateID,
		Status:      st,
		CreatedAt:   pgTimestamptzToTime(createdAt),
		UpdatedAt:   pgTimestamptzToTime(updatedAt),
	}
	if source.Valid {
		v := applicationsvalueobjects.ApplicationSource(0)
		switch source.String {
		case "referral":
			v = applicationsvalueobjects.Referral
		case "linkedin":
			v = applicationsvalueobjects.LinkedIn
		case "job_board":
			v = applicationsvalueobjects.JobBoard
		case "direct":
			v = applicationsvalueobjects.Direct
		case "other":
			v = applicationsvalueobjects.Other
		default:
			return entities.Application{}, applicationsvalueobjects.ErrInvalidSource
		}
		app.Source = &v
	}
	if coverLetter.Valid {
		v := coverLetter.String
		app.CoverLetter = &v
	}
	return app, nil
}

// toApplicationWithCandidate rebuilds a domain ApplicationWithCandidate
// from a sqlc row. GetApplicationByIDRow and ListApplicationsByJobRow
// share the same 12-column layout so the mapper is shared.
//
// VOs are reconstructed via Parse* so an unrecognized DB value fails
// loud. PII-minimized snippet fields (D12) are translated to pointers
// through the pgtype `Valid` flag — a candidate without a profile row
// renders ProfessionalTitle / YearsOfExperience as nil.
func toApplicationWithCandidate(row db.GetApplicationByIDRow) (entities.ApplicationWithCandidate, error) {
	return toApplicationWithCandidateFromFields(
		row.ID, row.JobID, row.CandidateID, row.Status,
		row.Source, row.CoverLetter,
		row.CreatedAt, row.UpdatedAt,
		row.CandidateID, row.CandidateFullName,
		row.CandidateProfessionalTitle, row.CandidateYearsOfExperience,
	)
}

// toApplicationWithCandidateFromListByJobRow reuses the shared mapper
// for the ListApplicationsByJobRow shape (identical column list).
func toApplicationWithCandidateFromListByJobRow(row db.ListApplicationsByJobRow) (entities.ApplicationWithCandidate, error) {
	return toApplicationWithCandidateFromFields(
		row.ID, row.JobID, row.CandidateID, row.Status,
		row.Source, row.CoverLetter,
		row.CreatedAt, row.UpdatedAt,
		row.CandidateID, row.CandidateFullName,
		row.CandidateProfessionalTitle, row.CandidateYearsOfExperience,
	)
}

// toApplicationWithCandidateFromFields is the shared mapper body.
func toApplicationWithCandidateFromFields(
	id, jobID, candidateID uuid.UUID,
	status string,
	source pgtype.Text,
	coverLetter pgtype.Text,
	createdAt, updatedAt pgtype.Timestamptz,
	snippetUserID uuid.UUID,
	snippetFullName string,
	snippetTitle pgtype.Text,
	snippetYears pgtype.Int2,
) (entities.ApplicationWithCandidate, error) {
	app, err := toApplicationFromFields(
		id, jobID, candidateID, status,
		source, coverLetter,
		createdAt, updatedAt,
	)
	if err != nil {
		return entities.ApplicationWithCandidate{}, err
	}
	snippet := entities.CandidateSnippet{
		UserID:   snippetUserID,
		FullName: snippetFullName,
	}
	if snippetTitle.Valid {
		v := snippetTitle.String
		snippet.ProfessionalTitle = &v
	}
	if snippetYears.Valid {
		v := int(snippetYears.Int16)
		snippet.YearsOfExperience = &v
	}
	return entities.ApplicationWithCandidate{
		Application: app,
		Candidate:   snippet,
	}, nil
}

// toMyApplication rebuilds a domain MyApplication from a sqlc row. The
// embedded JobSummary carries the (id, title, company_id, company_name)
// pointer back to the job + the owning company.
func toMyApplication(row db.ListMyApplicationsRow) (entities.MyApplication, error) {
	app, err := toApplicationFromFields(
		row.ID, row.JobID, row.CandidateID, row.Status,
		row.Source, row.CoverLetter,
		row.CreatedAt, row.UpdatedAt,
	)
	if err != nil {
		return entities.MyApplication{}, err
	}
	return entities.MyApplication{
		Application: app,
		Job: entities.JobSummary{
			ID:          row.JobID,
			Title:       row.JobTitle,
			CompanyID:   row.CompanyID,
			CompanyName: row.CompanyName,
		},
	}, nil
}

// --- pgtype helpers ------------------------------------------------------

// pgTimestamptzToTime extracts a non-pointer time.Time from a
// pgtype.Timestamptz. Mirrors the jobs adapter helper.
func pgTimestamptzToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

// --- error dispatchers (D2 / D4 / D5) ------------------------------------

// mapCreateError translates Postgres errors surfaced by CreateApplication
// into domain sentinels (design D2).
//
// Ordering: pgx.ErrNoRows is checked BEFORE errors.As into *pgconn.PgError
// so a 23505 unique violation can never be shadowed by the gate-miss
// branch (the locked ordering from jobs-soft-delete D3 / jobs-create D10).
//
// Mapping contract:
//
//   - nil                                → nil
//   - pgx.ErrNoRows                      → entities.ErrJobNotApplicable
//     (the only designed path — the
//     atomic WHERE EXISTS guard
//     produced 0 rows)
//   - 23505 (unique_violation on
//     applications_job_candidate_unique) → entities.ErrAlreadyApplied
//     (live dedupe branch)
//   - 23503 (foreign_key_violation on
//     applications.job_id or
//     applications.candidate_id)        → entities.ErrInvalidApplicationReference
//     (defense-in-depth — unreachable
//     via the designed flow; the atomic
//     gate filters to existing visible
//     jobs, and candidate_id is the
//     JWT-resolved users.id)
//   - 23514 (check_violation on
//     applications_status_check or
//     applications_source_check)         → valueobjects.ErrInvalidStatusTransition
//     (defense-in-depth — use case
//     parses VOs before SQL)
//   - Any other PgError (unknown code)   → pass-through (HTTP 500)
//   - Any non-pg error (connection, ctx) → pass-through (HTTP 500)
func mapCreateError(err error) error {
	if err == nil {
		return nil
	}
	// Gate miss: the atomic WHERE EXISTS produced 0 rows. Checked BEFORE
	// errors.As so a 23505 unique violation can never be shadowed by the
	// gate-miss branch.
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrJobNotApplicable
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return entities.ErrAlreadyApplied
		case "23503":
			return entities.ErrInvalidApplicationReference
		case "23514":
			return valueobjects_ErrInvalidStatusTransition()
		}
	}
	return err
}

// mapTransitionError translates Postgres errors surfaced by TransitionStatus
// into domain sentinels (design D4).
//
// Mapping contract:
//
//   - nil                                → nil
//   - pgx.ErrNoRows                      → entities.ErrApplicationNotFound
//     (lost race / cross-company /
//     non-existent / mismatched job —
//     indistinguishable, 404)
//   - 23514 (check_violation on
//     applications_status_check)         → valueobjects.ErrInvalidStatusTransition
//     (defense-in-depth — use case
//     parses the to-status VO before
//     SQL)
//   - Any other PgError (unknown code)   → pass-through (HTTP 500)
//   - Any non-pg error (connection, ctx) → pass-through (HTTP 500)
//
// NO 23503 mapping (UPDATE does not change FKs) and NO 23505 mapping
// (UPDATE does not touch the UNIQUE pair).
func mapTransitionError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrApplicationNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23514":
			return valueobjects_ErrInvalidStatusTransition()
		}
	}
	return err
}

// mapGetError translates Postgres errors surfaced by GetApplicationByID
// (and the ListByJob scope check) into domain sentinels. pgx.ErrNoRows →
// entities.ErrApplicationNotFound (the cross-company / non-existent /
// mismatched-job surface).
//
// Mapping contract:
//
//   - nil                                → nil
//   - pgx.ErrNoRows                      → entities.ErrApplicationNotFound
//   - Any other error                    → pass-through (HTTP 500)
func mapGetError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return entities.ErrApplicationNotFound
	}
	return err
}

// valueobjects_ErrInvalidStatusTransition is a thin wrapper that returns
// the valueobjects package sentinel — the dispatcher above references it
// via this wrapper so the package import stays explicit.
func valueobjects_ErrInvalidStatusTransition() error {
	return applicationsvalueobjects.ErrInvalidStatusTransition
}
