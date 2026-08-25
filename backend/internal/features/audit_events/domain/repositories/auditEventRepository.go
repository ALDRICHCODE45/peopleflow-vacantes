// Package repositories holds the audit_events repository ports (design D4).
// The single AuditEventRepository port is append-only and tx-scoped by
// contract: the caller owns the pgx.Tx, so the co-write atomicity invariant
// (write + audit event commit together or not at all) is structural.
package repositories

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	"github.com/jackc/pgx/v5"
)

// AuditEventRepository is the append-only audit port. It exposes exactly ONE
// operation. The port is tx-scoped by contract: Append runs inside a
// caller-owned pgx.Tx and MUST NOT begin or commit a transaction of its own
// (the co-write atomicity contract — see the applications delta's
// "Fail-Closed Application + Audit Co-Write"). There is deliberately no
// Update / Delete / Read / List / Backfill method: append-only is enforced
// by the absence of surface.
type AuditEventRepository interface {
	Append(ctx context.Context, tx pgx.Tx, event entities.AuditEvent) error
}
