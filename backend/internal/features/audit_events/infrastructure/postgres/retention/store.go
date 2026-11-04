// Package retention deletes audit_events rows that outlived the 24 month
// retention (audit-log-v1 §7). It is the only DELETE the append-only trigger of
// migration 00056 lets through (§6): a row older than the retention, inside a
// transaction that bound peopleflow.audit_purge to its own txid.
package retention

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultBatchSize is the number of rows one purge transaction deletes.
const DefaultBatchSize = 1000

// expired is the retention cutoff. It must stay identical to the predicate in
// the audit_events_append_only() trigger function (migration 00056); the store
// never selects a row newer than this, so the trigger is a backstop, not a
// path the store relies on.
const expired = `occurred_at < now() - interval '24 months'`

// Store counts and deletes expired audit rows.
type Store struct {
	pool      *pgxpool.Pool
	batchSize int
}

// NewStore returns a Store that deletes batchSize rows per transaction. A
// non-positive batchSize means DefaultBatchSize.
func NewStore(pool *pgxpool.Pool, batchSize int) *Store {
	if batchSize <= 0 {
		batchSize = DefaultBatchSize
	}
	return &Store{pool: pool, batchSize: batchSize}
}

// CountExpired returns how many rows are older than the retention. It changes
// nothing.
func (s *Store) CountExpired(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE `+expired).Scan(&n)
	return n, err
}

// DeleteExpired deletes every row older than the retention, oldest first, in
// batches. Each batch is its own transaction that first binds the purge flag to
// that transaction's id. It returns the rows deleted; on error it returns the
// rows deleted by the batches that already committed.
func (s *Store) DeleteExpired(ctx context.Context) (int64, error) {
	var total int64
	for {
		n, err := s.deleteBatch(ctx)
		total += n
		if err != nil {
			return total, err
		}
		if n < int64(s.batchSize) {
			return total, nil
		}
	}
}

func (s *Store) deleteBatch(ctx context.Context) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// is_local = true: the flag dies with the transaction, and it holds
		// this transaction's id, which the trigger compares to txid_current().
		if _, err := tx.Exec(ctx, `SELECT set_config('peopleflow.audit_purge', txid_current()::text, true)`); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
DELETE FROM audit_events
WHERE id IN (
    SELECT id FROM audit_events
    WHERE `+expired+`
    ORDER BY occurred_at, id
    LIMIT $1
    FOR UPDATE SKIP LOCKED
)`, s.batchSize)
		n = tag.RowsAffected()
		return err
	})
	if err != nil {
		return 0, err
	}
	return n, nil
}
