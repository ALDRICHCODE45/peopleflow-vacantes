//go:build integration

// WS2D live-DB evidence (task 2.4):
//   - B1 (`TestUpdateCompany_AllFields_PersistsEveryMutableField`): one real
//     `repo.UpdateCompany` call persists every supplied mutable field and
//     appends audit delta +1.
//   - B2 (`TestUpdateDeleteRace_ControlledOrder`): controlled-order PATCH/DELETE
//     live races on the same CAS token. Winner reaches audit append (blocks on
//     `raceAudit`); loser blocks on row lock; loser returns `entities.ErrCompanyNotFound`
//     at the adapter (use case maps to `entities.ErrConcurrencyConflict` per
//     `TestUpdateCompany_UpdateLostRaceAfterDeleteTombstoneReturnsConflict`). B2 uses
//     dedicated pools with distinct `application_name`s for `pg_blocking_pids`
//     attribution.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const ws2dbIndustryID = "companies-write-ws2db-industry"

// seedRaceCompany inserts a unique `companies` row tagged with the WS2DB
// industry and returns (id, updated_at, actorUUID). The `suffix` is
// appended to the company `name` so duplicate-key retries in B2 (and the
// all-fields assertion in B1) never collide on `name`. RFC is computed
// in Go (4-char prefix + first 8 hex digits of the UUID = 12 chars,
// uppercased) and passed as a separately typed `$3` so PostgreSQL never
// has to resolve `$1` as both UUID and text — that mixed usage is what
// triggered the live `SQLSTATE 42P08` ("inconsistent types deduced for
// parameter"). The industry upsert keeps B1 independent of migration
// ordering.
func seedRaceCompany(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) (uuid.UUID, time.Time, uuid.UUID) {
	t.Helper()
	id, actor := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO industries (id, label_es, label_en, sort_order, active)
		 VALUES ($1, 'WS2DB', 'WS2DB', 0, true)
		 ON CONFLICT (id) DO NOTHING`, ws2dbIndustryID); err != nil {
		t.Fatalf("seed industry: %v", err)
	}
	rfc := strings.ToUpper("WSDB" + id.String()[:8])
	if _, err := pool.Exec(ctx,
		`INSERT INTO companies (id, name, rfc, industry_id, status, updated_at)
		 VALUES ($1, $2, $3, $4, 'active', now())
		 ON CONFLICT (id) DO NOTHING`,
		id, "WS2DB "+suffix, rfc, ws2dbIndustryID); err != nil {
		t.Fatalf("seed company: %v", err)
	}
	var ts time.Time
	if err := pool.QueryRow(ctx, `SELECT updated_at FROM companies WHERE id = $1`, id).Scan(&ts); err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return id, ts, actor
}

// auditCount returns the number of `audit_events` rows attached to the
// seeded company. B1 calls it once before and once after the live
// `UpdateCompany` to assert the audit delta.
func auditCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, entityID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE entity_type = 'company' AND entity_id = $1`, entityID).Scan(&n); err != nil {
		t.Fatalf("audit count: %v", err)
	}
	return n
}

// cleanupRaceCompany removes the seeded company + its audit rows.
func cleanupRaceCompany(t *testing.T, pool *pgxpool.Pool, entityID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := pool.Exec(ctx, `DELETE FROM audit_events WHERE entity_id = $1`, entityID); err != nil {
		t.Fatalf("cleanup audit: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, entityID); err != nil {
		t.Fatalf("cleanup company: %v", err)
	}
}

// --- raceAudit decorator (B2 live cross-operation race evidence) --------------

// raceAudit wraps the audit Append to inject a deterministic hold AFTER
// the inner append completes (audit row in open tx) but BEFORE the
// caller's tx.Commit. `ready` closes after the inner append succeeds;
// `release` closes `hold` once to let the winner commit.
type raceAudit struct {
	inner auditrepositories.AuditEventRepository
	ready chan struct{}
	hold  chan struct{}
	once  sync.Once
}

func newRaceAudit(inner auditrepositories.AuditEventRepository) *raceAudit {
	return &raceAudit{inner: inner, ready: make(chan struct{}), hold: make(chan struct{})}
}

func (r *raceAudit) Append(ctx context.Context, tx pgx.Tx, event auditentities.AuditEvent) error {
	if err := r.inner.Append(ctx, tx, event); err != nil {
		return err
	}
	close(r.ready)
	select {
	case <-r.hold:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *raceAudit) release() { r.once.Do(func() { close(r.hold) }) }

// newPoolWithAppName builds a 1-conn pgxpool with a distinct
// `application_name` so its backend PID is identifiable via
// pg_stat_activity.
func newPoolWithAppName(t *testing.T, name string) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	cfg.MaxConns, cfg.MinConns = 1, 1
	if cfg.ConnConfig.RuntimeParams == nil {
		cfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	cfg.ConnConfig.RuntimeParams["application_name"] = name
	pctx, pcancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer pcancel()
	pool, err := pgxpool.NewWithConfig(pctx, cfg)
	if err != nil {
		t.Fatalf("create pool %s: %v", name, err)
	}
	return pool
}

// backendPID returns pg_backend_pid() of the (single) connection in the
// pool (assumes MaxConns=1).
func backendPID(t *testing.T, pool *pgxpool.Pool) int32 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var pid int32
	if err := pool.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid); err != nil {
		t.Fatalf("query backend pid: %v", err)
	}
	return pid
}

// waitForBlockingPIDs polls pg_stat_activity (no sleeps) until waitingPID
// shows wait_event_type='Lock' AND blockingPID ∈ pg_blocking_pids.
func waitForBlockingPIDs(ctx context.Context, pool *pgxpool.Pool, waitingPID, blockingPID int32) error {
	const query = `SELECT EXISTS (
		SELECT 1 FROM pg_stat_activity
		WHERE pid = $1 AND wait_event_type = 'Lock'
		  AND $2 = ANY(pg_blocking_pids($1)))`
	for ctx.Err() == nil {
		var blocked bool
		if err := pool.QueryRow(ctx, query, waitingPID, blockingPID).Scan(&blocked); err != nil {
			return fmt.Errorf("poll pg_stat_activity: %w", err)
		}
		if blocked {
			return nil
		}
	}
	return fmt.Errorf("wait for blocking pids: %w", ctx.Err())
}

// --- 2. Controlled-order PATCH/DELETE live cross-operation races --------------

// TestUpdateDeleteRace_ControlledOrder pins the WS2D-B2 race contract:
// one PATCH and one DELETE share the original CAS token; the winner
// reaches its real audit append inside its open tx and blocks on the
// raceAudit hold; the loser starts and is blocked by the row lock.
// Use-case `ErrCompanyNotFound` → `ErrConcurrencyConflict` is pinned at
// the unit layer (`TestUpdateCompany_UpdateLostRaceAfterDeleteTombstoneReturnsConflict`);
// this test pins the live repository behavior + audit invariants. The
// decorator is installed ONLY on the winner (loser's UPDATE returns 0
// rows before Append; loser audit path unreachable). Failure paths
// call `release()` so Wait cannot deadlock.
func TestUpdateDeleteRace_ControlledOrder(t *testing.T) {
	mainPool := skipIfNoDatabase(t)
	winnerPool := newPoolWithAppName(t, "ws2db-race-winner")
	loserPool := newPoolWithAppName(t, "ws2db-race-loser")
	t.Cleanup(func() { mainPool.Close(); winnerPool.Close(); loserPool.Close() })
	winnerPID := backendPID(t, winnerPool)
	loserPID := backendPID(t, loserPool)

	for _, tc := range []struct {
		name           string
		winnerIsDelete bool
	}{
		{"PATCHwins_DELETEloses", false},
		{"DELETEwins_PATCHloses", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runRaceSubtest(t, mainPool, winnerPool, loserPool, winnerPID, loserPID,
				tc.name, tc.winnerIsDelete, !tc.winnerIsDelete)
		})
	}
}

// runRaceSubtest executes one controlled-order race: start winner, wait
// for `ready` (winner past UPDATE, audit row in tx, row lock held); start
// loser; observe lock via pg_blocking_pids; release hold; join goroutines
// with bounded wait. Asserts winner nil, loser ErrCompanyNotFound, audit
// delta +1, winner event_type, loser event_type absent, row state matches
// winner.
func runRaceSubtest(
	t *testing.T,
	mainPool, winnerPool, loserPool *pgxpool.Pool,
	winnerPID, loserPID int32,
	name string,
	winnerIsDelete, loserIsDelete bool,
) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	id, preUpdatedAt, _ := seedRaceCompany(t, ctx, mainPool, name)
	t.Cleanup(func() { cleanupRaceCompany(t, mainPool, id) })

	preAudit := auditCount(t, ctx, mainPool, id)

	winnerHolder := newRaceAudit(auditpostgres.NewAuditEventRepository())
	winnerRepo := NewCompanyRepository(winnerPool, winnerHolder)
	loserRepo := NewCompanyRepository(loserPool, auditpostgres.NewAuditEventRepository())

	patch := repositories.UpdateCompanyPatch{
		Website: sharedvalueobjects.Optional[string]{Set: true, Valid: true, Value: "https://race-winner.example.com"},
	}
	mkEvent := func(delete bool) auditentities.AuditEvent {
		eventID := uuid.New()
		eventType, meta := auditentities.EventCompanyUpdated, map[string]string{}
		if delete {
			eventType, meta = auditentities.EventCompanyDeleted, nil
		}
		return auditentities.AuditEvent{
			ID: eventID, ActorType: auditentities.ActorTypeSystem, ActorID: nil,
			EventType: eventType, EntityType: auditentities.EntityCompany,
			EntityID: id, Metadata: meta,
		}
	}
	runOp := func(repo *CompanyRepository, delete bool, errCh chan error) {
		event := mkEvent(delete)
		if delete {
			errCh <- repo.SoftDeleteCompany(ctx, id, preUpdatedAt, event)
		} else {
			errCh <- repo.UpdateCompany(ctx, id, patch, preUpdatedAt, event)
		}
	}

	var (
		wg          sync.WaitGroup
		winnerErrCh = make(chan error, 1)
		loserErrCh  = make(chan error, 1)
	)
	wg.Add(1)
	go func() { defer wg.Done(); runOp(winnerRepo, winnerIsDelete, winnerErrCh) }()
	select {
	case <-winnerHolder.ready:
	case <-ctx.Done():
		winnerHolder.release()
		wg.Wait()
		t.Fatalf("winner ready: %v", ctx.Err())
	}
	wg.Add(1)
	go func() { defer wg.Done(); runOp(loserRepo, loserIsDelete, loserErrCh) }()
	defer wg.Wait()
	defer winnerHolder.release()

	obsCtx, obsCancel := context.WithTimeout(ctx, 10*time.Second)
	defer obsCancel()
	if err := waitForBlockingPIDs(obsCtx, mainPool, loserPID, winnerPID); err != nil {
		winnerHolder.release()
		wg.Wait()
		t.Fatalf("observe loser lock: %v", err)
	}
	winnerHolder.release()

	doneCh := make(chan struct{})
	go func() { wg.Wait(); close(doneCh) }()
	select {
	case <-doneCh:
	case <-ctx.Done():
		t.Fatalf("race join: %v", ctx.Err())
	}

	winnerErr := <-winnerErrCh
	loserErr := <-loserErrCh
	if winnerErr != nil {
		t.Errorf("winner: want nil, got %v", winnerErr)
	}
	if !errors.Is(loserErr, entities.ErrCompanyNotFound) {
		t.Errorf("loser: want entities.ErrCompanyNotFound (use case → ErrConcurrencyConflict), got %v", loserErr)
	}
	if postAudit := auditCount(t, ctx, mainPool, id); postAudit != preAudit+1 {
		t.Errorf("audit delta: want +1, got pre=%d post=%d", preAudit, postAudit)
	}

	wantWinnerType := auditentities.EventCompanyUpdated
	wantLoserType := auditentities.EventCompanyDeleted
	if winnerIsDelete {
		wantWinnerType, wantLoserType = auditentities.EventCompanyDeleted, auditentities.EventCompanyUpdated
	}
	var (
		eventType  string
		jobsClosed *string
		loserCount int
		deletedAt  *time.Time
		website    *string
		updatedAt  time.Time
	)
	if err := mainPool.QueryRow(ctx,
		`WITH w AS (
			SELECT event_type, metadata->>'jobs_closed' AS jobs_closed
			FROM audit_events
			WHERE entity_type = 'company' AND entity_id = $1
			ORDER BY occurred_at DESC LIMIT 1
		), l AS (
			SELECT count(*) AS n FROM audit_events
			WHERE entity_type = 'company' AND entity_id = $1 AND event_type = $2
		), c AS (
			SELECT deleted_at, website, updated_at FROM companies WHERE id = $1
		)
		SELECT w.event_type, w.jobs_closed, l.n, c.deleted_at, c.website, c.updated_at
		FROM w, l, c`,
		id, wantLoserType,
	).Scan(&eventType, &jobsClosed, &loserCount, &deletedAt, &website, &updatedAt); err != nil {
		t.Fatalf("post snapshots: %v", err)
	}
	if eventType != wantWinnerType {
		t.Errorf("audit event_type: want %q (winner), got %q", wantWinnerType, eventType)
	}
	if winnerIsDelete && (jobsClosed == nil || *jobsClosed != "0") {
		t.Errorf("CompanyDeleted jobs_closed: want \"0\", got %v", jobsClosed)
	}
	if loserCount != 0 {
		t.Errorf("loser audit rows: want 0 (loser tx rolled back), got %d", loserCount)
	}
	if winnerIsDelete {
		if deletedAt == nil {
			t.Errorf("DELETE winner: want deleted_at NOT NULL, got NULL")
		}
		return
	}
	if deletedAt != nil {
		t.Errorf("PATCH winner: want deleted_at NULL, got %v", *deletedAt)
	}
	if website == nil || *website != "https://race-winner.example.com" {
		t.Errorf("PATCH winner: want website %q, got %v", "https://race-winner.example.com", website)
	}
	if !updatedAt.After(preUpdatedAt) {
		t.Errorf("PATCH winner: want updated_at > %v, got %v", preUpdatedAt, updatedAt)
	}
}

// --- 1. Compact all-fields `UpdateCompany` integration ----------------------

// TestUpdateCompany_AllFields_PersistsEveryMutableField pins the
// multi-field update contract (W2/W3): one `repo.UpdateCompany`
// call with every supplied mutable field set persists every value
// and appends exactly one audit row.
func TestUpdateCompany_AllFields_PersistsEveryMutableField(t *testing.T) {
	pool := skipIfNoDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	id, preUpdatedAt, actor := seedRaceCompany(t, ctx, pool, "ALLFLD")
	// Pool close is registered BEFORE the row cleanup so LIFO cleanup
	// removes the seeded company + audit rows on an open pool, then
	// closes it. (Previously `defer pool.Close()` ran first and the
	// t.Cleanup handler ran against a closed pool, logging
	// `cleanup audit: closed pool` and leaving residue.)
	t.Cleanup(pool.Close)
	t.Cleanup(func() { cleanupRaceCompany(t, pool, id) })
	preAudit := auditCount(t, ctx, pool, id)

	str := func(v string) sharedvalueobjects.Optional[string] {
		return sharedvalueobjects.Optional[string]{Set: true, Valid: true, Value: v}
	}

	eventID := uuid.New()
	repo := NewCompanyRepository(pool, auditpostgres.NewAuditEventRepository())
	patch := repositories.UpdateCompanyPatch{
		Website: str("https://ws2db.example.com"), LogoURL: str("https://cdn.example.com/logo.png"),
		Description: str("ws2db b description payload"), Size: str("startup"),
		FoundedYear: sharedvalueobjects.Optional[int]{Set: true, Valid: true, Value: 2024},
		City:        str("CDMX"), Country: str("MX"),
		LinkedInURL:   str("https://linkedin.com/company/ws2db"),
		InstagramURL:  str("https://instagram.com/ws2db"),
		FacebookURL:   str("https://facebook.com/ws2db"),
		TwitterURL:    str("https://twitter.com/ws2db"),
		CoverImageURL: str("https://cdn.example.com/cover.jpg"),
	}
	if err := repo.UpdateCompany(ctx, id, patch, preUpdatedAt, auditentities.AuditEvent{
		ID: eventID, ActorType: auditentities.ActorTypeUser, ActorID: &actor,
		EventType: auditentities.EventCompanyUpdated, EntityType: auditentities.EntityCompany,
		EntityID: id, Metadata: map[string]string{},
	}); err != nil {
		t.Fatalf("UpdateCompany: %v", err)
	}

	var website, logo, desc, size, city, country, li, ig, fb, tw, cover *string
	var fy *int16
	var updatedAt time.Time
	if err := pool.QueryRow(ctx,
		`SELECT website, logo_url, description, size, founded_year, city, country,
		        linkedin_url, instagram_url, facebook_url, twitter_url, cover_image_url, updated_at
		 FROM companies WHERE id = $1`, id,
	).Scan(&website, &logo, &desc, &size, &fy, &city, &country, &li, &ig, &fb, &tw, &cover, &updatedAt); err != nil {
		t.Fatalf("post snapshot: %v", err)
	}
	type pair struct {
		label string
		got   *string
		want  string
	}
	checks := []pair{
		{"website", website, "https://ws2db.example.com"},
		{"logo_url", logo, "https://cdn.example.com/logo.png"},
		{"description", desc, "ws2db b description payload"},
		{"size", size, "startup"},
		{"city", city, "CDMX"},
		{"country", country, "MX"},
		{"linkedin_url", li, "https://linkedin.com/company/ws2db"},
		{"instagram_url", ig, "https://instagram.com/ws2db"},
		{"facebook_url", fb, "https://facebook.com/ws2db"},
		{"twitter_url", tw, "https://twitter.com/ws2db"},
		{"cover_image_url", cover, "https://cdn.example.com/cover.jpg"},
	}
	for _, c := range checks {
		if c.got == nil || *c.got != c.want {
			t.Errorf("%s: want %q, got %v", c.label, c.want, c.got)
		}
	}
	if fy == nil || *fy != 2024 {
		t.Errorf("founded_year: want 2024, got %v", fy)
	}
	if !updatedAt.After(preUpdatedAt) {
		t.Errorf("updated_at: want > %v, got %v", preUpdatedAt, updatedAt)
	}
	if got := auditCount(t, ctx, pool, id); got != preAudit+1 {
		t.Errorf("audit delta: want +1, got pre=%d post=%d", preAudit, got)
	}
}
