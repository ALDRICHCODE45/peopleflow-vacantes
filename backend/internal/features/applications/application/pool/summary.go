package pool

import (
	"context"

	"github.com/google/uuid"
)

// Summary counts identities, not participations, across the unfiltered pool.
type Summary struct {
	Total             int64      `json:"total"`
	WithActiveProcess int64      `json:"with_active_process"`
	AddedLast7Days    int64      `json:"added_last_7_days"`
	ByKind            KindCounts `json:"by_kind"`
}

type KindCounts struct {
	Manual  int64 `json:"manual"`
	Organic int64 `json:"organic"`
}

func (s *Service) Summary(ctx context.Context, company uuid.UUID) (Summary, error) {
	return s.reader.Summary(ctx, company)
}
