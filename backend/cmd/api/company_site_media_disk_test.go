package main

import (
	"bytes"
	"context"
	"io"
	"testing"

	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	sitesdisk "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companysites/infrastructure/storage/disk"
)

// Before slice B, disk-mode site images were written by the CV Local adapter on
// CV_STORAGE_ROOT. The site media disk adapter wired in main opens the same
// root: those files stay readable and seekable, and its own files are visible
// to (and kept by) the CV reconciliation's key listing.
func TestCompanySiteDiskAdapterSharesTheCVRoot(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()
	cv, err := cvstorage.NewLocal(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer cv.Close()
	site, err := sitesdisk.New(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer site.Close()
	legacy, err := cv.Put(ctx, []byte("image written before slice B"))
	if err != nil {
		t.Fatal(err)
	}
	f, err := site.Open(ctx, legacy)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = f.Seek(6, io.SeekStart)
	got, _ := io.ReadAll(f)
	f.Close()
	if string(got) != "written before slice B" {
		t.Fatal(string(got))
	}
	video := bytes.Repeat([]byte{1}, 6<<20)
	key, err := site.PutStream(ctx, bytes.NewReader(video), int64(len(video)))
	if err != nil {
		t.Fatal(err)
	}
	keys, err := cv.Keys(ctx)
	if err != nil || len(keys) != 2 {
		t.Fatal(keys, err)
	}
	if r, err := cv.Open(ctx, key); err != nil {
		t.Fatal(err)
	} else {
		r.Close()
	}
}
