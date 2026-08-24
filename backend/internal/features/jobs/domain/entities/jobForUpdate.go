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
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
)

// JobForUpdate is the narrow write projection returned by
// JobRepository.GetForUpdate. It is deliberately NOT the read `Job`
// entity:
//
//   - it is company-scoped and NON-visibility-narrowed (the write path
//     must see drafts and closed rows so it can transition or reject
//     them);
//   - it carries `UpdatedAt` so the use case can do the CAS compare
//     against `If-Unmodified-Since`;
//   - it carries `PublishedAt` so the editor view can render it and the
//     transition logic can decide what to do with it;
//   - it has no `Rank` — search rank is a read-path concept that the
//     write flow never uses.
//
// The struct has no factory: the adapter populates it directly from
// sqlc rows in `toJobForUpdateEntity`. There is no `toEntity` here —
// that mapping lives in the postgres adapter (matching the `companies`
// pattern), and the domain package does not import `internal/db`.
type JobForUpdate struct {
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
	// draft rows, set for published/closed rows. The pointer shape
	// matches the column.
	PublishedAt *time.Time

	// UpdatedAt is the last-modified timestamp; the use case compares
	// it against `If-Unmodified-Since` for optimistic concurrency and
	// echoes it on the editor view.
	UpdatedAt time.Time

	// CompanyRef is the embedded company identity {id, name}. The
	// editor view reuses `dtos.CompanyDto` so the wire shape stays
	// consistent with the public read item.
	Company CompanyRef
}
