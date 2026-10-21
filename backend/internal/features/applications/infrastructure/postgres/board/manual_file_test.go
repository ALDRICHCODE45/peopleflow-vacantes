package board

import (
	"errors"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"testing"
)

type manualFakeStorage struct {
	puts, deletes     int
	putErr, deleteErr error
}

func (s *manualFakeStorage) Put([]byte) (string, error) { s.puts++; return "private-key", s.putErr }
func (s *manualFakeStorage) Delete(string) error        { s.deletes++; return s.deleteErr }

func TestManualFileCompensation(t *testing.T) {
	failure := errors.New("failure")
	for _, tc := range []struct {
		name                     string
		put, write, commit       error
		deletes, writes, commits int
	}{
		{name: "success", writes: 1, commits: 1},
		{name: "put failure", put: failure},
		{name: "definite pre-commit failure", write: failure, deletes: 1, writes: 1},
		{name: "uncertain commit retains file", commit: failure, writes: 1, commits: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			storage := &manualFakeStorage{putErr: tc.put}
			writes, commits := 0, 0
			_, err := storeManualFile(storage, []byte("cv"), func(key string) (app.ManualCreated, error) {
				writes++
				if key != "private-key" {
					t.Fatal(key)
				}
				return app.ManualCreated{}, tc.write
			}, func() error { commits++; return tc.commit })
			if (err != nil) != (tc.put != nil || tc.write != nil || tc.commit != nil) || storage.deletes != tc.deletes || writes != tc.writes || commits != tc.commits {
				t.Fatalf("err=%v deletes=%d writes=%d commits=%d", err, storage.deletes, writes, commits)
			}
		})
	}
}
