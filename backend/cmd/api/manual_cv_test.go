package main

import (
	"bytes"
	"context"
	"errors"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"io"
	"testing"
)

func TestManualCVComposition(t *testing.T) {
	for _, tc := range []struct {
		name, file string
		data       []byte
		want       error
	}{
		{"pdf", "resume.pdf", []byte("%PDF-1"), nil},
		{"mismatch", "resume.pdf", []byte("not a pdf"), app.ErrManualCVContentMismatch},
		{"type", "resume.txt", []byte("%PDF-1"), app.ErrManualCVUnsupportedType},
		{"size", "resume.pdf", bytes.Repeat([]byte("x"), cvs.MaxBytes+1), app.ErrManualCVTooLarge},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mime, err := (manualCVInspector{}).Inspect(tc.file, tc.data)
			if !errors.Is(err, tc.want) || (err == nil && mime != cvs.PDF) {
				t.Fatal(mime, err)
			}
		})
	}
	local, err := cvstorage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer local.Close()
	storage := manualCVStorage{local: local}
	key, err := storage.Put([]byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	file, err := local.Open(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(file)
	_ = file.Close()
	if err != nil || string(got) != "%PDF-1" {
		t.Fatal(string(got), err)
	}
	if err := storage.Delete(key); err != nil {
		t.Fatal(err)
	}
	if _, err := (manualCVStorage{}).Put(nil); !errors.Is(err, app.ErrStorageUnavailable) {
		t.Fatal(err)
	}
}
