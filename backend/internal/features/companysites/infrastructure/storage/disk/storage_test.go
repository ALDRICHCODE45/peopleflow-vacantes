package disk

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/application"
)

func newStorage(t *testing.T, dir string) *Storage {
	t.Helper()
	s, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestDiskImageRoundTrip(t *testing.T) {
	dir := t.TempDir()
	s := newStorage(t, dir)
	ctx := context.Background()
	key, err := s.Put(ctx, []byte("image bytes"))
	if err != nil || len(key) != 64 {
		t.Fatal(key, err)
	}
	if info, err := os.Stat(filepath.Join(dir, key)); err != nil || info.Mode().Perm() != 0600 {
		t.Fatal(info, err)
	}
	second, _ := s.Put(ctx, []byte("image bytes"))
	if second == key {
		t.Fatal("keys must be random")
	}
	f, err := s.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := f.Seek(0, io.SeekEnd); n != 11 {
		t.Fatal(n)
	}
	_, _ = f.Seek(6, io.SeekStart)
	got, _ := io.ReadAll(f)
	f.Close()
	if string(got) != "bytes" {
		t.Fatal(string(got))
	}
	if keys, err := s.Keys(ctx); err != nil || len(keys) != 2 {
		t.Fatal(keys, err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(ctx, key); err != nil {
		t.Fatal("deleting a missing key is a no-op", err)
	}
	if _, err := s.Open(ctx, key); !errors.Is(err, app.ErrMediaNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Put(ctx, make([]byte, app.MaxMediaBytes+1)); err == nil {
		t.Fatal("image over 5 MiB stored")
	}
}

// Files in the previous adapter's layout (the CV Local storage on the same
// CV_STORAGE_ROOT: flat 64-hex names) stay readable; cmd/api pins it against
// the real CV adapter.
func TestDiskReadsTheLegacyLayout(t *testing.T) {
	dir := t.TempDir()
	key := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	if err := os.WriteFile(filepath.Join(dir, key), []byte("legacy image"), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := newStorage(t, dir).Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if got, _ := io.ReadAll(f); string(got) != "legacy image" {
		t.Fatal(string(got))
	}
}

func TestDiskStreamRoundTrip(t *testing.T) {
	s := newStorage(t, t.TempDir())
	ctx := context.Background()
	data := bytes.Repeat([]byte{7}, app.MaxMediaBytes+10) // larger than any image
	key, err := s.PutStream(ctx, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	f, err := s.OpenRange(ctx, key, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if _, err := f.Seek(int64(len(data)-3), io.SeekStart); err != nil {
		t.Fatal(err)
	}
	if got, _ := io.ReadAll(f); len(got) != 3 {
		t.Fatal(len(got))
	}
}

func TestDiskStreamBoundsLeaveNothing(t *testing.T) {
	dir := t.TempDir()
	s := newStorage(t, dir)
	ctx := context.Background()
	for _, tc := range []struct {
		name string
		body []byte
		size int64
	}{
		{"short body", []byte("abc"), 4},
		{"long body", []byte("abcde"), 4},
		{"over the video cap", nil, app.MaxVideoBytes + 1},
		{"empty", nil, 0},
	} {
		if _, err := s.PutStream(ctx, bytes.NewReader(tc.body), tc.size); err == nil {
			t.Fatal(tc.name)
		}
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatal("partial files left", entries)
	}
}

func TestDiskKeysAreOpaque(t *testing.T) {
	dir := t.TempDir()
	s := newStorage(t, dir)
	ctx := context.Background()
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"../notes.txt", "notes.txt", "", "/etc/passwd"} {
		if f, err := s.Open(ctx, key); err == nil {
			f.Close()
			t.Fatal(key)
		}
		if err := s.Delete(ctx, key); err == nil {
			t.Fatal(key)
		}
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err := s.Put(cancelled, []byte("x")); err == nil {
		t.Fatal("cancelled put")
	}
}
