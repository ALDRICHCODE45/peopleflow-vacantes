package postgres

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
	"github.com/jackc/pgx/v5"
)

type lookupDB struct {
	referenced map[string]bool
	err        error
	queries    []string
	asked      []string
}

func (d *lookupDB) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	d.queries = append(d.queries, query)
	d.asked = append(d.asked, args[0].(string))
	return lookupRow{keep: d.referenced[args[0].(string)], err: d.err}
}

type lookupRow struct {
	keep bool
	err  error
}

func (r lookupRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*dest[0].(*bool) = r.keep
	return nil
}

type listedStorage struct {
	objects []documents.Object
	deleted []string
}

func (s *listedStorage) Put(context.Context, io.Reader, int64) (string, int64, error) {
	panic("unexpected Put")
}
func (s *listedStorage) Open(context.Context, string) (io.ReadCloser, error) {
	panic("unexpected Open")
}
func (s *listedStorage) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}
func (s *listedStorage) Objects(context.Context) ([]documents.Object, error) { return s.objects, nil }

func TestReconcileKeepsReferencedAndYoungObjects(t *testing.T) {
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	old := now.Add(-2 * time.Hour)
	st := &listedStorage{objects: []documents.Object{
		{Key: "referenced", ModTime: old},
		{Key: "orphan", ModTime: old},
		{Key: "young-orphan", ModTime: now.Add(-10 * time.Minute)},
	}}
	db := &lookupDB{referenced: map[string]bool{"referenced": true}}
	r := &Reconciler{db: db, storage: st, now: func() time.Time { return now }}
	if err := r.Reconcile(context.Background()); err != nil {
		t.Fatal(err)
	}
	if strings.Join(st.deleted, ",") != "orphan" {
		t.Fatalf("deleted=%v", st.deleted)
	}
	if strings.Join(db.asked, ",") != "referenced,orphan" {
		t.Fatalf("a young object was looked up: %v", db.asked)
	}
	for _, q := range db.queries {
		if !strings.Contains(q, "placement_document_versions") || !strings.Contains(q, "storage_key=$1") {
			t.Fatalf("lookup does not use the version rows: %s", q)
		}
	}
}

func TestReconcileLookupFailureDeletesNothing(t *testing.T) {
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	boom := errors.New("lookup unavailable")
	st := &listedStorage{objects: []documents.Object{{Key: "a", ModTime: now.Add(-2 * time.Hour)}}}
	r := &Reconciler{db: &lookupDB{err: boom}, storage: st, now: func() time.Time { return now }}
	if err := r.Reconcile(context.Background()); !errors.Is(err, boom) || len(st.deleted) != 0 {
		t.Fatalf("err=%v deleted=%v", err, st.deleted)
	}
}

// WithClock replaces the clock the grace window is judged against (tests that cannot age an object, such as one in S3, move
// «now» forward instead) and returns the reconciler for chaining.
func TestReconcileWithClockJudgesTheGraceWindowAgainstTheInjectedNow(t *testing.T) {
	stored := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	st := &listedStorage{objects: []documents.Object{{Key: "orphan", ModTime: stored}}}
	r := NewReconciler(&lookupDB{}, st)
	r.now = func() time.Time { return stored.Add(10 * time.Minute) }
	if err := r.Reconcile(context.Background()); err != nil || len(st.deleted) != 0 {
		t.Fatalf("young: err=%v deleted=%v", err, st.deleted)
	}
	if got := r.WithClock(func() time.Time { return stored.Add(documents.OrphanGrace + time.Minute) }); got != r {
		t.Fatal("WithClock must return the receiver")
	}
	if err := r.Reconcile(context.Background()); err != nil || strings.Join(st.deleted, ",") != "orphan" {
		t.Fatalf("old: err=%v deleted=%v", err, st.deleted)
	}
}
