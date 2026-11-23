package documents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
)

// memStorage is an in-memory Storage that records every call, so the tests can say which objects survive.
type memStorage struct {
	mu       sync.Mutex
	objects  map[string][]byte
	puts     int
	deletes  []string
	delCtxOK []bool
	putErr   error
	n        int
}

func newMemStorage() *memStorage { return &memStorage{objects: map[string][]byte{}} }

func (m *memStorage) Put(ctx context.Context, r io.Reader, maxBytes int64) (string, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.puts++
	if m.putErr != nil {
		return "", 0, m.putErr
	}
	bounded := NewBoundedReader(ctx, r, maxBytes)
	data, err := io.ReadAll(bounded)
	if err != nil {
		return "", 0, err
	}
	m.n++
	key := strings.Repeat("a", 63) + string(rune('0'+m.n%10))
	m.objects[key] = data
	return key, int64(len(data)), nil
}

func (m *memStorage) Open(_ context.Context, key string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.objects[key]
	if !ok {
		return nil, ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (m *memStorage) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.deletes = append(m.deletes, key)
	m.delCtxOK = append(m.delCtxOK, ctx.Err() == nil)
	delete(m.objects, key)
	return nil
}

func (m *memStorage) Objects(context.Context) ([]Object, error) { return nil, nil }

type fakeWriter struct {
	authErr error
	result  UploadResult
	err     error
	cmd     UploadCommand
	calls   []string

	// replace, delete and download by version (P5)
	current       int
	replaceResp   UploadResponse
	replaceCmd    ReplaceCommand
	deleteResult  DeleteResult
	deleteErr     error
	downloadedVer int
}

func (f *fakeWriter) AuthorizeReplace(context.Context, uuid.UUID, uuid.UUID, Target, uuid.UUID) (int, error) {
	f.calls = append(f.calls, "authorize-replace")
	return f.current, f.authErr
}

func (f *fakeWriter) Replace(_ context.Context, cmd ReplaceCommand) (UploadResponse, error) {
	f.calls = append(f.calls, "replace")
	f.replaceCmd = cmd
	return f.replaceResp, f.err
}

func (f *fakeWriter) Delete(context.Context, uuid.UUID, uuid.UUID, Target, uuid.UUID) (DeleteResult, error) {
	f.calls = append(f.calls, "delete")
	return f.deleteResult, f.deleteErr
}

func (f *fakeWriter) DownloadVersion(_ context.Context, _, _ uuid.UUID, _ Target, _ uuid.UUID, version int) (File, error) {
	f.calls = append(f.calls, "download-version")
	f.downloadedVer = version
	return File{}, f.err
}

func (f *fakeWriter) AuthorizeUpload(context.Context, uuid.UUID, uuid.UUID, Target) error {
	f.calls = append(f.calls, "authorize")
	return f.authErr
}

func (f *fakeWriter) Upload(_ context.Context, cmd UploadCommand) (UploadResult, error) {
	f.calls = append(f.calls, "upload")
	f.cmd = cmd
	return f.result, f.err
}

func (f *fakeWriter) Download(context.Context, uuid.UUID, uuid.UUID, Target, uuid.UUID) (File, error) {
	f.calls = append(f.calls, "download")
	return File{}, f.err
}

func pdfBytes(n int) []byte {
	return append([]byte("%PDF-1.7\n"), bytes.Repeat([]byte{'x'}, n)...)
}

func TestStageStoresInspectsAndHashesWithoutBufferingInTheService(t *testing.T) {
	storage := newMemStorage()
	svc := NewService(storage, &fakeWriter{})
	data := pdfBytes(3 << 20)
	staged, err := svc.Stage(context.Background(), "contrato.PDF", bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(data)
	if staged.Format != PDF || staged.Size != int64(len(data)) || staged.SHA256 != hex.EncodeToString(sum[:]) {
		t.Fatalf("staged %+v", staged)
	}
	if _, ok := storage.objects[staged.Key]; !ok || len(storage.deletes) != 0 {
		t.Fatalf("the object must be stored and kept: %v %v", storage.objects, storage.deletes)
	}
}

// Every Inspect failure deletes the object it just stored and surfaces the sentinel unchanged.
func TestStageFailuresDeleteTheObject(t *testing.T) {
	jpg := append([]byte{0xff, 0xd8, 0xff, 0xe0}, bytes.Repeat([]byte{1}, 64)...)
	for _, tc := range []struct {
		name, file string
		data       []byte
		check      func(error) bool
	}{
		{"empty", "a.pdf", nil, func(e error) bool { return errors.Is(e, ErrEmpty) }},
		{"unsupported extension", "a.doc", pdfBytes(10), func(e error) bool { return errors.Is(e, ErrUnsupportedType) }},
		{"no extension", "contrato", pdfBytes(10), func(e error) bool { return errors.Is(e, ErrUnsupportedType) }},
		{"extension and bytes disagree", "a.png", jpg, func(e error) bool {
			var m *MismatchError
			return errors.As(e, &m) && m.Detected == JPG && m.Extension == ".png"
		}},
		{"bytes of nothing accepted", "a.pdf", []byte("hello world"), func(e error) bool {
			var m *MismatchError
			return errors.As(e, &m) && m.Detected == "" && m.Extension == ".pdf"
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			storage := newMemStorage()
			_, err := NewService(storage, &fakeWriter{}).Stage(context.Background(), tc.file, bytes.NewReader(tc.data))
			if !tc.check(err) {
				t.Fatalf("err = %v", err)
			}
			if len(storage.objects) != 0 || len(storage.deletes) != 1 {
				t.Fatalf("object left behind: %v deletes=%v", storage.objects, storage.deletes)
			}
		})
	}
}

func TestStageTooLargeAndStorageFailures(t *testing.T) {
	storage := newMemStorage()
	_, err := NewService(storage, &fakeWriter{}).Stage(context.Background(), "a.pdf", bytes.NewReader(pdfBytes(MaxBytes)))
	if !errors.Is(err, ErrTooLarge) || len(storage.objects) != 0 {
		t.Fatalf("over the limit: %v %v", err, storage.objects)
	}
	// Exactly MaxBytes is accepted.
	exact := pdfBytes(MaxBytes - 9)
	if len(exact) != MaxBytes {
		t.Fatalf("fixture is %d bytes", len(exact))
	}
	if staged, err := NewService(newMemStorage(), &fakeWriter{}).Stage(context.Background(), "a.pdf", bytes.NewReader(exact)); err != nil || staged.Size != MaxBytes {
		t.Fatalf("at the limit: %+v %v", staged, err)
	}
	// A failing body (the request cap, a client abort) is the reader's own error, and no object remains.
	boom := errors.New("client went away")
	storage = newMemStorage()
	_, err = NewService(storage, &fakeWriter{}).Stage(context.Background(), "a.pdf", io.MultiReader(bytes.NewReader(pdfBytes(10)), errReader{boom}))
	if !errors.Is(err, boom) || len(storage.objects) != 0 {
		t.Fatalf("failing body: %v %v", err, storage.objects)
	}
	// Storage failure and disabled storage.
	storage = newMemStorage()
	storage.putErr = ErrStorageUnavailable
	if _, err := NewService(storage, &fakeWriter{}).Stage(context.Background(), "a.pdf", bytes.NewReader(pdfBytes(10))); !errors.Is(err, ErrStorageUnavailable) {
		t.Fatalf("storage failure: %v", err)
	}
	if _, err := NewService(nil, &fakeWriter{}).Stage(context.Background(), "a.pdf", bytes.NewReader(pdfBytes(10))); !errors.Is(err, ErrStorageUnavailable) {
		t.Fatalf("disabled storage: %v", err)
	}
}

type errReader struct{ err error }

func (e errReader) Read([]byte) (int, error) { return 0, e.err }

func staged(storage *memStorage) Staged {
	key, _, _ := storage.Put(context.Background(), bytes.NewReader(pdfBytes(5)), MaxBytes)
	return Staged{Key: key, Size: 14, Format: PDF, SHA256: strings.Repeat("0", 64)}
}

// The file stays only on a fresh success; replay, conflict, limit and any failure remove it, even after the request
// context is gone (WithoutCancel).
func TestUploadKeepsTheObjectOnlyOnAFreshSuccess(t *testing.T) {
	cmd := func(s Staged) UploadCommand {
		return UploadCommand{CompanyID: uuid.New(), ActorID: uuid.New(), Target: VacancyTarget(uuid.New()), Name: "n", Staged: s}
	}
	for _, tc := range []struct {
		name     string
		writer   *fakeWriter
		wantKept bool
		wantErr  error
	}{
		{"created", &fakeWriter{result: UploadResult{Body: []byte(`{}`)}}, true, nil},
		{"replayed", &fakeWriter{result: UploadResult{Body: []byte(`{}`), Replayed: true}}, false, nil},
		{"idempotency conflict", &fakeWriter{err: ErrIdempotencyConflict}, false, ErrIdempotencyConflict},
		{"limit reached", &fakeWriter{err: &LimitReachedError{Kind: "documents", Limit: 50}}, false, nil},
		{"authorization revoked", &fakeWriter{err: ErrTeamAccessEnded}, false, ErrTeamAccessEnded},
		{"row failure", &fakeWriter{err: errors.New("insert failed")}, false, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			storage := newMemStorage()
			s := staged(storage)
			ctx, cancel := context.WithCancel(context.Background())
			cancel() // the client is gone: the cleanup must still run
			res, err := NewService(storage, tc.writer).Upload(ctx, cmd(s))
			if (err != nil) != (tc.name != "created" && tc.name != "replayed") {
				t.Fatalf("err = %v", err)
			}
			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("err = %v, want %v", err, tc.wantErr)
			}
			_, kept := storage.objects[s.Key]
			if kept != tc.wantKept {
				t.Fatalf("object kept = %v, want %v", kept, tc.wantKept)
			}
			if !tc.wantKept && (len(storage.deletes) != 1 || !storage.delCtxOK[0]) {
				t.Fatalf("deletes %v with a live context %v", storage.deletes, storage.delCtxOK)
			}
			if err == nil && tc.name == "replayed" && !res.Replayed {
				t.Fatal("replay flag lost")
			}
		})
	}
}

func TestPreflightAuthorizesBeforeLookingAtTheStorage(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), VacancyTarget(uuid.New())
	// Denied caller with storage disabled: the usual gate answers first, never 503.
	if err := NewService(nil, &fakeWriter{authErr: ErrForbidden}).PreflightUpload(context.Background(), a, b, c); !errors.Is(err, ErrForbidden) {
		t.Fatalf("denied: %v", err)
	}
	if err := NewService(nil, &fakeWriter{}).PreflightUpload(context.Background(), a, b, c); !errors.Is(err, ErrStorageUnavailable) {
		t.Fatalf("authorized, storage disabled: %v", err)
	}
	if err := NewService(newMemStorage(), &fakeWriter{}).PreflightUpload(context.Background(), a, b, c); err != nil {
		t.Fatalf("authorized: %v", err)
	}
}

func TestUploadFingerprintIsTheCanonicalRequest(t *testing.T) {
	draft, part := uuid.New(), uuid.New()
	sum := strings.Repeat("ab", 32)
	base := UploadFingerprint(ScopeVacancy, draft, nil, "Contrato", sum)
	if !bytes.Equal(base, UploadFingerprint(ScopeVacancy, draft, nil, "Contrato", sum)) {
		t.Fatal("the fingerprint must be deterministic")
	}
	for name, other := range map[string][]byte{
		"another vacancy":      UploadFingerprint(ScopeVacancy, uuid.New(), nil, "Contrato", sum),
		"another name":         UploadFingerprint(ScopeVacancy, draft, nil, "Oferta", sum),
		"another file":         UploadFingerprint(ScopeVacancy, draft, nil, "Contrato", strings.Repeat("cd", 32)),
		"participation scope":  UploadFingerprint(ScopeParticipation, draft, &part, "Contrato", sum),
		"another participant":  UploadFingerprint(ScopeParticipation, draft, &draft, "Contrato", sum),
		"name boundary shifts": UploadFingerprint(ScopeVacancy, draft, nil, "Contrat", "o"+sum[1:]),
	} {
		if bytes.Equal(base, other) {
			t.Errorf("%s collides with the base fingerprint", name)
		}
	}
	if len(base) == 0 || bytes.Contains(base, []byte(sum+sum)) {
		t.Fatal("unexpected fingerprint shape")
	}
}

func TestDownloadAndLimitErrorsHaveStableShape(t *testing.T) {
	w := &fakeWriter{err: ErrNotFound}
	if _, err := NewService(newMemStorage(), w).Download(context.Background(), uuid.New(), uuid.New(), VacancyTarget(uuid.New()), uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("download error must pass through: %v", err)
	}
	var e error = &LimitReachedError{Kind: "documents", Limit: 50}
	var le *LimitReachedError
	if !errors.As(e, &le) || le.Limit != 50 || e.Error() == "" {
		t.Fatal("LimitReachedError")
	}
}
