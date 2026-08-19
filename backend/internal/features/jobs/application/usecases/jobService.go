// Package usecases orchestrates the jobs application logic. The
// service is the composition target: it depends on the jobs repo port
// (repositories.JobRepository) and exposes the use cases the HTTP
// boundary calls into. The service owns:
//
//   - filter normalization (nil/whitespace → DB sentinel nil),
//   - cursor codec (tolerant decode so malformed cursors fall through
//     to the first page rather than 400-ing — Decision 8),
//   - keyset pagination (request limit+1, trim, encode next cursor
//     from the dropped row — Decision 3),
//   - entity → DTO shaping for the wire.
//
// All use cases accept context.Context as the first argument so the
// HTTP layer can propagate request-scoped cancellation.
package usecases

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/repositories"
)

// JobService bundles the jobs use cases that share the same
// repository port. Construct it once at the composition root with the
// real postgres adapter and pass it around; the stub repositories in
// tests satisfy the same surface.
type JobService struct {
	repo repositories.JobRepository
}

// NewJobService wires the use cases around the jobs repository port.
// The argument type is the domain port, so any concrete adapter (the
// postgres impl in WU7) or test stub that satisfies it can be wired.
func NewJobService(repo repositories.JobRepository) *JobService {
	return &JobService{repo: repo}
}
