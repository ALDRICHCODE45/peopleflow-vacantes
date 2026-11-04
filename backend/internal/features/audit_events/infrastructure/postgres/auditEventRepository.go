// Package postgres implements the audit_events repository port against
// PostgreSQL (design D4). The adapter is stateless: it owns no pool and opens
// no transaction — Append runs inside the caller-owned pgx.Tx supplied through
// the port, which is exactly the co-write atomicity contract (the port MUST
// NOT begin or commit a transaction of its own).
package postgres

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/requestmeta"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// AuditEventRepository is the stateless sqlc adapter for the append-only
// audit port. It holds no pool and opens no transaction: the pgx.Tx is
// supplied by the emitting write-path adapter, so a write and its audit event
// commit together or not at all (fail-closed co-write).
type AuditEventRepository struct{}

// NewAuditEventRepository returns the stateless audit adapter.
func NewAuditEventRepository() *AuditEventRepository { return &AuditEventRepository{} }

// Compile-time assertion that the adapter satisfies the domain port. A future
// port change here surfaces as a build error, never a runtime surprise.
var _ auditrepositories.AuditEventRepository = (*AuditEventRepository)(nil)

// Append marshals the PII-free metadata map to JSON bytes and inserts the
// event inside the caller-owned transaction. Each failure is wrapped so the
// co-write caller can abort the transaction fail-closed (no write without its
// audit trail).
func (r *AuditEventRepository) Append(ctx context.Context, tx pgx.Tx, event auditentities.AuditEvent) error {
	var metadata any = event.Metadata
	if event.StructuredMetadata != nil {
		metadata = event.StructuredMetadata
	}
	meta, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal audit metadata: %w", err)
	}
	params := applyRequestMeta(ctx, buildInsertAuditEventParams(event, meta))
	if err := db.New(tx).InsertAuditEvent(ctx, params); err != nil {
		return fmt.Errorf("insert audit event: %w", err)
	}
	return nil
}

// buildInsertAuditEventParams maps the domain event to the sqlc-generated
// params. ActorID is nullable: a non-nil *uuid.UUID maps to a Valid
// pgtype.UUID ('user' events); nil maps to the pgtype.UUID zero value
// ('system' events carry SQL NULL). Metadata arrives pre-marshaled from
// Append (JSONB → []byte under pgx/v5).
func buildInsertAuditEventParams(event auditentities.AuditEvent, metadata []byte) db.InsertAuditEventParams {
	params := db.InsertAuditEventParams{
		ID:         event.ID,
		ActorType:  event.ActorType.String(),
		EventType:  event.EventType,
		EntityType: event.EntityType,
		EntityID:   event.EntityID,
		Metadata:   metadata,
	}
	if event.ActorID != nil {
		params.ActorID = pgtype.UUID{Bytes: *event.ActorID, Valid: true}
	}
	if event.CompanyID != nil {
		params.CompanyID = pgtype.UUID{Bytes: *event.CompanyID, Valid: true}
	}
	if event.VacancyID != nil {
		params.VacancyID = pgtype.UUID{Bytes: *event.VacancyID, Valid: true}
	}
	return params
}

// applyRequestMeta adds ip, user_agent and ip_source from the request context
// set by the requestmeta middleware (audit-log-v1 §4). Emitters never pass
// them. A context without metadata (system jobs, tests) leaves all three NULL.
func applyRequestMeta(ctx context.Context, params db.InsertAuditEventParams) db.InsertAuditEventParams {
	meta, ok := requestmeta.FromContext(ctx)
	if !ok {
		return params
	}
	params.Ip = meta.IP
	if meta.UserAgent != nil {
		params.UserAgent = pgtype.Text{String: *meta.UserAgent, Valid: true}
	}
	if meta.IPSource != "" {
		params.IpSource = pgtype.Text{String: meta.IPSource, Valid: true}
	}
	return params
}
