package main

import (
	"context"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultBatchSize is the number of rows one purge transaction deletes.
const defaultBatchSize = 1000

// counts is the per-table result of a dry run or an execution.
type counts struct {
	notifications, events, deliveries int64
}

// store counts and deletes notification rows past the 180 day retention
// (notifications-v1 D22) and terminal email deliveries past the same
// retention (notifications-v2 D20). The cutoff lives in the sqlc queries
// (db/queries/notifications.sql, *Expired*).
type store struct {
	pool      *pgxpool.Pool
	batchSize int32
}

func newStore(pool *pgxpool.Pool, batchSize int) *store {
	if batchSize <= 0 {
		batchSize = defaultBatchSize
	}
	return &store{pool: pool, batchSize: int32(batchSize)}
}

// countExpired changes nothing.
func (s *store) countExpired(ctx context.Context) (counts, error) {
	q := db.New(s.pool)
	var c counts
	var err error
	if c.notifications, err = q.CountExpiredNotifications(ctx); err != nil {
		return counts{}, err
	}
	if c.events, err = q.CountExpiredNotificationEvents(ctx); err != nil {
		return counts{}, err
	}
	if c.deliveries, err = q.CountExpiredNotificationEmailDeliveries(ctx); err != nil {
		return counts{}, err
	}
	return c, nil
}

// deleteExpired purges notifications first, then events, so an event whose
// last notification expired in this run goes in the same run, then terminal
// email deliveries: their expired notifications are already gone, and a
// remaining notification linked to a purged delivery gets email_delivery_id
// NULL (ON DELETE SET NULL), never a dangling reference. Each batch is its own
// transaction; on error the batches already committed stay committed.
func (s *store) deleteExpired(ctx context.Context) (counts, error) {
	var c counts
	var err error
	if c.notifications, err = s.drain(ctx, (*db.Queries).DeleteExpiredNotifications); err != nil {
		return c, err
	}
	if c.events, err = s.drain(ctx, (*db.Queries).DeleteExpiredNotificationEvents); err != nil {
		return c, err
	}
	c.deliveries, err = s.drain(ctx, (*db.Queries).DeleteExpiredNotificationEmailDeliveries)
	return c, err
}

// drain runs batches until one deletes nothing (not the first short one: with
// SKIP LOCKED a batch can be short while expired rows remain). A cancelled
// context ends the loop.
func (s *store) drain(ctx context.Context, batch func(*db.Queries, context.Context, int32) (int64, error)) (int64, error) {
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		var n int64
		err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			var err error
			n, err = batch(db.New(tx), ctx, s.batchSize)
			return err
		})
		if err != nil {
			return total, err
		}
		total += n
		if n == 0 {
			return total, nil
		}
	}
}
