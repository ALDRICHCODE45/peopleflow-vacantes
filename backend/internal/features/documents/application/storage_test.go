package documents_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

func TestBoundedReaderCapsAtMaxBytes(t *testing.T) {
	// Exactly at the limit: everything is delivered and no error is recorded.
	b := documents.NewBoundedReader(context.Background(), strings.NewReader("abcde"), 5)
	got, err := io.ReadAll(b)
	if err != nil || string(got) != "abcde" || b.N() != 5 || b.Err() != nil {
		t.Fatalf("at limit: %q err=%v n=%d recorded=%v", got, err, b.N(), b.Err())
	}
	// One byte over: never more than maxBytes is handed to the consumer, and the cause is ErrTooLarge.
	b = documents.NewBoundedReader(context.Background(), strings.NewReader("abcdef"), 5)
	got, err = io.ReadAll(b)
	if !errors.Is(err, documents.ErrTooLarge) || !errors.Is(b.Err(), documents.ErrTooLarge) || string(got) != "abcde" || b.N() != 5 {
		t.Fatalf("over limit: %q err=%v n=%d recorded=%v", got, err, b.N(), b.Err())
	}
	// Reading one byte at a time must not change the outcome.
	b = documents.NewBoundedReader(context.Background(), iotest.OneByteReader(strings.NewReader("abcdef")), 5)
	if got, err = io.ReadAll(b); !errors.Is(err, documents.ErrTooLarge) || string(got) != "abcde" {
		t.Fatalf("one byte reader: %q err=%v", got, err)
	}
}

func TestBoundedReaderRecordsSourceAndContextErrors(t *testing.T) {
	boom := errors.New("client went away")
	b := documents.NewBoundedReader(context.Background(), io.MultiReader(strings.NewReader("ab"), iotest.ErrReader(boom)), 10)
	if _, err := io.ReadAll(b); !errors.Is(err, boom) || !errors.Is(b.Err(), boom) {
		t.Fatalf("source error lost: %v / %v", err, b.Err())
	}
	// A clean EOF is not an error.
	b = documents.NewBoundedReader(context.Background(), bytes.NewReader(nil), 10)
	if _, err := io.ReadAll(b); err != nil || b.Err() != nil {
		t.Fatalf("eof recorded as error: %v / %v", err, b.Err())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	b = documents.NewBoundedReader(ctx, strings.NewReader("abc"), 10)
	if _, err := io.ReadAll(b); !errors.Is(err, context.Canceled) || !errors.Is(b.Err(), context.Canceled) {
		t.Fatalf("cancelled context not honoured: %v / %v", err, b.Err())
	}
}

type fakeObjects struct {
	objects  []documents.Object
	listErr  error
	deleted  []string
	deleteEr error
}

func (f *fakeObjects) Put(context.Context, io.Reader, int64) (string, int64, error) {
	panic("unexpected Put")
}
func (f *fakeObjects) Open(context.Context, string) (io.ReadCloser, error) { panic("unexpected Open") }
func (f *fakeObjects) Delete(_ context.Context, key string) error {
	f.deleted = append(f.deleted, key)
	return f.deleteEr
}
func (f *fakeObjects) Objects(context.Context) ([]documents.Object, error) {
	return f.objects, f.listErr
}

func TestReconcileOrphansGraceWindow(t *testing.T) {
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	st := &fakeObjects{objects: []documents.Object{
		{Key: "referenced-old", ModTime: now.Add(-3 * time.Hour)},
		{Key: "orphan-old", ModTime: now.Add(-documents.OrphanGrace - time.Second)},
		{Key: "orphan-exactly-grace", ModTime: now.Add(-documents.OrphanGrace)},
		{Key: "orphan-young", ModTime: now.Add(-59 * time.Minute)},
		{Key: "orphan-future", ModTime: now.Add(10 * time.Minute)},
		{Key: "orphan-zero-time"},
	}}
	var looked []string
	err := documents.ReconcileOrphans(context.Background(), st, now, func(_ context.Context, key string) (bool, error) {
		looked = append(looked, key)
		return key == "referenced-old", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(st.deleted, ",") != "orphan-old,orphan-exactly-grace" {
		t.Fatalf("deleted=%v", st.deleted)
	}
	// Young, future-dated and undated objects are kept without even asking the database.
	if strings.Join(looked, ",") != "referenced-old,orphan-old,orphan-exactly-grace" {
		t.Fatalf("looked=%v", looked)
	}
}

func TestReconcileOrphansFailsClosed(t *testing.T) {
	now := time.Date(2026, 11, 22, 12, 0, 0, 0, time.UTC)
	old := now.Add(-2 * time.Hour)
	lookup := errors.New("lookup failed")
	st := &fakeObjects{objects: []documents.Object{{Key: "a", ModTime: old}, {Key: "b", ModTime: old}}}
	if err := documents.ReconcileOrphans(context.Background(), st, now, func(context.Context, string) (bool, error) { return false, lookup }); !errors.Is(err, lookup) || len(st.deleted) != 0 {
		t.Fatalf("lookup failure must delete nothing: err=%v deleted=%v", err, st.deleted)
	}
	list := errors.New("list failed")
	st = &fakeObjects{listErr: list}
	if err := documents.ReconcileOrphans(context.Background(), st, now, func(context.Context, string) (bool, error) { return false, nil }); !errors.Is(err, list) {
		t.Fatalf("list failure: %v", err)
	}
	del := errors.New("delete failed")
	st = &fakeObjects{objects: []documents.Object{{Key: "a", ModTime: old}, {Key: "b", ModTime: old}}, deleteEr: del}
	if err := documents.ReconcileOrphans(context.Background(), st, now, func(context.Context, string) (bool, error) { return false, nil }); !errors.Is(err, del) || len(st.deleted) != 1 {
		t.Fatalf("delete failure must stop: err=%v deleted=%v", err, st.deleted)
	}
}
