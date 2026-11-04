// Package audittest lets integration tests remove the audit rows their
// fixtures created. audit_events is append-only (migration 00056): the
// trigger refuses every application DELETE. Only a superuser may set
// session_replication_role, which skips ordinary triggers, so this helper works
// against the disposable test databases (superuser role) and never for the API's
// own code paths. Import it from tests only.
package audittest

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// RestoreAppendOnlyDDL re-applies the migration 00056 shape (columns, indexes
// and append-only triggers) to an audit_events table that a test dropped and
// recreated from the 00011 DDL. DROP TABLE removes the triggers but keeps the
// function, so a database that never ran 00056 (no function) is left alone.
// Kept in sync with db/migrations/00056_audit_log.sql by hand.
const RestoreAppendOnlyDDL = `
DO $restore$
BEGIN
    IF to_regprocedure('audit_events_append_only()') IS NULL THEN
        RETURN;
    END IF;
    ALTER TABLE audit_events
        ADD COLUMN company_id UUID,
        ADD COLUMN vacancy_id UUID,
        ADD COLUMN ip INET,
        ADD COLUMN user_agent TEXT,
        ADD COLUMN ip_source TEXT
            CONSTRAINT audit_events_ip_source_check CHECK (ip_source IN ('bff', 'peer'));
    CREATE INDEX audit_events_company_idx ON audit_events (company_id, occurred_at DESC, id DESC);
    CREATE INDEX audit_events_company_actor_idx ON audit_events (company_id, actor_id, occurred_at DESC);
    CREATE INDEX audit_events_company_vacancy_idx ON audit_events (company_id, vacancy_id, occurred_at DESC);
    CREATE INDEX audit_events_company_type_idx ON audit_events (company_id, event_type, occurred_at DESC);
    CREATE TRIGGER audit_events_append_only
        BEFORE UPDATE OR DELETE ON audit_events
        FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
    CREATE TRIGGER audit_events_no_truncate
        BEFORE TRUNCATE ON audit_events
        FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
END
$restore$;
`

// Beginner is satisfied by *pgxpool.Pool, *pgx.Conn and pgx.Tx.
type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Delete runs one statement against audit_events with the append-only trigger
// skipped for that transaction only. Use it for fixture cleanup, never to
// exercise behavior.
func Delete(ctx context.Context, db Beginner, query string, args ...any) error {
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
			return fmt.Errorf("audittest: bypass the append-only trigger (needs a superuser test role): %w", err)
		}
		_, err := tx.Exec(ctx, query, args...)
		return err
	})
}
