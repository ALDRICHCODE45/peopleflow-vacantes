//go:build integration

package v2

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sync"
	"testing"
	"time"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	cvapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/application/cvs"
	cvstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/postgres/cvs"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCVLibraryNewestFirstAndInUseAfterApply(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	var cvs []cvapp.CV
	for i := 0; i < 3; i++ {
		cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
		if err != nil {
			t.Fatal(err)
		}
		// Explicit fixture timestamps make ordering independent of clock resolution.
		at := time.Date(2026, 1, i+1, 0, 0, 0, 0, time.UTC)
		if _, err = f.pool.Exec(ctx, `UPDATE candidate_cv_versions SET uploaded_at=$2 WHERE id=(SELECT version_id FROM candidate_cv_library WHERE id=$1)`, cv.ID, at); err != nil {
			t.Fatal(err)
		}
		cvs = append(cvs, cv)
	}
	assertList := func(used bool) {
		t.Helper()
		items, err := f.library.List(ctx, f.sub)
		if err != nil || len(items) != 3 {
			t.Fatal("list", err)
		}
		for i, item := range items {
			if item.ID != cvs[2-i].ID || item.InUse != (used && item.ID == cvs[1].ID) {
				t.Fatal("wrong newest-first order or in_use", items)
			}
		}
	}
	assertList(false)
	if _, err := f.store.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cvs[1].ID)); err != nil {
		t.Fatal(err)
	}
	assertList(true)
}

func TestParticipationCanonicalAnswerOrderReplays(t *testing.T) {
	f := setup(t)
	ctx := context.Background()
	draft, err := draftinput.DecodeCreateV2([]byte(`{"fields":{"title":"Engineer","screening_questions":[{"id":"11111111-1111-4111-8111-111111111111","type":"open","prompt":"Why?"},{"id":"22222222-2222-4222-8222-222222222222","type":"open","prompt":"When?"}]}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, f.vacancy, draft.Fingerprint()); err != nil {
		t.Fatal(err)
	}
	f.form, err = publicjobs.BuildScreening(draft.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
	if err != nil {
		t.Fatal(err)
	}
	req := f.request(cv.ID)
	req.Answers = append(req.Answers, app.Answer{QuestionID: f.form.Questions[1].ID, Text: "Tomorrow", HasText: true})
	key := uuid.New()
	created, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
	if err != nil || created.Replayed {
		t.Fatal("create", err)
	}
	req.Answers[0], req.Answers[1] = req.Answers[1], req.Answers[0]
	replay, err := f.store.Apply(ctx, f.sub, f.vacancy, key, req)
	if err != nil || !replay.Replayed || !bytes.Equal(created.Body, replay.Body) {
		t.Fatal("answer order must replay, not conflict", err)
	}
	f.assertSingleEffects(t)
}

// Each operation gets an identifiable backend so lock waits, not scheduler timing,
// establish the interleaving. No production hooks or sleeps decide the winner.
func operationPool(t *testing.T, ctx context.Context, base *pgxpool.Pool) (*pgxpool.Pool, int) {
	t.Helper()
	cfg := base.Config()
	cfg.MaxConns = 1
	cfg.MinConns = 0
	cfg.ConnConfig.RuntimeParams["application_name"] = "p2b-lock-test-" + uuid.NewString()
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("operation pool failed")
	}
	t.Cleanup(p.Close)
	var pid int
	if err = p.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatal("backend probe failed")
	}
	return p, pid
}
func waitBlockedBy(t *testing.T, ctx context.Context, pool *pgxpool.Pool, waiter, blocker int) {
	t.Helper()
	tick := time.NewTicker(5 * time.Millisecond)
	defer tick.Stop()
	for {
		var blocked bool
		if err := pool.QueryRow(ctx, `SELECT $2::int=ANY(pg_blocking_pids($1))`, waiter, blocker).Scan(&blocked); err != nil {
			t.Fatal("lock probe failed")
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("expected database lock interleaving not observed")
		case <-tick.C:
		}
	}
}

func TestCVRemovalVersusApplyCandidateLock(t *testing.T) {
	for _, first := range []string{"apply", "remove"} {
		t.Run(first+"_wins", func(t *testing.T) {
			f := setup(t)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			cv, err := f.library.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
			if err != nil {
				t.Fatal(err)
			}
			var key string
			if err = f.pool.QueryRow(ctx, `SELECT storage_key FROM candidate_cv_versions v JOIN candidate_cv_library l ON l.version_id=v.id WHERE l.id=$1`, cv.ID).Scan(&key); err != nil {
				t.Fatal(err)
			}
			applyPool, applyPID := operationPool(t, ctx, f.pool)
			removePool, removePID := operationPool(t, ctx, f.pool)
			store := NewStore(applyPool, audit.NewAuditEventRepository(), testVacancyRules{})
			library := cvstore.NewLibrary(removePool, f.storage)
			blocker, err := f.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer blocker.Rollback(context.Background())
			var blockerPID int
			if err = blocker.QueryRow(ctx, `SELECT pg_backend_pid() FROM users WHERE id=$1 FOR UPDATE`, f.actor).Scan(&blockerPID); err != nil {
				t.Fatal(err)
			}
			applied := make(chan error, 1)
			removed := make(chan error, 1)
			startApply := func() {
				go func() { _, err := store.Apply(ctx, f.sub, f.vacancy, uuid.New(), f.request(cv.ID)); applied <- err }()
			}
			startRemove := func() { go func() { removed <- library.Remove(ctx, f.sub, cv.ID) }() }
			if first == "apply" {
				startApply()
				waitBlockedBy(t, ctx, f.pool, applyPID, blockerPID)
				startRemove()
				waitBlockedBy(t, ctx, f.pool, removePID, applyPID)
			} else {
				startRemove()
				waitBlockedBy(t, ctx, f.pool, removePID, blockerPID)
				startApply()
				waitBlockedBy(t, ctx, f.pool, applyPID, removePID)
			}
			if err = blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			applyErr, removeErr := <-applied, <-removed
			if removeErr != nil {
				t.Fatal("removal", removeErr)
			}
			var count int
			var removedAt bool
			if err = f.pool.QueryRow(ctx, `SELECT count(*) FROM process_participations WHERE process_id=$1`, f.vacancy).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if err = f.pool.QueryRow(ctx, `SELECT removed_at IS NOT NULL FROM candidate_cv_library WHERE id=$1`, cv.ID).Scan(&removedAt); err != nil || !removedAt {
				t.Fatal("library removal not committed", err)
			}
			file, fileErr := f.storage.Open(ctx, key)
			if first == "apply" {
				if applyErr != nil || count != 1 || fileErr != nil {
					t.Fatal("apply must retain its committed version", applyErr, count, fileErr)
				}
				data, err := io.ReadAll(file)
				file.Close()
				if err != nil || string(data) != "%PDF-1" {
					t.Fatal("retained content", err)
				}
				f.assertSingleEffects(t)
			} else {
				if file != nil {
					file.Close()
				}
				if !errors.Is(applyErr, app.ErrCVUnavailable) || count != 0 || fileErr == nil {
					t.Fatal("removal must win with cv_unavailable and no participation", applyErr, count, fileErr)
				}
			}
		})
	}
}

// A storage barrier pauses inside the advisory lock, after file creation (upload)
// or directory enumeration (reconciliation). Cancellation always releases workers.
type barrierStorage struct {
	cvapp.Storage
	put, keys bool
	entered   chan struct{}
	release   chan struct{}
	once      sync.Once
}

func (s *barrierStorage) pause(ctx context.Context) error {
	s.once.Do(func() { close(s.entered) })
	select {
	case <-s.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *barrierStorage) Put(ctx context.Context, b []byte) (string, error) {
	key, err := s.Storage.Put(ctx, b)
	if err == nil && s.put {
		err = s.pause(ctx)
	}
	return key, err
}
func (s *barrierStorage) Keys(ctx context.Context) ([]string, error) {
	keys, err := s.Storage.Keys(ctx)
	if err == nil && s.keys {
		err = s.pause(ctx)
	}
	return keys, err
}
func TestCVReconcilerVersusUploadAdvisoryLock(t *testing.T) {
	for _, first := range []string{"upload", "reconcile"} {
		t.Run(first+"_first", func(t *testing.T) {
			f := setup(t)
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			uploadPool, uploadPID := operationPool(t, ctx, f.pool)
			reconcilePool, reconcilePID := operationPool(t, ctx, f.pool)
			barrier := &barrierStorage{Storage: f.storage, put: first == "upload", keys: first == "reconcile", entered: make(chan struct{}), release: make(chan struct{})}
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(barrier.release) }) }
			defer release()
			uploader := cvstore.NewLibrary(uploadPool, barrier)
			reconciler := cvstore.NewLibrary(reconcilePool, barrier)
			type uploadResult struct {
				cv  cvapp.CV
				err error
			}
			uploaded := make(chan uploadResult, 1)
			reconciled := make(chan error, 1)
			startUpload := func() {
				go func() {
					cv, err := uploader.Upload(ctx, f.sub, "CV", "cv.pdf", []byte("%PDF-1"))
					uploaded <- uploadResult{cv, err}
				}()
			}
			startReconcile := func() { go func() { reconciled <- reconciler.Reconcile(ctx) }() }
			if first == "upload" {
				startUpload()
			} else {
				startReconcile()
			}
			select {
			case <-barrier.entered:
			case <-ctx.Done():
				t.Fatal("storage barrier not reached")
			}
			if first == "upload" {
				startReconcile()
				waitBlockedBy(t, ctx, f.pool, reconcilePID, uploadPID)
			} else {
				startUpload()
				waitBlockedBy(t, ctx, f.pool, uploadPID, reconcilePID)
			}
			release()
			result := <-uploaded
			if result.err != nil {
				t.Fatal("upload", result.err)
			}
			if err := <-reconciled; err != nil {
				t.Fatal("reconcile", err)
			}
			cv, file, err := f.library.File(ctx, f.sub, result.cv.ID)
			if err != nil {
				t.Fatal("reconciler deleted committed upload", err)
			}
			data, err := io.ReadAll(file)
			file.Close()
			if err != nil || string(data) != "%PDF-1" || cv.ID != result.cv.ID {
				t.Fatal("committed content unavailable", err)
			}
			keys, err := f.storage.Keys(ctx)
			if err != nil || len(keys) != 1 {
				t.Fatal("committed upload not retained", err)
			}
		})
	}
}
