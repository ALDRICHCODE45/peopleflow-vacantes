// Package postgres implements the companies persistence ports against PostgreSQL.
//
// The CompanyBootstrapRepository adapter is the transactional persistence for
// company creation: it owns the pgx connection pool so it can persist a new
// company AND its founding owner membership in a single transaction, mirroring
// the candidates adapter's ReplaceLanguagesByUserID (the canonical in-repo
// model for an atomic multi-write port). A company can never be left without
// an owner: if either INSERT fails, the transaction rolls back and neither row
// is visible.
package postgres

import (
	"context"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CompanyBootstrapRepository is the PostgreSQL adapter for
// repositories.CompanyBootstrapRepository. It retains the connection pool so
// it can open the transaction that ties the company and owner writes together.
type CompanyBootstrapRepository struct {
	pool *pgxpool.Pool
}

// NewCompanyBootstrapRepository wraps the connection pool.
func NewCompanyBootstrapRepository(pool *pgxpool.Pool) *CompanyBootstrapRepository {
	return &CompanyBootstrapRepository{pool: pool}
}

// Compile-time assertion that the adapter satisfies the domain port.
var _ repositories.CompanyBootstrapRepository = (*CompanyBootstrapRepository)(nil)

// CreateWithOwner persists the company and its founding owner in one
// transaction. The two INSERTs reuse the sqlc-generated queries scoped to the
// transaction (db.New(tx)); error mapping is delegated to the same pure
// classifiers the individual repositories use (mapCompanyCreateError for the
// company, mapCreateError for the member) so the wire contract stays
// consistent with the single-write paths.
func (r *CompanyBootstrapRepository) CreateWithOwner(ctx context.Context, company *entities.Company, owner *entities.CompanyMember) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin bootstrap tx: %w", err)
	}
	// defer Rollback is a no-op after a successful Commit; on any error path
	// below it sends ROLLBACK and leaves neither row visible.
	defer func() { _ = tx.Rollback(ctx) }()

	queries := db.New(tx)

	if _, err := queries.CreateCompany(ctx, buildCreateParams(company)); err != nil {
		return mapCompanyCreateError(err)
	}

	if _, err := queries.CreateCompanyMember(ctx, buildCreateMemberParams(owner)); err != nil {
		return mapCreateError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit bootstrap tx: %w", err)
	}
	return nil
}
