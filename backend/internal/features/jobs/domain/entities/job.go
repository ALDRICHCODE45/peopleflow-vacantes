// Package entities holds the jobs bounded-context domain entities.
//
// The jobs slice is read-only on the public API surface (GET /jobs and
// GET /jobs/{id}); publish/close transitions and write endpoints are
// out of scope for this slice. The entity is therefore a pure read
// model — no factory, no UUID generation — rebuilt by the postgres
// adapter from sqlc rows. Optional DB columns surface as pointers so
// absence (NULL) is distinguishable from a zero value.
package entities

import (
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// ErrJobNotFound is returned by the persistence port when no visible
// row exists for the requested id. The HTTP layer maps this to 404
// per the spec scenario "GET /jobs/{id} hides non-visible jobs".
var ErrJobNotFound = errors.New("job not found")

// CompanyRef is the embedded company identity carried in every job
// response: {id, name}. The adapter joins `companies` in the same
// query (Decision 5) so this comes back populated in every row.
type CompanyRef struct {
	ID   uuid.UUID
	Name string
}

// Job is the read model for a public job. The entity holds:
//   - typed VOs for closed-set fields (WorkMode, EmploymentType,
//     Seniority, JobStatus, SalaryCurrency) so unrecognized DB values
//     surface as Parse* sentinels instead of silent zeroing;
//   - pointers for nullable DB columns (Location, SalaryMin,
//     SalaryMax, PublishedAt) so absence is preserved;
//   - the embedded CompanyRef the API serializes as
//     `company: {id, name}`.
//
// The struct has no factory: the adapter populates it directly from
// sqlc rows. There is no `toEntity` here — that mapping lives in the
// postgres adapter (task 7.2), matching the `companies` pattern, and
// the domain package does not import `internal/db`.
type Job struct {
	ID             uuid.UUID
	Title          string
	Description    string
	WorkMode       valueobjects.WorkMode
	EmploymentType valueobjects.EmploymentType
	Seniority      valueobjects.Seniority
	JobStatus      valueobjects.JobStatus

	// Optional DB columns (NULL → nil pointer).
	Location       *string
	SalaryMin      *int
	SalaryMax      *int
	SalaryCurrency valueobjects.SalaryCurrency

	// PublishedAt is the published timestamp from the row; nil for
	// draft/closed rows (which the read path never returns, but the
	// pointer shape matches the column).
	PublishedAt *time.Time

	Company CompanyRef
}
