// Package postgres holds the SQL side of the documents feature: Reconcile (P2) and the read store (P3); writes arrive with their routes.
package postgres

import (
	"context"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/jackc/pgx/v5"
)

// rowQuerier is the part of *pgxpool.Pool that Reconcile needs.
type rowQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Reconciler removes document objects that no version row references (D25).
type Reconciler struct {
	db      rowQuerier
	storage documents.Storage
	now     func() time.Time
}

// NewReconciler builds the reconciler over the documents storage and the pool.
func NewReconciler(db rowQuerier, storage documents.Storage) *Reconciler {
	return &Reconciler{db: db, storage: storage, now: time.Now}
}

// WithClock sets the clock the grace window is judged against and returns r. Production keeps time.Now; a test that cannot age
// an object (one in S3 has a provider-set modification time) moves «now» forward instead.
func (r *Reconciler) WithClock(now func() time.Time) *Reconciler {
	r.now = now
	return r
}

// Reconcile keeps an object iff a placement_document_versions row references its key or it is younger than
// documents.OrphanGrace; everything else is deleted. No lock is taken and no transaction is held open: an in-flight upload
// is protected by its age, not by blocking the database. A failed lookup fails closed (the run stops, nothing more is deleted).
func (r *Reconciler) Reconcile(ctx context.Context) error {
	return documents.ReconcileOrphans(ctx, r.storage, r.now(), func(ctx context.Context, key string) (bool, error) {
		var keep bool
		err := r.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM placement_document_versions v WHERE v.storage_key=$1)`, key).Scan(&keep)
		return keep, err
	})
}
