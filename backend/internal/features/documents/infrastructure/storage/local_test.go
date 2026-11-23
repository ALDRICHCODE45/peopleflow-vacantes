package storage

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"testing/iotest"
	"time"

	documents "github.com/aldrichcode45/peopleflow-vacantes/internal/features/documents/application"
)

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func newLocal(t *testing.T) (*Local, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "documents")
	s, err := NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s, dir
}

func TestLocalRequiresRoot(t *testing.T) {
	if _, err := NewLocal(""); err == nil {
		t.Fatal("empty root accepted")
	}
}

func TestLocalPutOpenDelete(t *testing.T) {
	s, dir := newLocal(t)
	ctx := context.Background()
	data := bytes.Repeat([]byte("contrato "), 1000)
	key, size, err := s.Put(ctx, bytes.NewReader(data), documents.MaxBytes)
	if err != nil {
		t.Fatal(err)
	}
	if !hex64.MatchString(key) || size != int64(len(data)) {
		t.Fatalf("key=%q size=%d", key, size)
	}
	info, err := os.Stat(filepath.Join(dir, key))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("file mode: %v %v", info, err)
	}
	body, err := s.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(body)
	_ = body.Close()
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("round trip changed bytes: %v", err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Open(ctx, key); !errors.Is(err, documents.ErrNotFound) {
		t.Fatalf("open after delete: %v", err)
	}
	// Deleting a missing key is fine (idempotent).
	if err := s.Delete(ctx, key); err != nil {
		t.Fatalf("missing delete: %v", err)
	}
}

func TestLocalPutKeysAreRandomAndNeverOverwrite(t *testing.T) {
	s, _ := newLocal(t)
	seen := map[string]bool{}
	for i := 0; i < 20; i++ {
		key, _, err := s.Put(context.Background(), bytes.NewReader([]byte("same bytes")), documents.MaxBytes)
		if err != nil {
			t.Fatal(err)
		}
		if seen[key] {
			t.Fatal("duplicate key for identical content")
		}
		seen[key] = true
	}
}

func TestLocalPutSizeCap(t *testing.T) {
	s, dir := newLocal(t)
	ctx := context.Background()
	// Exactly the limit is stored.
	key, size, err := s.Put(ctx, bytes.NewReader(make([]byte, 100)), 100)
	if err != nil || size != 100 {
		t.Fatalf("at limit: %d %v", size, err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	// One byte over is refused and leaves nothing behind.
	if _, _, err := s.Put(ctx, bytes.NewReader(make([]byte, 101)), 100); !errors.Is(err, documents.ErrTooLarge) {
		t.Fatalf("over limit: %v", err)
	}
	assertEmpty(t, dir)
	// The product limit is the one of the contract.
	if documents.MaxBytes != 10485760 {
		t.Fatalf("MaxBytes=%d", documents.MaxBytes)
	}
	if _, _, err := s.Put(ctx, bytes.NewReader(nil), 0); err == nil {
		t.Fatal("non-positive limit accepted")
	}
}

func TestLocalPutRemovesPartialObjectOnReaderError(t *testing.T) {
	s, dir := newLocal(t)
	boom := errors.New("client disconnected")
	_, _, err := s.Put(context.Background(), io.MultiReader(bytes.NewReader([]byte("partial")), iotest.ErrReader(boom)), documents.MaxBytes)
	if !errors.Is(err, boom) {
		t.Fatalf("reader error not returned: %v", err)
	}
	assertEmpty(t, dir)
}

func TestLocalPutHonoursCancelledContext(t *testing.T) {
	s, dir := newLocal(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := s.Put(ctx, bytes.NewReader([]byte("x")), 10); !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	assertEmpty(t, dir)
}

func TestLocalRejectsInvalidKeys(t *testing.T) {
	s, dir := newLocal(t)
	ctx := context.Background()
	outside := filepath.Join(filepath.Dir(dir), "outside")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"", "../outside", "short", "../../etc/passwd", string(bytes.Repeat([]byte("A"), 64)), string(bytes.Repeat([]byte("g"), 64)), string(bytes.Repeat([]byte("a"), 63)) + "/"} {
		if _, err := s.Open(ctx, key); !errors.Is(err, documents.ErrInvalidKey) {
			t.Errorf("Open(%q)=%v", key, err)
		}
		if err := s.Delete(ctx, key); !errors.Is(err, documents.ErrInvalidKey) {
			t.Errorf("Delete(%q)=%v", key, err)
		}
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("file outside the root was touched")
	}
}

func TestLocalOpenRefusesSymlinks(t *testing.T) {
	s, dir := newLocal(t)
	outside := filepath.Join(filepath.Dir(dir), "outside")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	link := string(bytes.Repeat([]byte("b"), 64))
	if err := os.Symlink(outside, filepath.Join(dir, link)); err != nil {
		t.Skip("symlinks unavailable")
	}
	if body, err := s.Open(context.Background(), link); err == nil {
		_ = body.Close()
		t.Fatal("symlink to a file outside the root was opened")
	}
}

func TestLocalObjectsListsOnlyRegularKeyFilesWithModTime(t *testing.T) {
	s, dir := newLocal(t)
	ctx := context.Background()
	key, _, err := s.Put(ctx, bytes.NewReader([]byte("doc")), 10)
	if err != nil {
		t.Fatal(err)
	}
	// Foreign entries are never listed (so Reconcile can never delete them).
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, string(bytes.Repeat([]byte("c"), 64))), 0700); err != nil {
		t.Fatal(err)
	}
	old := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(dir, key), old, old); err != nil {
		t.Fatal(err)
	}
	objects, err := s.Objects(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(objects) != 1 || objects[0].Key != key || !objects[0].ModTime.Equal(old) {
		t.Fatalf("objects=%+v", objects)
	}
}

func assertEmpty(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("storage root not empty: %v %v", entries, err)
	}
}
