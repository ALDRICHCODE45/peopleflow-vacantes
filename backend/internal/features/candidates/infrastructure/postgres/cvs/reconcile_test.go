package cvs

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type reconcilePool struct{ tx *reconcileTx }

func (p reconcilePool) Begin(context.Context) (pgx.Tx, error) { return p.tx, nil }

type reconcileTx struct {
	pgx.Tx
	t           *testing.T
	locked      bool
	lookupError error
	query       string
}

func (tx *reconcileTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	if query != "SELECT pg_advisory_xact_lock($1)" || len(args) != 1 || args[0] != StorageLock {
		tx.t.Fatalf("unexpected lock: %s %v", query, args)
	}
	tx.locked = true
	return pgconn.CommandTag{}, nil
}
func (tx *reconcileTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	if !tx.locked {
		tx.t.Fatal("lookup before shared-storage lock")
	}
	tx.query = query
	return reconcileRow{keep: args[0] == "manual-key", err: tx.lookupError}
}
func (tx *reconcileTx) Rollback(context.Context) error { tx.locked = false; return nil }

type reconcileRow struct {
	keep bool
	err  error
}

func (r reconcileRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*dest[0].(*bool) = r.keep
	return nil
}

type reconcileStorage struct {
	tx      *reconcileTx
	deleted []string
	keys    []string
}

func (s *reconcileStorage) Keys(context.Context) ([]string, error) {
	if !s.tx.locked {
		s.tx.t.Fatal("enumeration before storage lock")
	}
	return s.keys, nil
}
func (s *reconcileStorage) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}
func (*reconcileStorage) Put(context.Context, []byte) (string, error) { panic("unexpected Put") }
func (*reconcileStorage) Open(context.Context, string) (io.ReadCloser, error) {
	panic("unexpected Open")
}

func TestReconcileRetainsCompanyCVAndRemovesOrphan(t *testing.T) {
	tx := &reconcileTx{t: t}
	storage := &reconcileStorage{tx: tx, keys: []string{"manual-key", "orphan-key"}}
	library := &Library{pool: reconcilePool{tx}, storage: storage}
	if err := library.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(storage.deleted) != 1 || storage.deleted[0] != "orphan-key" {
		t.Fatalf("deleted=%v", storage.deleted)
	}
	if !strings.Contains(tx.query, "company_candidate_cvs") || !strings.Contains(tx.query, "storage_key=$1") {
		t.Fatalf("retention query omits company-owned CVs: %s", tx.query)
	}
	if tx.locked {
		t.Fatal("lock transaction not released")
	}
}
func TestReconcileLookupFailureKeepsFiles(t *testing.T) {
	failure := errors.New("lookup unavailable")
	tx := &reconcileTx{t: t, lookupError: failure}
	storage := &reconcileStorage{tx: tx, keys: []string{"manual-key"}}
	library := &Library{pool: reconcilePool{tx}, storage: storage}
	if err := library.Reconcile(context.Background()); !errors.Is(err, failure) {
		t.Fatalf("error=%v", err)
	}
	if len(storage.deleted) != 0 {
		t.Fatalf("deleted=%v", storage.deleted)
	}
	if tx.locked {
		t.Fatal("failed lookup retained transaction")
	}
}
