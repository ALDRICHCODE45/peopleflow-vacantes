package documents

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// The write side of P5 (replace, delete, download by version): the service keeps a replacement's object only on a fresh
// success, authorizes before it looks at storage, and deletes the files of a document only AFTER its rows are gone.

func replaceCmd(s Staged) ReplaceCommand {
	return ReplaceCommand{CompanyID: uuid.New(), ActorID: uuid.New(), DraftID: uuid.New(), DocID: uuid.New(), ExpectedVersion: 1, Staged: s}
}

func TestReplaceKeepsTheObjectOnlyOnSuccess(t *testing.T) {
	for _, tc := range []struct {
		name     string
		err      error
		wantKept bool
	}{
		{"replaced", nil, true},
		{"stale expected_version", &VersionConflictError{Current: 3}, false},
		{"version limit", &LimitReachedError{Kind: "versions", Limit: MaxVersions}, false},
		{"authorization revoked", ErrTeamAccessEnded, false},
		{"document gone", ErrScopeNotFound, false},
		{"row failure", errors.New("insert failed"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			storage := newMemStorage()
			s := staged(storage)
			ctx, cancel := context.WithCancel(context.Background())
			cancel() // the client is gone: the cleanup must still run
			writer := &fakeWriter{err: tc.err, replaceResp: UploadResponse{Item: Item{ID: "d1", Version: 2}}}
			cmd := replaceCmd(s)
			res, err := NewService(storage, writer).Replace(ctx, cmd)
			if !errors.Is(err, tc.err) { // the very same error value comes back, nil included
				t.Fatalf("err = %v, want %v", err, tc.err)
			}
			if _, kept := storage.objects[s.Key]; kept != tc.wantKept {
				t.Fatalf("object kept = %v, want %v", kept, tc.wantKept)
			}
			if !tc.wantKept && (len(storage.deletes) != 1 || !storage.delCtxOK[0]) {
				t.Fatalf("deletes %v with a live context %v", storage.deletes, storage.delCtxOK)
			}
			if tc.err == nil && res.Item.ID != "d1" {
				t.Fatalf("result lost: %+v", res)
			}
			if writer.replaceCmd.DocID != cmd.DocID || writer.replaceCmd.ExpectedVersion != 1 || writer.replaceCmd.Staged.Key != s.Key {
				t.Fatalf("writer got %+v", writer.replaceCmd)
			}
		})
	}
}

func TestPreflightReplaceAuthorizesBeforeLookingAtTheStorage(t *testing.T) {
	c, a, d, doc := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := NewService(nil, &fakeWriter{authErr: ErrForbidden}).PreflightReplace(context.Background(), c, a, d, doc); !errors.Is(err, ErrForbidden) {
		t.Fatalf("denied: %v", err)
	}
	if _, err := NewService(nil, &fakeWriter{authErr: ErrScopeNotFound}).PreflightReplace(context.Background(), c, a, d, doc); !errors.Is(err, ErrScopeNotFound) {
		t.Fatalf("unknown document with storage disabled: %v", err)
	}
	if _, err := NewService(nil, &fakeWriter{current: 2}).PreflightReplace(context.Background(), c, a, d, doc); !errors.Is(err, ErrStorageUnavailable) {
		t.Fatalf("authorized, storage disabled: %v", err)
	}
	current, err := NewService(newMemStorage(), &fakeWriter{current: 4}).PreflightReplace(context.Background(), c, a, d, doc)
	if err != nil || current != 4 {
		t.Fatalf("authorized: current %d err %v", current, err)
	}
}

func TestDeleteRemovesTheFilesOnlyAfterTheRowsAreGone(t *testing.T) {
	storage := newMemStorage()
	first, second := staged(storage), staged(storage)
	scope := BuildScope(ScopeInput{Kind: ScopeVacancy, CanManage: true, Documents: 2})
	writer := &fakeWriter{deleteResult: DeleteResult{Scope: scope, Keys: []string{first.Key, second.Key}}}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // the client left after the commit: the files must still go
	res, err := NewService(storage, writer).Delete(ctx, uuid.New(), uuid.New(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(res, ScopeResponse{Scope: scope}) {
		t.Fatalf("response %+v", res)
	}
	if len(storage.objects) != 0 || len(storage.deletes) != 2 || !storage.delCtxOK[0] || !storage.delCtxOK[1] {
		t.Fatalf("objects %v deletes %v live ctx %v", storage.objects, storage.deletes, storage.delCtxOK)
	}
}

// A failure of the rows (or an unknown document) leaves every file alone: nothing was committed.
func TestDeleteLeavesTheFilesWhenTheRowsStay(t *testing.T) {
	for _, err := range []error{ErrScopeNotFound, ErrForbidden, errors.New("delete failed")} {
		storage := newMemStorage()
		s := staged(storage)
		writer := &fakeWriter{deleteErr: err, deleteResult: DeleteResult{Keys: []string{s.Key}}}
		if _, got := NewService(storage, writer).Delete(context.Background(), uuid.New(), uuid.New(), uuid.New(), uuid.New()); !errors.Is(got, err) {
			t.Fatalf("err = %v", got)
		}
		if _, ok := storage.objects[s.Key]; !ok || len(storage.deletes) != 0 {
			t.Fatalf("%v: the file was touched: %v", err, storage.deletes)
		}
	}
}

// A storage failure after the commit is not the caller's problem: the answer is still the scope, the orphan is Reconcile's.
type failingDeleteStorage struct {
	*memStorage
	failFor map[string]bool
}

func (s failingDeleteStorage) Delete(ctx context.Context, key string) error {
	_ = s.memStorage.Delete(ctx, key)
	if s.failFor[key] {
		return ErrStorageUnavailable
	}
	return nil
}

func TestDeleteSwallowsStorageFailuresAfterTheCommit(t *testing.T) {
	mem := newMemStorage()
	first, second := staged(mem), staged(mem)
	storage := failingDeleteStorage{memStorage: mem, failFor: map[string]bool{first.Key: true}}
	scope := BuildScope(ScopeInput{Kind: ScopeVacancy, CanManage: true})
	writer := &fakeWriter{deleteResult: DeleteResult{Scope: scope, Keys: []string{first.Key, second.Key}}}
	res, err := NewService(storage, writer).Delete(context.Background(), uuid.New(), uuid.New(), uuid.New(), uuid.New())
	if err != nil || !reflect.DeepEqual(res.Scope, scope) {
		t.Fatalf("res %+v err %v", res, err)
	}
	// Every key is attempted even after one failed: the second file is gone.
	if len(mem.deletes) != 2 {
		t.Fatalf("attempted deletes %v", mem.deletes)
	}
}

// Storage disabled: the rows still go (a delete must always be possible, S6); there is no file to remove.
func TestDeleteWithStorageDisabledStillDeletesTheRows(t *testing.T) {
	scope := BuildScope(ScopeInput{Kind: ScopeVacancy, CanManage: true})
	writer := &fakeWriter{deleteResult: DeleteResult{Scope: scope, Keys: []string{"k"}}}
	res, err := NewService(nil, writer).Delete(context.Background(), uuid.New(), uuid.New(), uuid.New(), uuid.New())
	if err != nil || !reflect.DeepEqual(res.Scope, scope) || len(writer.calls) != 1 {
		t.Fatalf("res %+v err %v calls %v", res, err, writer.calls)
	}
}

func TestDownloadVersionDelegatesTheNumber(t *testing.T) {
	w := &fakeWriter{err: ErrNotFound}
	if _, err := NewService(newMemStorage(), w).DownloadVersion(context.Background(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), 7); !errors.Is(err, ErrNotFound) || w.downloadedVer != 7 {
		t.Fatalf("err %v version %d", err, w.downloadedVer)
	}
}

// The wire shape of the version list (contract «GET P/documents/{doc}/versions»).
func TestVersionListJSONShape(t *testing.T) {
	list := VersionList{
		DocumentID: "d1", Name: "Contrato marco",
		Versions: []VersionItem{{Version: 2, Format: PDF, ContentType: "application/pdf", Size: 183204, UploadedAt: "2026-11-22T09:40:03.100200Z", UploadedBy: Person{ID: "u2", Name: "Luis Ortega"}, IsCurrent: true}},
	}
	raw, err := json.Marshal(list)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"document_id":"d1","name":"Contrato marco","versions":[{"version":2,"format":"pdf","content_type":"application/pdf","size":183204,"uploaded_at":"2026-11-22T09:40:03.100200Z","uploaded_by":{"id":"u2","name":"Luis Ortega"},"is_current":true}]}`
	if string(raw) != want {
		t.Fatalf("got  %s\nwant %s", raw, want)
	}
}

func TestVersionConflictErrorCarriesTheCurrentVersion(t *testing.T) {
	var err error = &VersionConflictError{Current: 4}
	var conflict *VersionConflictError
	if !errors.As(err, &conflict) || conflict.Current != 4 || err.Error() == "" {
		t.Fatal("VersionConflictError")
	}
}

// The delete answer is {"scope": …} and nothing else (contract «DELETE P/documents/{doc}»).
func TestScopeResponseJSONShape(t *testing.T) {
	raw, err := json.Marshal(ScopeResponse{Scope: BuildScope(ScopeInput{Kind: ScopeVacancy, CanManage: true})})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || len(m) != 1 || m["scope"] == nil {
		t.Fatalf("%s %v", raw, err)
	}
}

// The rule shared by the pre-flight and the write under the lock: stale first, then the cap.
func TestCheckReplaceable(t *testing.T) {
	var conflict *VersionConflictError
	var limit *LimitReachedError
	for _, tc := range []struct {
		name              string
		current, expected int
		conflict, limit   bool
	}{
		{"fresh", 1, 1, false, false},
		{"one below the cap", MaxVersions - 1, MaxVersions - 1, false, false},
		{"behind", 3, 2, true, false},
		{"ahead", 3, 4, true, false},
		{"at the cap", MaxVersions, MaxVersions, false, true},
		{"stale at the cap is a conflict, not a limit", MaxVersions, MaxVersions - 1, true, false},
	} {
		err := CheckReplaceable(tc.current, tc.expected)
		gotConflict, gotLimit := errors.As(err, &conflict), errors.As(err, &limit)
		if gotConflict != tc.conflict || gotLimit != tc.limit || (!tc.conflict && !tc.limit && err != nil) {
			t.Errorf("%s: err = %v", tc.name, err)
		}
		if tc.conflict && conflict.Current != tc.current {
			t.Errorf("%s: current = %d", tc.name, conflict.Current)
		}
		if tc.limit && (limit.Kind != "versions" || limit.Limit != MaxVersions) {
			t.Errorf("%s: limit = %+v", tc.name, limit)
		}
	}
}
