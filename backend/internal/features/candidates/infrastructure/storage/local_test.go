package storage

import (
	"context"
	"errors"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	"io"
	"os"
	"testing"
)

func TestReconcilePreservesReferencedFilesAndFailsClosed(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	live, _ := s.Put(ctx, []byte("live"))
	used, _ := s.Put(ctx, []byte("used"))
	orphan, _ := s.Put(ctx, []byte("orphan"))
	unavailable := errors.New("database unavailable")
	if err = app.ReconcileOrphans(ctx, s, func(context.Context, string) (bool, error) { return false, unavailable }); !errors.Is(err, unavailable) {
		t.Fatal(err)
	}
	keys, _ := s.Keys(ctx)
	if len(keys) != 3 {
		t.Fatal("database failure deleted files")
	}
	if err = app.ReconcileOrphans(ctx, s, func(_ context.Context, key string) (bool, error) { return key == live || key == used, nil }); err != nil {
		t.Fatal(err)
	}
	keys, _ = s.Keys(ctx)
	if len(keys) != 2 {
		t.Fatal(keys)
	}
	if f, err := s.Open(ctx, orphan); err == nil {
		f.Close()
		t.Fatal("orphan survived")
	}
}

// §10.5: only opaque random keys can address private disk objects.
func TestLocalPrivateRandomKeysAndTraversal(t *testing.T) {
	s, err := NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	a, err := s.Put(ctx, []byte("private"))
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Put(ctx, []byte("private"))
	if err != nil || a == b {
		t.Fatal("keys are not random", err)
	}
	f, err := s.Open(ctx, a)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(f)
	f.Close()
	if err != nil || string(data) != "private" {
		t.Fatal("bad read", err)
	}
	for _, key := range []string{"../outside", "/etc/passwd", "", a + "/../" + b, "A" + a[1:]} {
		if f, err := s.Open(ctx, key); err == nil {
			f.Close()
			t.Fatalf("opened invalid key %q", key)
		}
		if err := s.Delete(ctx, key); err == nil {
			t.Fatalf("deleted invalid key %q", key)
		}
	}
	keys, err := s.Keys(ctx)
	if err != nil || len(keys) != 2 {
		t.Fatal(keys, err)
	}
	if err := s.Delete(ctx, a); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(ctx, a); !os.IsNotExist(err) {
		t.Fatal("not deleted", err)
	}
}
