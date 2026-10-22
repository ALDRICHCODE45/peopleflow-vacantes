// Package postgres implements the companies persistence ports against PostgreSQL.
//
// The CompanyMemberRepository adapter is the PostgreSQL implementation of
// repositories.CompanyMemberRepository for the company_membership subdomain.
// It owns:
//   - the SQLSTATE → domain-sentinel mapping for `company_members`
//     (mapCreateError — distinct from mapCompanyCreateError in
//     companyRepository.go, because the same SQLSTATE codes mean different
//     domain errors on different tables);
//   - the sqlc ↔ domain entity marshaling for the company_members table;
//   - the same-company guard for Update/Remove is in the SQL itself
//     (db/queries/company_members.sql: `WHERE id=$1 AND company_id=$2`);
//     this adapter surfaces 0-rows-affected as entities.ErrMemberNotFound
//     per design D7.
//
// Membership resolution (sub → users.id → company_members) lives in the
// application service, NOT here; the port's GetMembershipByUserID takes a
// users.id because by the time the call site has resolved the JWT subject,
// the raw `sub` string has already been discarded (design D6).
package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// memberDatabase accepts a pool in production and a transaction in rollback
// fixtures (pgx implements nested Begin with savepoints).
type memberDatabase interface {
	db.DBTX
	Begin(context.Context) (pgx.Tx, error)
}

// CompanyMemberRepository owns membership mutation transactions.
type CompanyMemberRepository struct {
	database memberDatabase
	queries  *db.Queries
}

// NewCompanyMemberRepository wraps a transaction-capable PostgreSQL handle.
func NewCompanyMemberRepository(database memberDatabase) *CompanyMemberRepository {
	return &CompanyMemberRepository{database: database, queries: db.New(database)}
}

// Compile-time assertion that the adapter satisfies the domain port.
// A future port change here surfaces as a build error, never a runtime
// "method missing" panic.
var _ repositories.CompanyMemberRepository = (*CompanyMemberRepository)(nil)

// Create persists a new member row. The DB enforces UNIQUE(user_id) and
// the FKs to users + companies; this adapter translates the resulting
// SQLSTATE codes into domain sentinels per the design error table:
//
//   - 23505 (unique_violation on user_id) → ErrMemberExists
//   - 23503 (foreign_key_violation)        → ErrUserNotFound
//
// Any other error (connection failure, context cancellation, unexpected
// constraint) passes through unchanged so the HTTP layer logs the real
// cause and returns 500 — never silently coerced into a 4xx.
//
// The adapter DOES NOT validate `m.Role` against the closed set; the
// domain entity factory already does, and the DB CHECK constraint will
// reject a bad role at persistence time as SQLSTATE 23514. We let that
// pass through unchanged (it is NOT a `mapCreateError` concern: the CHECK
// violation means the use case let a bad entity through, which is a
// real bug, not a client error).
func (r *CompanyMemberRepository) Create(ctx context.Context, m *entities.CompanyMember) error {
	_, err := r.queries.CreateCompanyMember(ctx, buildCreateMemberParams(m))
	return mapCreateError(err)
}

// GetMembershipByUserID returns the user's single membership row, or
// entities.ErrNotAMember when no row exists. The DB enforces
// UNIQUE(user_id) so at most one row is ever returned; we don't loop.
//
// pgx.ErrNoRows is the only "no row" signal pgx emits for a QueryRow
// scan; the translation makes the sentinel a domain concept so the HTTP
// layer can dispatch on errors.Is without importing pgx.
func (r *CompanyMemberRepository) GetMembershipByUserID(ctx context.Context, userID uuid.UUID) (*entities.CompanyMember, error) {
	row, err := r.queries.GetMembershipByUserID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, entities.ErrNotAMember
		}
		return nil, err
	}
	return memberToEntity(row)
}

// ListByCompanyID returns every member of the given company, enriched with
// the member's user identity. The LEFT JOIN leaves `user_id` (and thus
// full_name/email) NULL when a member's user can't be resolved; in that case
// the row's User is nil (the HTTP layer renders `user: null`). Empty result
// is a non-nil empty slice so JSON encoding produces `[]`.
func (r *CompanyMemberRepository) ListByCompanyID(ctx context.Context, companyID uuid.UUID) ([]entities.MemberListRow, error) {
	rows, err := r.queries.ListByCompanyID(ctx, companyID)
	if err != nil {
		return nil, err
	}
	out := make([]entities.MemberListRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, memberListRowToEntity(row))
	}
	return out, nil
}

// UpdateRole replaces the target member's role, gated by the (id,
// companyID) pair. The SQL predicate `WHERE id=$1 AND company_id=$2` is
// the same-company guard (design D7); 0 rows affected means the target
// either does not exist OR belongs to a different company — both surface
// as entities.ErrMemberNotFound per the design error table, so the HTTP
// layer can return 404 without distinguishing the two cases (an
// information-leak fix — a foreign target is intentionally indistinguishable
// from "does not exist").
func (r *CompanyMemberRepository) UpdateRole(ctx context.Context, id, companyID uuid.UUID, role valueobjects.MemberRole) error {
	return r.mutateMember(ctx, id, companyID, role == valueobjects.OwnerRole, func(q *db.Queries) (int64, error) {
		return q.UpdateMemberRole(ctx, db.UpdateMemberRoleParams{ID: id, CompanyID: companyID, Role: role.String()})
	})
}

// Remove hard-deletes the row (design D2: no soft-delete) gated by the
// (id, companyID) pair. Same contract as UpdateRole for the 0-rows
// case: ErrMemberNotFound. HARD DELETE frees `user_id` for re-assignment.
func (r *CompanyMemberRepository) Remove(ctx context.Context, id, companyID uuid.UUID) error {
	return r.mutateMember(ctx, id, companyID, false, func(q *db.Queries) (int64, error) {
		return q.RemoveCompanyMember(ctx, db.RemoveCompanyMemberParams{ID: id, CompanyID: companyID})
	})
}

func (r *CompanyMemberRepository) mutateMember(ctx context.Context, id, companyID uuid.UUID, retainsOwner bool, write func(*db.Queries) (int64, error)) error {
	// Pools support explicit isolation; rollback fixtures use pgx savepoints,
	// which inherit their outer transaction's READ COMMITTED isolation.
	var tx pgx.Tx
	var err error
	if pool, ok := r.database.(interface {
		BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
	}); ok {
		tx, err = pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	} else {
		tx, err = r.database.Begin(ctx)
	}
	if err != nil {
		return fmt.Errorf("begin member mutation: %w", err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	q := db.New(tx)

	// All role changes and removals lock the SAME stable company row first.
	// Under READ COMMITTED, the following separate statements get fresh
	// snapshots after a waiting writer commits. Locking/counting in one CTE
	// would retain its old statement snapshot and permit write skew.
	if _, err := q.LockCompanyForMemberMutation(ctx, companyID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entities.ErrMemberNotFound
		}
		return fmt.Errorf("lock member company: %w", err)
	}
	role, err := q.GetMemberRoleForMutation(ctx, db.GetMemberRoleForMutationParams{ID: id, CompanyID: companyID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entities.ErrMemberNotFound
		}
		return fmt.Errorf("get member role: %w", err)
	}
	if role == valueobjects.OwnerRole.String() && !retainsOwner {
		owners, err := q.CountCompanyOwners(ctx, companyID)
		if err != nil {
			return fmt.Errorf("count company owners: %w", err)
		}
		if owners <= 1 {
			return entities.ErrLastOwner
		}
	}
	rows, err := write(q)
	if err != nil {
		return fmt.Errorf("mutate member: %w", err)
	}
	if rows == 0 {
		return entities.ErrMemberNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit member mutation: %w", err)
	}
	return nil
}

// --- entity ↔ sqlc marshaling ----------------------------------------------

// buildCreateMemberParams translates the domain entity into the sqlc
// parameter struct. The role is reduced to its canonical wire form
// (valueobjects.MemberRole.String); the entity factory has already
// validated it against the closed set.
func buildCreateMemberParams(m *entities.CompanyMember) db.CreateCompanyMemberParams {
	return db.CreateCompanyMemberParams{
		ID:        m.ID,
		UserID:    m.UserID,
		CompanyID: m.CompanyID,
		Role:      m.Role.String(),
	}
}

// memberToEntity rebuilds the domain entity from a sqlc row. The role
// is parsed through the closed-set VO so an unrecognized value (a row
// that survived a past migration with a bad role) fails loudly instead
// of silently producing a zero-valued MemberRole aggregate. Timestamps
// come back as pgtype.Timestamptz — Valid is always true for rows we
// just read, but we defensively surface the zero time on !Valid.
func memberToEntity(row db.CompanyMember) (*entities.CompanyMember, error) {
	role, err := valueobjects.ParseMemberRole(row.Role)
	if err != nil {
		return nil, fmt.Errorf("invalid role in company_members row %q: %w", row.Role, err)
	}
	return &entities.CompanyMember{
		ID:        row.ID,
		UserID:    row.UserID,
		CompanyID: row.CompanyID,
		Role:      role,
		CreatedAt: pgTimestamptzToTime(row.CreatedAt),
		UpdatedAt: pgTimestamptzToTime(row.UpdatedAt),
	}, nil
}

// pgTimestamptzToTime extracts the time.Time from a pgtype.Timestamptz,
// returning the zero time when the column is NULL (which "shouldn't
// happen" on company_members but we don't trust the DB unconditionally).
func pgTimestamptzToTime(t pgtype.Timestamptz) time.Time {
	if !t.Valid {
		return time.Time{}
	}
	return t.Time
}

// memberListRowToEntity maps a ListByCompanyIDRow (member LEFT JOIN user)
// into the list read-model projection. When the LEFT JOIN found no live user
// (user_id is SQL NULL), the projection's User is nil so the HTTP layer
// renders `user: null` for that member rather than dropping it.
func memberListRowToEntity(row db.ListByCompanyIDRow) entities.MemberListRow {
	item := entities.MemberListRow{
		ID:        row.ID,
		CompanyID: row.CompanyID,
		Role:      row.Role,
		CreatedAt: pgTimestamptzToTime(row.CreatedAt).UTC().Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: pgTimestamptzToTime(row.UpdatedAt).UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if row.UserID.Valid {
		item.User = &entities.MemberUser{
			ID:       row.UserID.Bytes,
			FullName: row.UserFullName.String,
			Email:    row.UserEmail.String,
		}
	}
	return item
}

// mapCreateError translates Postgres constraint violations on the
// `company_members` table into domain errors so the HTTP layer can return
// 4xx instead of leaking 500s for client errors. Distinct from
// mapCompanyCreateError (companyRepository.go) — same SQLSTATE codes mean
// different domain errors on different tables.
//
// Mapping contract (design error table):
//   - 23505 (unique_violation on UNIQUE(user_id))
//     → entities.ErrMemberExists — duplicate user, surface as 409.
//   - 23503 (foreign_key_violation on user_id OR company_id)
//     → entities.ErrUserNotFound — FK target missing; the HTTP layer
//     maps both user_id and company_id FK failures to 404 because the
//     wire shape cannot meaningfully distinguish them.
//   - any other SQLSTATE, or a non-pg error (connection failure,
//     context cancellation, driver bug), passes through unchanged. The
//     caller is responsible for logging it and returning 500; the HTTP
//     layer MUST NOT see a coerced 4xx for an unknown error class.
//
// The DB CHECK on `role` produces 23514 — also pass-through, because
// letting a bad role past NewCompanyMember is a real bug, not a client
// error.
func mapCreateError(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505": // unique_violation on UNIQUE(user_id)
			return entities.ErrMemberExists
		case "23503": // foreign_key_violation on user_id or company_id
			return entities.ErrUserNotFound
		}
	}
	return err
}
