package postgres

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const PurgeBatchSize = 100

// PurgeCounts contains only aggregate counts, never candidate identifiers.
// Invitations counts scrubbed tombstones, not deleted invitation rows.
type PurgeCounts struct {
	Invitations  int64
	Answers      int64
	AnswerEvents int64
	Consents     int64
	Results      int64
	Comparisons  int64
}

// Only finite, non-NULL deadlines at or before the database clock qualify.
// Scrubbed tombstones are not work: this makes reruns finite and idempotent
// without changing the retention anchor or adding a scheduler/marker column.
const purgeEligible = `isfinite(i.purge_after) AND i.purge_after <= $1 AND (
 i.token_hash IS NOT NULL OR i.consented_at IS NOT NULL OR i.answered_count <> 0
 OR EXISTS(SELECT 1 FROM psychometric_answers a WHERE a.invitation_id=i.id)
 OR EXISTS(SELECT 1 FROM psychometric_answer_events e WHERE e.invitation_id=i.id)
 OR EXISTS(SELECT 1 FROM psychometric_consents c WHERE c.invitation_id=i.id)
 OR EXISTS(SELECT 1 FROM psychometric_results r WHERE r.invitation_id=i.id))`

// PurgeAssessmentData deletes dependent assessment data and scrubs invitations.
// Each batch owns only invitation locks, never acquiring parent locks afterward;
// this cannot invert the existing parent-first writer protocol. SKIP LOCKED lets
// concurrent invocations partition work; locked rows may be left for the owner
// or a later rerun. Writers recheck retention under the same invitation lock.
func PurgeAssessmentData(ctx context.Context, pool *pgxpool.Pool, execute bool) (PurgeCounts, error) {
	var total PurgeCounts
	for {
		counts, n, err := purgeBatch(ctx, pool, execute)
		if err != nil {
			return total, err
		}
		total.Invitations += counts.Invitations
		total.Answers += counts.Answers
		total.AnswerEvents += counts.AnswerEvents
		total.Consents += counts.Consents
		total.Results += counts.Results
		total.Comparisons += counts.Comparisons
		if !execute || n == 0 {
			return total, nil
		}
	}
}

func purgeBatch(ctx context.Context, pool *pgxpool.Pool, execute bool) (PurgeCounts, int, error) {
	var c PurgeCounts
	opts := pgx.TxOptions{}
	if !execute {
		opts = pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}
	}
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return c, 0, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	now, err := invitationNow(ctx, tx)
	if err != nil {
		return c, 0, err
	}
	selected := `SELECT i.id FROM psychometric_invitations i WHERE ` + purgeEligible
	var ids []uuid.UUID
	var lockedCount int
	if execute {
		rows, err := tx.Query(ctx, selected+` ORDER BY i.purge_after,i.id LIMIT $2 FOR UPDATE OF i SKIP LOCKED`, now, PurgeBatchSize)
		if err != nil {
			return c, 0, err
		}
		for rows.Next() {
			var id uuid.UUID
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return c, 0, err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return c, 0, err
		}
		lockedCount = len(ids)
		// A competing purge may commit between the SELECT snapshot and row
		// locking. EvalPlanQual can still see its deleted children through the
		// original statement's snapshot. Recheck with a fresh statement after
		// owning the locks, or an already scrubbed tombstone is double-counted.
		rows, err = tx.Query(ctx, selected+` AND i.id=ANY($2::uuid[])`, now, ids)
		if err != nil {
			return c, 0, err
		}
		ids = nil
		for rows.Next() {
			var id uuid.UUID
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return c, 0, err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return c, 0, err
		}
		c.Invitations = int64(len(ids))
	} else {
		if err = tx.QueryRow(ctx, `SELECT count(*) FROM (`+selected+`) eligible`, now).Scan(&c.Invitations); err != nil {
			return c, 0, err
		}
	}
	// Delete comparisons explicitly before results, so cascade deletion never
	// hides their counts. All table names are a closed static allowlist.
	for _, table := range []struct {
		name  string
		count *int64
	}{
		{"psychometric_comparisons", &c.Comparisons},
		{"psychometric_results", &c.Results},
		{"psychometric_answer_events", &c.AnswerEvents},
		{"psychometric_answers", &c.Answers},
		{"psychometric_consents", &c.Consents},
	} {
		if execute {
			tag, err := tx.Exec(ctx, `DELETE FROM `+table.name+` WHERE invitation_id=ANY($1::uuid[])`, ids)
			if err != nil {
				return c, 0, err
			}
			*table.count = tag.RowsAffected()
		} else {
			if err = tx.QueryRow(ctx, `SELECT count(*) FROM `+table.name+` WHERE invitation_id IN (`+selected+`)`, now).Scan(table.count); err != nil {
				return c, 0, err
			}
		}
	}
	if execute {
		_, err = tx.Exec(ctx, `UPDATE psychometric_invitations SET token_hash=NULL,consented_at=NULL,answered_count=0 WHERE id=ANY($1::uuid[])`, ids)
		if err != nil {
			return c, 0, err
		}
	}
	err = tx.Commit(ctx)
	return c, lockedCount, err
}
