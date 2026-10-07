//go:build integration

// Isolated-PostgreSQL coverage for the private draft persistence adapter.
//
// These tests run ONLY against the dedicated ephemeral database named by
// DRAFT_TEST_DATABASE_URL and refuse any DSN whose database is not
// `draft_test` or whose host is not loopback, so an ambient DATABASE_URL can
// never point them at another database or container. The suite applies the
// embedded goose migrations itself (00001..00012), so it is self-contained
// against a fresh, empty isolated instance.
package draftstore

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditrepositories "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/repositories"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftversion"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

const (
	isolatedDSNEnv = "DRAFT_TEST_DATABASE_URL"
	isolatedDBName = "draft_test"
)

var (
	testPoolOnce sync.Once
	testPool     *pgxpool.Pool
	testPoolErr  error
)

// requireDraftPool returns the shared isolated pool, applying the embedded
// migrations exactly once. It skips (never fails) when the isolated DSN is
// absent and hard-fails when a DSN points anywhere but the dedicated
// loopback `draft_test` database.
func requireDraftPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv(isolatedDSNEnv)
	if dsn == "" {
		t.Skipf("%s not set; skipping isolated draft integration test", isolatedDSNEnv)
	}

	testPoolOnce.Do(func() {
		cfg, err := pgxpool.ParseConfig(dsn)
		if err != nil {
			testPoolErr = fmt.Errorf("parse %s: %w", isolatedDSNEnv, err)
			return
		}
		host := cfg.ConnConfig.Host
		if cfg.ConnConfig.Database != isolatedDBName || !isLoopback(host) {
			testPoolErr = fmt.Errorf(
				"refusing non-isolated database: host=%q database=%q (want loopback + %q)",
				host, cfg.ConnConfig.Database, isolatedDBName,
			)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			testPoolErr = fmt.Errorf("connect: %w", err)
			return
		}
		if err := pool.Ping(ctx); err != nil {
			pool.Close()
			testPoolErr = fmt.Errorf("ping: %w", err)
			return
		}
		if err := applyEmbeddedMigrations(ctx, pool); err != nil {
			pool.Close()
			testPoolErr = fmt.Errorf("apply migrations: %w", err)
			return
		}
		testPool = pool
	})
	if testPoolErr != nil {
		t.Fatalf("isolated draft database: %v", testPoolErr)
	}
	return testPool
}

func isLoopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1", "[::1]":
		return true
	default:
		return false
	}
}

// applyEmbeddedMigrations runs the goose migrations embedded in the binary so
// the isolated database reaches schema version 00012 with no external CLI.
func applyEmbeddedMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()

	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.UpContext(ctx, sqlDB, ".")
}

// --- fixtures --------------------------------------------------------------

// principal is one company with an owner membership and the owner's user id.
type principal struct {
	companyID uuid.UUID
	ownerID   uuid.UUID
}

// newPrincipal inserts an active company plus its owner user + membership and
// registers FK-safe cleanup for every row the test may create under it.
func newPrincipal(t *testing.T, pool *pgxpool.Pool) principal {
	t.Helper()
	p := principal{companyID: insertCompany(t, pool, "active"), ownerID: insertUser(t, pool)}
	insertMembership(t, pool, p.companyID, p.ownerID, "owner")
	registerCompanyCleanup(t, pool, p.companyID, p.ownerID)
	return p
}

// addMember inserts a second user with the given role in companyID and returns
// the user id. Cleanup is registered on the caller's test.
func addMember(t *testing.T, pool *pgxpool.Pool, companyID uuid.UUID, role string) uuid.UUID {
	t.Helper()
	userID := insertUser(t, pool)
	insertMembership(t, pool, companyID, userID, role)
	registerUserCleanup(t, pool, userID)
	return userID
}

func insertCompany(t *testing.T, pool *pgxpool.Pool, status string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO companies (id, name, rfc, industry_id, status)
		 VALUES ($1, $2, $3, 'technology', $4)`,
		id, "Draft Test "+id.String(), strings.ToUpper(strings.ReplaceAll(id.String(), "-", "")), status,
	); err != nil {
		t.Fatalf("insert company: %v", err)
	}
	return id
}

func insertUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, 'recruiter')`,
		id, "draft-"+id.String(), "draft-"+id.String()+"@example.test", "Draft Test",
	); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

func insertMembership(t *testing.T, pool *pgxpool.Pool, companyID, userID uuid.UUID, role string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO company_members (id, user_id, company_id, role)
		 VALUES ($1, $2, $3, $4)`,
		uuid.Must(uuid.NewV7()), userID, companyID, role,
	); err != nil {
		t.Fatalf("insert membership: %v", err)
	}
}

// insertRequester inserts an immutable requester catalog entry and returns it.
func insertRequester(t *testing.T, pool *pgxpool.Pool, companyID uuid.UUID, kind, name string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO job_draft_requesters (id, company_id, kind, name, name_key, normalization_version)
		 VALUES ($1, $2, $3, $4, $5, 1)`,
		id, companyID, kind, name, strings.ToUpper(name),
	); err != nil {
		t.Fatalf("insert requester: %v", err)
	}
	return id
}

func registerCompanyCleanup(t *testing.T, pool *pgxpool.Pool, companyID uuid.UUID, extras ...uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM audit_events WHERE entity_id IN (SELECT id FROM job_drafts WHERE company_id = $1)`, companyID)
		_, _ = pool.Exec(ctx, `DELETE FROM job_draft_idempotency WHERE company_id = $1`, companyID)
		_, _ = pool.Exec(ctx, `DELETE FROM job_drafts WHERE company_id = $1`, companyID)
		_, _ = pool.Exec(ctx, `DELETE FROM job_draft_requesters WHERE company_id = $1`, companyID)
		_, _ = pool.Exec(ctx, `DELETE FROM company_members WHERE company_id = $1`, companyID)
		_, _ = pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, companyID)
		for _, userID := range extras {
			_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
		}
	})
}

func registerUserCleanup(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) {
	t.Helper()
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
}

// --- request bodies --------------------------------------------------------

func minimalCreateBody() []byte {
	return []byte(`{"fields":{"title":"Backend Go","professional_area":"technology_systems"}}`)
}

func titlePatchBody(title string) []byte {
	return []byte(`{"fields":{"title":"` + title + `"}}`)
}

func requesterBody(kind, id string) []byte {
	return []byte(`{"fields":{"requester":{"kind":"` + kind + `","id":"` + id + `"}}}`)
}

// --- assertion helpers -----------------------------------------------------

func newStore(t *testing.T, pool *pgxpool.Pool) *Store {
	t.Helper()
	return NewStore(pool, mustAuditRepository())
}

func mustAuditRepository() auditrepositories.AuditEventRepository {
	return auditpostgres.NewAuditEventRepository()
}

func envelopeOf(t *testing.T, body []byte) map[string]any {
	t.Helper()
	value, err := draftjson.Decode(body)
	if err != nil {
		t.Fatalf("decode envelope: %v\nbody: %s", err, body)
	}
	object, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("envelope is not an object: %T", value)
	}
	return object
}

func envelopeFields(t *testing.T, body []byte) map[string]any {
	t.Helper()
	fields, ok := envelopeOf(t, body)["fields"].(map[string]any)
	if !ok {
		t.Fatalf("envelope.fields is not an object: %s", body)
	}
	return fields
}

func envelopeString(t *testing.T, body []byte, key string) string {
	t.Helper()
	value, ok := envelopeOf(t, body)[key].(string)
	if !ok {
		t.Fatalf("envelope[%q] is not a string: %#v", key, envelopeOf(t, body)[key])
	}
	return value
}

func create(t *testing.T, store *Store, p principal, key string, body []byte) drafts.Result {
	t.Helper()
	result, err := store.Create(context.Background(), p.companyID, p.ownerID, key, body)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	return result
}

func draftIDOf(t *testing.T, result drafts.Result) uuid.UUID {
	t.Helper()
	id, err := uuid.Parse(envelopeString(t, result.Body, "id"))
	if err != nil {
		t.Fatalf("parse draft id: %v", err)
	}
	return id
}

func ifMatchFor(t *testing.T, id uuid.UUID, version int64) string {
	t.Helper()
	tag, err := draftversion.FormatETag(id.String(), version)
	if err != nil {
		t.Fatalf("FormatETag: %v", err)
	}
	return tag
}

func countRows(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count (%s): %v", query, err)
	}
	return n
}

func auditCount(t *testing.T, pool *pgxpool.Pool, entityID uuid.UUID, eventType string) int {
	t.Helper()
	return countRows(t, pool,
		`SELECT count(*) FROM audit_events WHERE entity_id = $1 AND event_type = $2`,
		entityID, eventType)
}

func draftRow(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) (version int64, body []byte, found bool) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT version, fields FROM job_drafts WHERE id = $1`, id,
	).Scan(&version, &body)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil, false
	}
	if err != nil {
		t.Fatalf("read draft row: %v", err)
	}
	return version, body, true
}

// --- tests -----------------------------------------------------------------

// TestCreate_PersistsDraftIdempotencyAndAudit is the create happy path: the
// returned envelope is complete, the draft row carries the immutable identity
// columns and version 1, the audit event is written once and the idempotency
// record is stored exactly once.
func TestCreate_PersistsDraftIdempotencyAndAudit(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	key := uuid.NewString()
	result := create(t, store, p, key, minimalCreateBody())

	if result.Replayed {
		t.Error("first create must not be a replay")
	}
	id := draftIDOf(t, result)
	if want := ifMatchFor(t, id, 1); result.ETag != want {
		t.Errorf("ETag: want %s, got %s", want, result.ETag)
	}

	version, _, found := draftRow(t, pool, id)
	if !found {
		t.Fatal("draft row not persisted")
	}
	if version != 1 {
		t.Errorf("version: want 1, got %d", version)
	}

	var companyID, createdBy, principalID uuid.UUID
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT company_id, created_by, principal_recruiter_id, status FROM job_drafts WHERE id = $1`, id,
	).Scan(&companyID, &createdBy, &principalID, &status); err != nil {
		t.Fatalf("read identity columns: %v", err)
	}
	if companyID != p.companyID || createdBy != p.ownerID || principalID != p.ownerID || status != "draft" {
		t.Errorf("identity: company=%s created_by=%s principal=%s status=%s",
			companyID, createdBy, principalID, status)
	}

	if got := auditCount(t, pool, id, entities.EventJobDraftCreated); got != 1 {
		t.Errorf("JobDraftCreated audit rows: want 1, got %d", got)
	}
	if got := countRows(t, pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND operation = 'create' AND idem_key = $3`,
		p.companyID, p.ownerID, key); got != 1 {
		t.Errorf("idempotency rows: want 1, got %d", got)
	}

	fields := envelopeFields(t, result.Body)
	if fields["title"] != "Backend Go" {
		t.Errorf("title: want Backend Go, got %#v", fields["title"])
	}
	compensation, ok := fields["compensation"].(map[string]any)
	if !ok {
		t.Fatalf("compensation missing from envelope: %#v", fields["compensation"])
	}
	if compensation["currency"] != "MXN" || compensation["pay_period"] != "monthly" || compensation["public_visible"] != false {
		t.Errorf("compensation defaults wrong: %#v", compensation)
	}
	if skills, ok := fields["skills"].([]any); !ok || len(skills) != 0 {
		t.Errorf("skills default: want empty list, got %#v", fields["skills"])
	}
	if envelopeString(t, result.Body, "version") != "1" {
		t.Errorf("version string: want \"1\", got %q", envelopeString(t, result.Body, "version"))
	}
}

// TestCreate_RequiresWellFormedIdempotencyKey pins the key contract.
func TestCreate_RequiresWellFormedIdempotencyKey(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	if _, err := store.Create(context.Background(), p.companyID, p.ownerID, "", minimalCreateBody()); !errors.Is(err, drafts.ErrIdempotencyKeyRequired) {
		t.Errorf("empty key: want ErrIdempotencyKeyRequired, got %v", err)
	}
	if _, err := store.Create(context.Background(), p.companyID, p.ownerID, "not-a-uuid", minimalCreateBody()); !errors.Is(err, drafts.ErrInvalidIdempotencyKey) {
		t.Errorf("bad key: want ErrInvalidIdempotencyKey, got %v", err)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, p.companyID); got != 0 {
		t.Errorf("rejected creates must not persist drafts, got %d rows", got)
	}
}

// TestCreate_ReplayReturnsOriginalBodyAndETag proves idempotent replay,
// including after the draft has advanced: the replay serves the frozen v1
// body/ETag while an explicit Get serves the current v2.
func TestCreate_ReplayReturnsOriginalBodyAndETag(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	first := create(t, store, p, key, minimalCreateBody())
	id := draftIDOf(t, first)

	if _, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 1), true, titlePatchBody("Backend Rust")); err != nil {
		t.Fatalf("Save to v2: %v", err)
	}

	replay, err := store.Create(context.Background(), p.companyID, p.ownerID, key, minimalCreateBody())
	if err != nil {
		t.Fatalf("replay Create: %v", err)
	}
	if !replay.Replayed {
		t.Error("replay must set Replayed=true")
	}
	if string(replay.Body) != string(first.Body) || replay.ETag != first.ETag {
		t.Error("replay must return the original body and ETag byte-for-byte")
	}
	if got := envelopeString(t, replay.Body, "version"); got != "1" {
		t.Errorf("replayed version: want \"1\", got %q", got)
	}

	current, err := store.Get(context.Background(), p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatalf("Get current: %v", err)
	}
	if got := envelopeString(t, current.Body, "version"); got != "2" {
		t.Errorf("current version: want \"2\", got %q", got)
	}

	if got := countRows(t, pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, p.companyID); got != 1 {
		t.Errorf("replay must not create a second draft, got %d rows", got)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftCreated); got != 1 {
		t.Errorf("replay must not re-audit creation, got %d", got)
	}
}

// TestCreate_NormalizedReplayReplaysDefaultsAndDecimals proves the fingerprint
// is the normalized DTO: an equivalent payload (object key order irrelevant,
// decimal normalization applied) replays instead of conflicting.
func TestCreate_NormalizedReplayReplaysDefaultsAndDecimals(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	first := create(t, store, p, key, []byte(`{"fields":{"title":"Backend Go","compensation":{"mode":"range","amount":null,"min":"30000.00","max":"45000","currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}}}`))
	second, err := store.Create(context.Background(), p.companyID, p.ownerID, key, []byte(`{"fields":{"compensation":{"public_visible":false,"basis":"gross","pay_period":"monthly","currency":"MXN","max":"45000.00","min":"30000","amount":null,"mode":"range"},"title":"Backend Go"}}`))
	if err != nil {
		t.Fatalf("normalized replay: %v", err)
	}
	if !second.Replayed {
		t.Error("equivalent normalized payload must replay")
	}
	if string(second.Body) != string(first.Body) {
		t.Error("normalized replay must return the original body")
	}
}

// TestCreate_ChangedPayloadConflicts proves the idempotency conflict branch and
// that it neither creates a second draft nor leaks the original body.
func TestCreate_ChangedPayloadConflicts(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	first := create(t, store, p, key, minimalCreateBody())
	id := draftIDOf(t, first)

	result, err := store.Create(context.Background(), p.companyID, p.ownerID, key, titlePatchBody("Something Else"))
	if !errors.Is(err, drafts.ErrIdempotencyConflict) {
		t.Fatalf("changed payload: want ErrIdempotencyConflict, got %v", err)
	}
	if len(result.Body) != 0 || result.ETag != "" || result.Replayed {
		t.Errorf("conflict must return no body/etag, got %#v", result)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, p.companyID); got != 1 {
		t.Errorf("conflict must not create a second draft, got %d", got)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftCreated); got != 1 {
		t.Errorf("conflict must not audit, got %d", got)
	}
}

// TestCreate_ConcurrentSameKeyYieldsOneRowAndOneAudit is the acceptance
// concurrency proof: two simultaneous creates with the same key result in one
// draft row, one audit event and one idempotency record.
func TestCreate_ConcurrentSameKeyYieldsOneRowAndOneAudit(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	const callers = 2
	type outcome struct {
		result drafts.Result
		err    error
	}
	var wg sync.WaitGroup
	outcomes := make(chan outcome, callers)
	start := make(chan struct{})
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := store.Create(context.Background(), p.companyID, p.ownerID, key, minimalCreateBody())
			outcomes <- outcome{result: result, err: err}
		}()
	}
	close(start)
	wg.Wait()
	close(outcomes)

	var first drafts.Result
	set := false
	var id uuid.UUID
	replayed := 0
	for got := range outcomes {
		if got.err != nil {
			t.Fatalf("concurrent create: %v", got.err)
		}
		if got.result.Replayed {
			replayed++
		}
		if !set {
			first = got.result
			id = draftIDOf(t, first)
			set = true
		} else if string(got.result.Body) != string(first.Body) {
			t.Errorf("concurrent creates returned different bodies")
		}
	}
	if replayed != callers-1 {
		t.Errorf("exactly %d caller(s) must observe a replay, got %d", callers-1, replayed)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, p.companyID); got != 1 {
		t.Errorf("concurrent creates: want 1 draft row, got %d", got)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftCreated); got != 1 {
		t.Errorf("concurrent creates: want 1 audit row, got %d", got)
	}
	if got := countRows(t, pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND idem_key = $3`,
		p.companyID, p.ownerID, key); got != 1 {
		t.Errorf("concurrent creates: want 1 idempotency row, got %d", got)
	}
}

// TestCreate_RequesterCatalogScopeAndKind proves requester references are
// validated transactionally against company + kind, never a client name.
func TestCreate_RequesterCatalogScopeAndKind(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	other := newPrincipal(t, pool)

	clientID := insertRequester(t, pool, p.companyID, "client", "Acme Client")
	internalID := insertRequester(t, pool, p.companyID, "internal_area", "Engineering")
	foreignID := insertRequester(t, pool, other.companyID, "client", "Other Client")

	ok := create(t, store, p, uuid.NewString(), requesterBody("client", clientID.String()))
	requester, ok2 := envelopeFields(t, ok.Body)["requester"].(map[string]any)
	if !ok2 {
		t.Fatalf("requester missing from envelope: %s", ok.Body)
	}
	if requester["name"] != "Acme Client" {
		t.Errorf("requester.name: want Acme Client, got %#v", requester["name"])
	}

	// Wrong kind for the same id must reject with a validation error.
	if _, err := store.Create(context.Background(), p.companyID, p.ownerID, uuid.NewString(), requesterBody("internal_area", clientID.String())); !errors.Is(err, drafts.ErrValidation) {
		t.Errorf("wrong kind: want ErrValidation, got %v", err)
	}
	// Same id, same kind, different company must reject.
	if _, err := store.Create(context.Background(), p.companyID, p.ownerID, uuid.NewString(), requesterBody("client", foreignID.String())); !errors.Is(err, drafts.ErrValidation) {
		t.Errorf("cross-company requester: want ErrValidation, got %v", err)
	}
	// A valid internal_area reference resolves.
	internal := create(t, store, p, uuid.NewString(), requesterBody("internal_area", internalID.String()))
	if got := envelopeFields(t, internal.Body)["requester"].(map[string]any)["name"]; got != "Engineering" {
		t.Errorf("internal requester.name: want Engineering, got %#v", got)
	}
	// Null id is allowed and publishes a null name.
	nullID := create(t, store, p, uuid.NewString(), []byte(`{"fields":{"requester":{"kind":"internal_area","id":null}}}`))
	if got := envelopeFields(t, nullID.Body)["requester"].(map[string]any)["name"]; got != nil {
		t.Errorf("null requester id: want null name, got %#v", got)
	}
}

// TestGet_AuthorizationGates walks the general gates and the resource gate for
// the read path.
func TestGet_AuthorizationGates(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)

	// Happy path: byte-identical to the create envelope.
	current, err := store.Get(context.Background(), p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if string(current.Body) != string(created.Body) || current.ETag != created.ETag {
		t.Error("Get must reproduce the create envelope for an unchanged draft")
	}
	if current.Replayed {
		t.Error("Get must never report Replayed")
	}

	// A recruiter who is neither owner nor principal gets the invisible 404.
	recruiterID := addMember(t, pool, p.companyID, "recruiter")
	if _, err := store.Get(context.Background(), p.companyID, recruiterID, id); !errors.Is(err, drafts.ErrNotFound) {
		t.Errorf("non-principal: want ErrNotFound, got %v", err)
	}
	// Cross-company owner gets the same 404: their session company is not the
	// draft's company, so the scoped lookup finds nothing (gates pass).
	other := newPrincipal(t, pool)
	if _, err := store.Get(context.Background(), other.companyID, other.ownerID, id); !errors.Is(err, drafts.ErrNotFound) {
		t.Errorf("cross-company: want ErrNotFound, got %v", err)
	}
	// Unknown id.
	if _, err := store.Get(context.Background(), p.companyID, p.ownerID, uuid.New()); !errors.Is(err, drafts.ErrNotFound) {
		t.Errorf("unknown id: want ErrNotFound, got %v", err)
	}
}

// TestGet_GeneralGatesPrecedeResourceNotFound pins user/membership/company
// gate classification.
func TestGet_GeneralGatesPrecedeResourceNotFound(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)

	// Tombstoned user → 401.
	p1 := newPrincipal(t, pool)
	if _, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at = now() WHERE id = $1`, p1.ownerID); err != nil {
		t.Fatalf("tombstone user: %v", err)
	}
	if _, err := store.Get(context.Background(), p1.companyID, p1.ownerID, uuid.New()); !errors.Is(err, drafts.ErrUnauthenticated) {
		t.Errorf("tombstoned user: want ErrUnauthenticated, got %v", err)
	}

	// Removed membership → 403 forbidden.
	p2 := newPrincipal(t, pool)
	removedMember := addMember(t, pool, p2.companyID, "recruiter")
	if _, err := pool.Exec(context.Background(), `DELETE FROM company_members WHERE user_id = $1`, removedMember); err != nil {
		t.Fatalf("remove membership: %v", err)
	}
	if _, err := store.Get(context.Background(), p2.companyID, removedMember, uuid.New()); !errors.Is(err, drafts.ErrForbidden) {
		t.Errorf("removed membership: want ErrForbidden, got %v", err)
	}

	// Suspended company → 409 company_not_active.
	p3 := newPrincipal(t, pool)
	if _, err := pool.Exec(context.Background(), `UPDATE companies SET status = 'suspended' WHERE id = $1`, p3.companyID); err != nil {
		t.Fatalf("suspend company: %v", err)
	}
	if _, err := store.Get(context.Background(), p3.companyID, p3.ownerID, uuid.New()); !errors.Is(err, drafts.ErrCompanyNotActive) {
		t.Errorf("suspended company: want ErrCompanyNotActive, got %v", err)
	}

	// Tombstoned company → 403 company_inactive.
	p4 := newPrincipal(t, pool)
	if _, err := pool.Exec(context.Background(), `UPDATE companies SET deleted_at = now() WHERE id = $1`, p4.companyID); err != nil {
		t.Fatalf("tombstone company: %v", err)
	}
	if _, err := store.Get(context.Background(), p4.companyID, p4.ownerID, uuid.New()); !errors.Is(err, drafts.ErrCompanyInactive) {
		t.Errorf("tombstoned company: want ErrCompanyInactive, got %v", err)
	}
}

// TestSave_ChangeIncrementsVersionAndAudits is the explicit-save happy path.
func TestSave_ChangeIncrementsVersionAndAudits(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)

	saved, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 1), true, titlePatchBody("Backend Rust"))
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if saved.Replayed {
		t.Error("Save must never report Replayed")
	}
	if got := envelopeString(t, saved.Body, "version"); got != "2" {
		t.Errorf("version: want \"2\", got %q", got)
	}
	if saved.ETag != ifMatchFor(t, id, 2) {
		t.Errorf("ETag: want v2, got %s", saved.ETag)
	}
	if envelopeFields(t, saved.Body)["title"] != "Backend Rust" {
		t.Errorf("title not updated: %#v", envelopeFields(t, saved.Body)["title"])
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 1 {
		t.Errorf("JobDraftSaved audit rows: want 1, got %d", got)
	}

	// Identity columns are immutable across a save.
	var companyID, createdBy, principalID uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`SELECT company_id, created_by, principal_recruiter_id FROM job_drafts WHERE id = $1`, id,
	).Scan(&companyID, &createdBy, &principalID); err != nil {
		t.Fatalf("read identity columns: %v", err)
	}
	if companyID != p.companyID || createdBy != p.ownerID || principalID != p.ownerID {
		t.Errorf("save changed immutable identity: company=%s created_by=%s principal=%s",
			companyID, createdBy, principalID)
	}
}

// TestSave_PresentFieldsReplaceFully pins the no-nested-merge rule.
func TestSave_PresentFieldsReplaceFully(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), []byte(`{"fields":{"title":"Backend Go","skills":["go","sql"]}}`))
	id := draftIDOf(t, created)

	saved, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 1), true, []byte(`{"fields":{"skills":["rust"]}}`))
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	fields := envelopeFields(t, saved.Body)
	skills, ok := fields["skills"].([]any)
	if !ok || len(skills) != 1 || skills[0] != "rust" {
		t.Errorf("skills: want fully replaced [rust], got %#v", fields["skills"])
	}
	if fields["title"] != "Backend Go" {
		t.Errorf("absent field must be preserved, got %#v", fields["title"])
	}
}

// TestSave_NoOpKeepsVersionAndWritesNoAudit proves a byte-identical save is a
// no-op that still passed authorization and the precondition.
func TestSave_NoOpKeepsVersionAndWritesNoAudit(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)

	saved, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 1), true, titlePatchBody("Backend Go"))
	if err != nil {
		t.Fatalf("no-op Save: %v", err)
	}
	if saved.ETag != created.ETag {
		t.Errorf("no-op ETag: want %s, got %s", created.ETag, saved.ETag)
	}
	if string(saved.Body) != string(created.Body) {
		t.Error("no-op must return the unchanged envelope byte-for-byte")
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 0 {
		t.Errorf("no-op must not audit, got %d", got)
	}
	if version, _, _ := draftRow(t, pool, id); version != 1 {
		t.Errorf("no-op must not bump version, got %d", version)
	}
}

// TestSave_PreconditionClassification walks 428/400/412.
func TestSave_PreconditionClassification(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)
	ctx := context.Background()

	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, "", false, titlePatchBody("x")); !errors.Is(err, drafts.ErrPreconditionRequired) {
		t.Errorf("missing If-Match: want ErrPreconditionRequired, got %v", err)
	}
	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, `W/"jd-r1-`+id.String()+`-v1"`, true, titlePatchBody("x")); !errors.Is(err, drafts.ErrInvalidRequest) {
		t.Errorf("weak tag: want ErrInvalidRequest, got %v", err)
	}
	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, `"jd-r1-`+id.String()+`-v1", "jd-r1-`+id.String()+`-v1"`, true, titlePatchBody("x")); !errors.Is(err, drafts.ErrInvalidRequest) {
		t.Errorf("list tag: want ErrInvalidRequest, got %v", err)
	}
	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, ifMatchFor(t, id, 2), true, titlePatchBody("x")); !errors.Is(err, drafts.ErrVersionConflict) {
		t.Errorf("stale tag: want ErrVersionConflict, got %v", err)
	}
	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, ifMatchFor(t, uuid.New(), 1), true, titlePatchBody("x")); !errors.Is(err, drafts.ErrVersionConflict) {
		t.Errorf("foreign tag: want ErrVersionConflict, got %v", err)
	}
	if version, _, _ := draftRow(t, pool, id); version != 1 {
		t.Errorf("rejected saves must not bump version, got %d", version)
	}
}

// TestSave_ConflictReturnsNoBody pins that a 412 does not leak editor data.
func TestSave_ConflictReturnsNoBody(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)

	result, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 99), true, titlePatchBody("x"))
	if !errors.Is(err, drafts.ErrVersionConflict) {
		t.Fatalf("want ErrVersionConflict, got %v", err)
	}
	if len(result.Body) != 0 || result.ETag != "" {
		t.Errorf("412 must not leak body/etag, got %#v", result)
	}
}

// TestSave_BodyClassification pins 413/400/400/400 for the save body.
func TestSave_BodyClassification(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)
	tag := ifMatchFor(t, id, 1)
	ctx := context.Background()

	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, tag, true, []byte(`{"fields":{}}`)); !errors.Is(err, drafts.ErrEmptyPatch) {
		t.Errorf("empty patch: want ErrEmptyPatch, got %v", err)
	}
	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, tag, true, []byte(`{"fields":{"unknown":1}}`)); !errors.Is(err, drafts.ErrInvalidRequest) {
		t.Errorf("unknown field: want ErrInvalidRequest, got %v", err)
	}
	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, tag, true, []byte(`{"fields":{"work_mode":"sometimes"}}`)); !errors.Is(err, drafts.ErrValidation) {
		t.Errorf("invalid value: want ErrValidation, got %v", err)
	}
	oversize := make([]byte, draftinput.MaxBodyBytes+1)
	for i := range oversize {
		oversize[i] = ' '
	}
	if _, err := store.Save(ctx, p.companyID, p.ownerID, id, tag, true, oversize); !errors.Is(err, drafts.ErrPayloadTooLarge) {
		t.Errorf("oversize body: want ErrPayloadTooLarge, got %v", err)
	}
}

// TestSave_VersionOverflowFailsSafely forces the version space to its maximum
// and proves the increment refuses to roll over.
func TestSave_VersionOverflowFailsSafely(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)
	if _, err := pool.Exec(context.Background(), `UPDATE job_drafts SET version = $1 WHERE id = $2`, int64(math.MaxInt64), id); err != nil {
		t.Fatalf("force version: %v", err)
	}

	_, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, math.MaxInt64), true, titlePatchBody("Backend Rust"))
	if !errors.Is(err, drafts.ErrVersionOverflow) {
		t.Fatalf("want ErrVersionOverflow, got %v", err)
	}
	if version, _, _ := draftRow(t, pool, id); version != math.MaxInt64 {
		t.Errorf("overflowing save must not change version, got %d", version)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 0 {
		t.Errorf("overflowing save must not audit, got %d", got)
	}
}

// TestSave_AuditFailureRollsBack proves the fail-closed co-write for save.
func TestSave_AuditFailureRollsBack(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)

	created, err := NewStore(pool, mustAuditRepository()).Create(context.Background(), p.companyID, p.ownerID, uuid.NewString(), minimalCreateBody())
	if err != nil {
		t.Fatalf("seed create: %v", err)
	}
	id := draftIDOf(t, created)
	versionBefore, bodyBefore, _ := draftRow(t, pool, id)

	failing := NewStore(pool, failingAudit{})
	if _, err := failing.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 1), true, titlePatchBody("Backend Rust")); err == nil {
		t.Fatal("want an error when the audit append fails")
	}

	versionAfter, bodyAfter, _ := draftRow(t, pool, id)
	if versionAfter != versionBefore || string(bodyAfter) != string(bodyBefore) {
		t.Error("audit failure must roll back the draft update")
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 0 {
		t.Errorf("audit failure must leave no saved event, got %d", got)
	}
}

// TestCreate_AuditFailureRollsBack proves the fail-closed co-write for create:
// no draft row, no idempotency record and no audit event survive.
func TestCreate_AuditFailureRollsBack(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	failing := NewStore(pool, failingAudit{})
	if _, err := failing.Create(context.Background(), p.companyID, p.ownerID, key, minimalCreateBody()); err == nil {
		t.Fatal("want an error when the audit append fails")
	}

	if got := countRows(t, pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, p.companyID); got != 0 {
		t.Errorf("failed create must leave no draft row, got %d", got)
	}
	if got := countRows(t, pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND idem_key = $2`,
		p.companyID, key); got != 0 {
		t.Errorf("failed create must leave no idempotency row, got %d", got)
	}
}

// TestCreate_ReplayReauthorizes proves a replay after membership removal is
// rejected by the general gates instead of returning the stored body.
func TestCreate_ReplayReauthorizes(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	create(t, store, p, key, minimalCreateBody())
	if _, err := pool.Exec(context.Background(),
		`DELETE FROM company_members WHERE user_id = $1 AND company_id = $2`,
		p.ownerID, p.companyID); err != nil {
		t.Fatalf("remove membership: %v", err)
	}

	if _, err := store.Create(context.Background(), p.companyID, p.ownerID, key, minimalCreateBody()); !errors.Is(err, drafts.ErrForbidden) {
		t.Errorf("replay after membership removal: want ErrForbidden, got %v", err)
	}
}

// TestSave_NonPrincipalRecruiterGets404 proves the save resource gate.
func TestSave_NonPrincipalRecruiterGets404(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)
	recruiterID := addMember(t, pool, p.companyID, "recruiter")

	if _, err := store.Save(context.Background(), p.companyID, recruiterID, id, ifMatchFor(t, id, 1), true, titlePatchBody("x")); !errors.Is(err, drafts.ErrNotFound) {
		t.Errorf("non-principal save: want ErrNotFound, got %v", err)
	}
}

// TestRequesterNameSurvivesSave pins that a saved draft still renders the
// immutable catalog name for an untouched requester.
func TestRequesterNameSurvivesSave(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	requesterID := insertRequester(t, pool, p.companyID, "client", "Acme Client")

	created := create(t, store, p, uuid.NewString(), requesterBody("client", requesterID.String()))
	id := draftIDOf(t, created)

	saved, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 1), true, titlePatchBody("Backend Rust"))
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	requester := envelopeFields(t, saved.Body)["requester"].(map[string]any)
	if requester["name"] != "Acme Client" {
		t.Errorf("requester.name after save: want Acme Client, got %#v", requester["name"])
	}
}

// TestCreate_IdempotencyKeyCanonicalizesUUIDSpellings proves the idempotency
// identity is the canonical UUID string, not the raw client text: hyphenated,
// unhyphenated and uppercase spellings of one UUID must share one draft, one
// audit event and one idempotency row, and must replay.
func TestCreate_IdempotencyKeyCanonicalizesUUIDSpellings(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	const canonical = "018f0000-0000-7000-8000-0000000000e1"
	variants := []string{
		canonical,
		"018f00000000700080000000000000e1",
		"018F0000-0000-7000-8000-0000000000E1",
	}

	first := create(t, store, p, variants[0], minimalCreateBody())
	for _, variant := range variants[1:] {
		replay, err := store.Create(context.Background(), p.companyID, p.ownerID, variant, minimalCreateBody())
		if err != nil {
			t.Fatalf("replay with variant %q: %v", variant, err)
		}
		if !replay.Replayed {
			t.Errorf("variant %q must replay the canonical key", variant)
		}
		if string(replay.Body) != string(first.Body) {
			t.Errorf("variant %q returned a different body", variant)
		}
	}

	if got := countRows(t, pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, p.companyID); got != 1 {
		t.Errorf("alternative UUID spellings must not create extra drafts, got %d", got)
	}
	if got := countRows(t, pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND idem_key = $3`,
		p.companyID, p.ownerID, canonical); got != 1 {
		t.Errorf("idempotency row must be stored under the canonical key, got %d", got)
	}
	if got := countRows(t, pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2`,
		p.companyID, p.ownerID); got != 1 {
		t.Errorf("exactly one idempotency row expected, got %d", got)
	}
	if got := auditCount(t, pool, draftIDOf(t, first), entities.EventJobDraftCreated); got != 1 {
		t.Errorf("alternative UUID spellings must not re-audit, got %d", got)
	}
}

// TestCreate_ReplayReauthorizesAddressedDraft proves a replay re-checks
// owner/principal on the addressed draft (derived from the stored ETag) after
// the general gates and before any conflict/replay return.
func TestCreate_ReplayReauthorizesAddressedDraft(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	first := create(t, store, p, key, minimalCreateBody())
	id := draftIDOf(t, first)

	// Controlled fixture: demote the creator to recruiter and reassign the
	// draft principal to another member. Both mutations are adapter-immutable on
	// the normal path; here they simulate the future principal reassignment the
	// replay authorization check must defend against.
	successor := addMember(t, pool, p.companyID, "recruiter")
	if _, err := pool.Exec(context.Background(),
		`UPDATE company_members SET role = 'recruiter' WHERE user_id = $1 AND company_id = $2`,
		p.ownerID, p.companyID); err != nil {
		t.Fatalf("demote creator: %v", err)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE job_drafts SET principal_recruiter_id = $1 WHERE id = $2`,
		successor, id); err != nil {
		t.Fatalf("reassign principal: %v", err)
	}

	for _, body := range [][]byte{minimalCreateBody(), []byte(`{"fields":{"title":"different payload"}}`)} {
		if result, err := store.Create(context.Background(), p.companyID, p.ownerID, key, body); !errors.Is(err, drafts.ErrNotFound) || len(result.Body) != 0 || result.ETag != "" {
			t.Errorf("unauthorized replay/conflict must return only ErrNotFound: result=%+v err=%v", result, err)
		}
	}
}

// TestSave_ConcurrentSameTagOneWins proves the draft row lock serializes two
// saves holding the same If-Match: exactly one wins, the other loses the CAS.
func TestSave_ConcurrentSameTagOneWins(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)
	tag := ifMatchFor(t, id, 1)

	ctx := context.Background()
	var wg sync.WaitGroup
	results := make(chan error, 2)
	start := make(chan struct{})
	for _, title := range []string{"Backend Rust", "Backend Zig"} {
		wg.Add(1)
		go func(title string) {
			defer wg.Done()
			<-start
			_, err := store.Save(ctx, p.companyID, p.ownerID, id, tag, true, titlePatchBody(title))
			results <- err
		}(title)
	}
	close(start)
	wg.Wait()
	close(results)

	success, conflict := 0, 0
	for err := range results {
		switch {
		case err == nil:
			success++
		case errors.Is(err, drafts.ErrVersionConflict):
			conflict++
		default:
			t.Fatalf("unexpected save error: %v", err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Errorf("same-tag concurrent save: want 1 success + 1 conflict, got success=%d conflict=%d", success, conflict)
	}
	if version, _, _ := draftRow(t, pool, id); version != 2 {
		t.Errorf("version after concurrent save: want 2, got %d", version)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 1 {
		t.Errorf("concurrent save must audit exactly once, got %d", got)
	}
}

// TestCreate_InFlightMembershipRevokeBlocks is the deterministic lock proof:
// while the store transaction holds FOR SHARE on the member row, a concurrent
// DELETE is blocked (bounded by lock_timeout, no sleeps) and only succeeds after
// the store commits.
func TestCreate_InFlightMembershipRevokeBlocks(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	blocking := &blockingAudit{reached: make(chan struct{}, 1), release: make(chan struct{}, 1)}
	store := NewStore(pool, blocking)

	ctx := context.Background()
	done := make(chan error, 1)
	go func() {
		_, err := store.Create(ctx, p.companyID, p.ownerID, uuid.NewString(), minimalCreateBody())
		done <- err
	}()

	select {
	case <-blocking.reached:
	case <-time.After(15 * time.Second):
		t.Fatal("store never reached the audit stage; the member lock was not held")
	}

	// The store transaction now holds FOR SHARE on users/companies/company_members.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire second connection: %v", err)
	}
	defer conn.Release()

	revokeTx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin revoke tx: %v", err)
	}
	if _, err := revokeTx.Exec(ctx, `SET LOCAL lock_timeout = '1000ms'`); err != nil {
		t.Fatalf("set lock_timeout: %v", err)
	}
	if _, err := revokeTx.Exec(ctx,
		`DELETE FROM company_members WHERE user_id = $1 AND company_id = $2`,
		p.ownerID, p.companyID); err != nil {
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "55P03" {
			t.Errorf("want PostgreSQL lock timeout 55P03, got %v", err)
		}
	} else {
		t.Error("revoke must block while the member row is FOR SHARE locked by the store transaction")
	}
	_ = revokeTx.Rollback(ctx)

	if got := countRows(t, pool, `SELECT count(*) FROM company_members WHERE user_id = $1`, p.ownerID); got != 1 {
		t.Errorf("membership must survive the blocked revoke, got %d rows", got)
	}

	blocking.release <- struct{}{}
	if err := <-done; err != nil {
		t.Fatalf("blocked create: %v", err)
	}

	if _, err := pool.Exec(ctx,
		`DELETE FROM company_members WHERE user_id = $1 AND company_id = $2`,
		p.ownerID, p.companyID); err != nil {
		t.Fatalf("post-commit revoke: %v", err)
	}
	if got := countRows(t, pool, `SELECT count(*) FROM company_members WHERE user_id = $1`, p.ownerID); got != 0 {
		t.Errorf("membership must be removable after the store commits, got %d rows", got)
	}
}

// TestSave_PostgresAuditFailureRollsBack forces a real PostgreSQL failure on the
// audit INSERT for one draft via a temporary trigger, then proves the store's
// save rolls back the draft row completely.
func TestSave_PostgresAuditFailureRollsBack(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)

	created := create(t, store, p, uuid.NewString(), minimalCreateBody())
	id := draftIDOf(t, created)
	versionBefore, bodyBefore, _ := draftRow(t, pool, id)

	ensureAuditRejectHarness(t, pool)
	addAuditRejectRule(t, pool, entities.EventJobDraftSaved, &id, nil)

	_, err := store.Save(context.Background(), p.companyID, p.ownerID, id, ifMatchFor(t, id, 1), true, titlePatchBody("Backend Rust"))
	requireAuditInsertFailure(t, err)

	versionAfter, bodyAfter, _ := draftRow(t, pool, id)
	if versionAfter != versionBefore || string(bodyAfter) != string(bodyBefore) {
		t.Error("PG audit failure must roll back the draft update")
	}
	after, err := store.Get(context.Background(), p.companyID, p.ownerID, id)
	if err != nil || string(after.Body) != string(created.Body) || after.ETag != created.ETag {
		t.Fatalf("audit rollback must preserve the full response including updated_at: result=%+v err=%v", after, err)
	}
	if got := auditCount(t, pool, id, entities.EventJobDraftSaved); got != 0 {
		t.Errorf("PG audit failure must leave no saved event, got %d", got)
	}
}

// TestCreate_PostgresAuditFailureRollsBack forces a real PostgreSQL failure on
// the create audit INSERT via a temporary trigger keyed on the test actor, then
// proves no draft row and no idempotency record survive.
func TestCreate_PostgresAuditFailureRollsBack(t *testing.T) {
	pool := requireDraftPool(t)
	store := newStore(t, pool)
	p := newPrincipal(t, pool)
	key := uuid.NewString()

	ensureAuditRejectHarness(t, pool)
	owner := p.ownerID
	addAuditRejectRule(t, pool, entities.EventJobDraftCreated, nil, &owner)

	_, err := store.Create(context.Background(), p.companyID, p.ownerID, key, minimalCreateBody())
	requireAuditInsertFailure(t, err)

	if got := countRows(t, pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, p.companyID); got != 0 {
		t.Errorf("failed create must leave no draft row, got %d", got)
	}
	if got := countRows(t, pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND idem_key = $2`,
		p.companyID, key); got != 0 {
		t.Errorf("failed create must leave no idempotency row, got %d", got)
	}
}

func requireAuditInsertFailure(t *testing.T, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "P0001" || pgErr.Message != "forced audit insert failure (test rule)" {
		t.Fatalf("want the test audit trigger exception P0001, got %v", err)
	}
}

// auditRejectHarnessDDL is a static, test-only harness that lets the isolated
// integration suite force real PostgreSQL audit INSERT failures without any
// dynamic identifier interpolation. The trigger is a no-op unless a matching
// row exists in test_audit_reject_rules, and the rules table is only ever
// populated by parameterized inserts from these tests.
const auditRejectHarnessDDL = `
CREATE TABLE IF NOT EXISTS test_audit_reject_rules (
    id         BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    entity_id  UUID,
    actor_id   UUID
);
CREATE OR REPLACE FUNCTION test_audit_reject_fn() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
      SELECT 1 FROM test_audit_reject_rules r
       WHERE r.event_type = NEW.event_type
         AND (r.entity_id IS NULL OR r.entity_id = NEW.entity_id)
         AND (r.actor_id IS NULL OR r.actor_id = NEW.actor_id)
  ) THEN
    RAISE EXCEPTION 'forced audit insert failure (test rule)';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS test_audit_reject_trigger ON audit_events;
CREATE TRIGGER test_audit_reject_trigger BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION test_audit_reject_fn();
`

// ensureAuditRejectHarness installs the static audit-reject trigger and its
// empty rule table. It is idempotent and used only by the isolated suite.
func ensureAuditRejectHarness(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), auditRejectHarnessDDL); err != nil {
		t.Fatalf("install audit reject harness: %v", err)
	}
}

// addAuditRejectRule adds one parameterized rule and removes it on cleanup. A
// nil entityID or actorID acts as a wildcard for that column.
func addAuditRejectRule(t *testing.T, pool *pgxpool.Pool, eventType string, entityID, actorID *uuid.UUID) {
	t.Helper()
	var id int64
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO test_audit_reject_rules (event_type, entity_id, actor_id) VALUES ($1, $2, $3) RETURNING id`,
		eventType, entityID, actorID,
	).Scan(&id); err != nil {
		t.Fatalf("add audit reject rule: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM test_audit_reject_rules WHERE id = $1`, id)
	})
}

// blockingAudit is an audit port that signals when the store transaction has
// reached the audit stage (locks held) and then blocks until released.
// Returning nil lets the store commit; it never touches the database.
type blockingAudit struct {
	reached chan struct{}
	release chan struct{}
}

func (b *blockingAudit) Append(context.Context, pgx.Tx, entities.AuditEvent) error {
	b.reached <- struct{}{}
	<-b.release
	return nil
}

// failingAudit is the forced-failure audit port used to prove audit rollback.
type failingAudit struct{}

func (failingAudit) Append(context.Context, pgx.Tx, entities.AuditEvent) error {
	return errors.New("forced audit failure")
}
