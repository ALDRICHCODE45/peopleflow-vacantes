// Package repositories defines the persistence ports for the companies context.
package repositories

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
)

// CompanyBootstrapRepository is the transactional persistence port for the
// company-creation bootstrap: it persists a new company AND its founding
// owner membership atomically, so a company can never be left without an
// owner if the membership write fails.
//
// The use case does NOT open the transaction — it has no knowledge of pgx.
// The adapter owns the begin/insert-company/insert-member/commit sequence,
// mirroring the candidates adapter's ReplaceLanguagesByUserID, which is the
// canonical in-repo model for an atomic multi-write port.
type CompanyBootstrapRepository interface {
	// CreateWithOwner persists the company and its founding owner in a single
	// transaction. On any error the transaction is rolled back and neither row
	// is visible; the error is mapped to the same domain sentinels as the
	// individual repositories (ErrDuplicateCompany on RFC collision,
	// ErrIndustryNotFound on a missing industry FK, ErrUserNotFound on a
	// missing users.id FK).
	CreateWithOwner(ctx context.Context, company *entities.Company, owner *entities.CompanyMember) error
}
