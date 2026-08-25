// Package repositories defines the persistence ports for the applications
// bounded context. The application layer depends only on these interfaces;
// the postgres adapter in infrastructure/postgres is the only concrete
// implementation in this slice.
//
// The port surface is intentionally narrow — every method corresponds to
// one of the six sqlc queries listed in design §3 / §5.6 and the five use
// cases. Cross-feature reads (jobs / companies / users / candidate_profiles)
// are performed entirely inside the adapter's SQL; no other feature's
// port is extended (locked decision — the jobs port stays untouched).
package repositories

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/domain/valueobjects"
	"github.com/google/uuid"
)

// CreateParams is the validated, parsed input the use case hands to
// ApplicationRepository.Create. The use case owns UUID generation (ID,
// uuid.NewV7) and VO parsing; the adapter maps parsed VOs to canonical
// wire strings and optional pointers to nullable pgtypes.
//
// Source and CoverLetter are nil-friendly so the JSON-`null` wire case
// stores as SQL NULL (defense-in-depth — the use case already rejects
// empty cover_letter before this port is reached).
type CreateParams struct {
	ID          uuid.UUID
	JobID       uuid.UUID
	CandidateID uuid.UUID
	Source      *valueobjects.ApplicationSource
	CoverLetter *string
}

// ApplicationRepository is the persistence port for the applications
// slice. Each method documents its error contract and (jobID, companyID)
// scoping rules (the same-company invariant is encoded in SQL — no
// Go-level pre-check that would leak the row's existence).
//
// Error sentinels (defined in domain/entities + domain/valueobjects):
//
//	ErrApplicationNotFound         — 404 cross-company / non-existent / mismatched job
//	                                  (GetByID, Transition, ListByJob two-step)
//	ErrJobNotApplicable            — 404 the atomic WHERE EXISTS gate produced 0 rows
//	                                  (Create — pgx.ErrNoRows from the gate)
//	ErrAlreadyApplied              — 409 SQLSTATE 23505 on UNIQUE(job_id, candidate_id)
//	                                  (Create — plain UNIQUE per D11)
//	ErrInvalidApplicationReference — 400 SQLSTATE 23503 defense-in-depth
//	                                  (Create — unreachable via the designed flow)
//	ErrInvalidStatusTransition     — 400 SQLSTATE 23514 defense-in-depth
//	                                  (Create + Transition — use case parses VOs first)
type ApplicationRepository interface {
	// Create atomically inserts an application guarded by the eligibility
	// predicate (published + deleted_at IS NULL + active company). Errors:
	//
	//   entities.ErrJobNotApplicable            (gate miss, pgx.ErrNoRows)
	//   entities.ErrAlreadyApplied              (23505 unique)
	//   entities.ErrInvalidApplicationReference (23503, defense-in-depth)
	//   valueobjects.ErrInvalidStatusTransition (23514, defense-in-depth)
	Create(ctx context.Context, params CreateParams) (*entities.Application, error)

	// GetByID scopes by (id, job_id, company_id) and returns the row +
	// PII-minimized candidate snippet. 0 rows → entities.ErrApplicationNotFound.
	GetByID(ctx context.Context, id, jobID, companyID uuid.UUID) (*entities.ApplicationWithCandidate, error)

	// ListByJob returns the job's applications (same-company scope),
	// ordered created_at DESC, capped at 100. Cross-company/non-existent
	// job → entities.ErrApplicationNotFound (two-step D5: scope check
	// then list). Empty result → non-nil empty slice.
	ListByJob(ctx context.Context, jobID, companyID uuid.UUID) ([]entities.ApplicationWithCandidate, error)

	// ListByCandidate returns the caller's own applications with a job
	// summary, ordered created_at DESC, capped at 100. NOT redacted by
	// jobs.deleted_at — the candidate's own history persists.
	ListByCandidate(ctx context.Context, candidateID uuid.UUID) ([]entities.MyApplication, error)

	// Transition advances the row from `from` to `to`, guarded by
	// (id, job_id, company_id, status = from). 0 rows →
	// entities.ErrApplicationNotFound (lost race / cross-company /
	// non-existent / mismatched job — indistinguishable, 404).
	Transition(
		ctx context.Context,
		id, jobID, companyID uuid.UUID,
		from, to valueobjects.ApplicationStatus,
	) (*entities.Application, error)
}
