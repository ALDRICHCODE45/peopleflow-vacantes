//go:build integration

// Production-router acceptance for the private vacancy draft slice (T5).
//
// These tests drive the REAL production router over a real HTTP client:
//
//	httptest.NewServer(newRouter(...))
//	  -> real RequireAuth (ephemeral RS256 key, real JWT verification)
//	  -> real RequireCompanyRole (identity + membership + company liveness)
//	  -> real DraftHandler -> real draftstore.Store -> isolated PostgreSQL
//
// No fake session identity and no fake auth gate is used. The only synthetic
// inputs are an in-memory RSA keypair and the JSON the client sends.
//
// Isolation: the suite runs ONLY against the dedicated ephemeral database named
// by DRAFT_TEST_DATABASE_URL. It refuses any DSN whose database is not
// `draft_test` or whose host is not loopback, and it NEVER reads ambient
// DATABASE_URL. When the dedicated DSN is explicitly set the tests run (they do
// not silently skip); when it is absent the suite skips.
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	companiesvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	companiespostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/auth"
	identityhttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/http"
	identitypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/infrastructure/postgres"
	jobsusecases "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/usecases"
	jobshttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/http"
	jobspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres"
	draftstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	runtimemetrics "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/metrics"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/lestrrat-go/jwx/v2/jwa"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jwt"
	"github.com/pressly/goose/v3"
)

const (
	draftFlowDSNEnv = "DRAFT_TEST_DATABASE_URL"
	draftFlowDBName = "draft_test"

	draftFlowIssuer   = "https://draft-flow.test.local"
	draftFlowAudience = "draft-flow-client"
	draftFlowPath     = "/me/company/job-drafts"

	draftFlowMinimalCreate = `{"fields":{"title":"Backend Go","professional_area":"technology_systems"}}`
	draftFlowCompensation  = `{"fields":{"compensation":{"mode":"range","amount":null,"min":"30000","max":"45000","currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}}}`
)

var (
	draftFlowPoolOnce sync.Once
	draftFlowPool     *pgxpool.Pool
	draftFlowPoolErr  error

	draftFlowKeyOnce sync.Once
	draftFlowKey     *rsa.PrivateKey
)

// --- isolated database -----------------------------------------------------

func requireDraftFlowPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv(draftFlowDSNEnv)
	if dsn == "" {
		t.Skipf("%s not set; skipping isolated draft HTTP acceptance", draftFlowDSNEnv)
	}

	draftFlowPoolOnce.Do(func() {
		cfg, err := pgxpool.ParseConfig(dsn)
		if err != nil {
			draftFlowPoolErr = fmt.Errorf("parse %s: %w", draftFlowDSNEnv, err)
			return
		}
		host := cfg.ConnConfig.Host
		if cfg.ConnConfig.Database != draftFlowDBName || !draftFlowIsLoopback(host) {
			draftFlowPoolErr = fmt.Errorf(
				"refusing non-isolated database: host=%q database=%q (want loopback + %q)",
				host, cfg.ConnConfig.Database, draftFlowDBName,
			)
			return
		}

		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			draftFlowPoolErr = fmt.Errorf("connect: %w", err)
			return
		}
		if err := pool.Ping(ctx); err != nil {
			pool.Close()
			draftFlowPoolErr = fmt.Errorf("ping: %w", err)
			return
		}
		if err := draftFlowApplyMigrations(ctx, pool); err != nil {
			pool.Close()
			draftFlowPoolErr = fmt.Errorf("apply migrations: %w", err)
			return
		}
		draftFlowPool = pool
	})
	if draftFlowPoolErr != nil {
		t.Fatalf("isolated draft database: %v", draftFlowPoolErr)
	}
	return draftFlowPool
}

func draftFlowIsLoopback(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1", "[::1]":
		return true
	default:
		return false
	}
}

func draftFlowApplyMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()

	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	return goose.UpContext(ctx, sqlDB, ".")
}

// --- ephemeral RS256 key ---------------------------------------------------

func draftFlowRSAKey() *rsa.PrivateKey {
	draftFlowKeyOnce.Do(func() {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			panic("cannot generate ephemeral RSA key: " + err.Error())
		}
		draftFlowKey = key
	})
	return draftFlowKey
}

// draftFlowSigner issues JWTs with the ephemeral key and verifies them with the
// production verifier built from the public half.
type draftFlowSigner struct {
	verifier *auth.RSAVerifier
	private  jwk.Key
}

func newDraftFlowSigner(t *testing.T) *draftFlowSigner {
	t.Helper()
	key := draftFlowRSAKey()

	private, err := jwk.FromRaw(key)
	if err != nil {
		t.Fatalf("jwk.FromRaw(private): %v", err)
	}
	if err := private.Set(jwk.KeyIDKey, "draft-flow-kid"); err != nil {
		t.Fatalf("set private kid: %v", err)
	}

	public, err := jwk.FromRaw(&key.PublicKey)
	if err != nil {
		t.Fatalf("jwk.FromRaw(public): %v", err)
	}
	if err := public.Set(jwk.KeyIDKey, "draft-flow-kid"); err != nil {
		t.Fatalf("set public kid: %v", err)
	}
	if err := public.Set(jwk.AlgorithmKey, jwa.RS256); err != nil {
		t.Fatalf("set public alg: %v", err)
	}

	verifier, err := auth.NewRSAVerifier(public, draftFlowIssuer, draftFlowAudience)
	if err != nil {
		t.Fatalf("NewRSAVerifier: %v", err)
	}
	return &draftFlowSigner{verifier: verifier, private: private}
}

func (s *draftFlowSigner) token(t *testing.T, sub string, expiry time.Time) string {
	t.Helper()
	tok, err := jwt.NewBuilder().
		Issuer(draftFlowIssuer).
		Audience([]string{draftFlowAudience}).
		Subject(sub).
		IssuedAt(expiry.Add(-time.Hour)).
		Expiration(expiry).
		Build()
	if err != nil {
		t.Fatalf("build jwt: %v", err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.RS256, s.private))
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return string(signed)
}

func (s *draftFlowSigner) validToken(t *testing.T, sub string) string {
	t.Helper()
	return s.token(t, sub, time.Now().Add(time.Hour))
}

func (s *draftFlowSigner) expiredToken(t *testing.T, sub string) string {
	t.Helper()
	return s.token(t, sub, time.Now().Add(-time.Hour))
}

// --- harness ---------------------------------------------------------------

type draftFlowHarness struct {
	pool   *pgxpool.Pool
	server *httptest.Server
	client *http.Client
	signer *draftFlowSigner
}

// newDraftFlowHarness builds the real production router with the real auth and
// membership middleware, the real draft store over the isolated pool, and the
// real legacy job handler, then serves it over a real loopback listener.
func newDraftFlowHarness(t *testing.T) *draftFlowHarness {
	t.Helper()
	pool := requireDraftFlowPool(t)
	signer := newDraftFlowSigner(t)

	queries := db.New(pool)
	auditRepo := auditpostgres.NewAuditEventRepository()
	identityUserRepo := identitypostgres.NewUserRepository(queries)
	memberRepo := companiespostgres.NewCompanyMemberRepository(queries)
	companyRepo := companiespostgres.NewCompanyRepository(pool, auditRepo)

	store := draftstore.NewStore(pool, auditRepo)
	draftHandler := jobshttp.NewDraftHandler(store)
	draftV2Handler := jobshttp.NewDraftV2Handler(store, store, store)
	jobHandler := jobshttp.NewJobHandler(jobsusecases.NewJobService(jobspostgres.NewJobRepository(queries)))

	requireAuth := identityhttp.RequireAuth(signer.verifier)
	requireRecruiter := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, companyRepo, companiesvalueobjects.RecruiterRole)
	requireOwner := identityhttp.RequireCompanyRole(identityUserRepo, memberRepo, companyRepo, companiesvalueobjects.OwnerRole)

	router := newRouter(routerDeps{
		requireAuth:        requireAuth,
		requireRecruiter:   requireRecruiter,
		requireOwner:       requireOwner,
		jobHandler:         jobHandler,
		draftHandler:       draftHandler,
		draftV2Handler:     draftV2Handler,
		draftListHandler:   jobshttp.NewDraftListHandler(store),
		pipelineHandler:    jobshttp.NewPipelineHandler(store),
		substatesHandler:   jobshttp.NewSubstatesHandler(store),
		deliveryHandler:    jobshttp.NewDeliveryHandler(store),
		managementHandler:  jobshttp.NewManagementHandler(store),
		publicationHandler: jobshttp.NewPublicationHandler(store),
		requesterHandler:   jobshttp.NewRequesterHandler(store),
		queries:            queries,
		pool:               pool,
		readinessTimeout:   2 * time.Second,
		httpMetrics:        runtimemetrics.Default,
		readinessLogger:    slog.Default(),
		readinessMetrics:   runtimemetrics.Default,
	})

	server := httptest.NewServer(router)
	t.Cleanup(server.Close)
	return &draftFlowHarness{pool: pool, server: server, client: server.Client(), signer: signer}
}

// --- fixtures --------------------------------------------------------------

type draftFlowActor struct {
	userID uuid.UUID
	sub    string
	token  string
}

func (h *draftFlowHarness) actor(t *testing.T, userID uuid.UUID, sub string) draftFlowActor {
	t.Helper()
	return draftFlowActor{userID: userID, sub: sub, token: h.signer.validToken(t, sub)}
}

// draftFlowCompany owns one company plus its users; a single cleanup deletes
// every row the fixture created in FK-safe order.
type draftFlowCompany struct {
	pool      *pgxpool.Pool
	companyID uuid.UUID
	userIDs   []uuid.UUID
}

func draftFlowNewCompany(t *testing.T, pool *pgxpool.Pool, status string) *draftFlowCompany {
	t.Helper()
	c := &draftFlowCompany{pool: pool, companyID: draftFlowInsertCompany(t, pool, status)}
	t.Cleanup(c.cleanup)
	return c
}

func (c *draftFlowCompany) cleanup() {
	ctx := context.Background()
	_, _ = c.pool.Exec(ctx, `DELETE FROM audit_events WHERE entity_id IN (SELECT id FROM job_drafts WHERE company_id = $1)`, c.companyID)
	_, _ = c.pool.Exec(ctx, `DELETE FROM job_draft_idempotency WHERE company_id = $1`, c.companyID)
	_, _ = c.pool.Exec(ctx, `DELETE FROM job_drafts WHERE company_id = $1`, c.companyID)
	_, _ = c.pool.Exec(ctx, `DELETE FROM job_draft_requesters WHERE company_id = $1`, c.companyID)
	_, _ = c.pool.Exec(ctx, `DELETE FROM company_members WHERE company_id = $1`, c.companyID)
	_, _ = c.pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, c.companyID)
	for _, id := range c.userIDs {
		_, _ = c.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	}
}

func (c *draftFlowCompany) addUser(t *testing.T, role string) (uuid.UUID, string) {
	t.Helper()
	userID, sub := draftFlowInsertUser(t, c.pool)
	c.userIDs = append(c.userIDs, userID)
	draftFlowInsertMembership(t, c.pool, c.companyID, userID, role)
	return userID, sub
}

func draftFlowNewPrincipal(t *testing.T, pool *pgxpool.Pool, status string) (*draftFlowCompany, uuid.UUID, string) {
	t.Helper()
	c := draftFlowNewCompany(t, pool, status)
	ownerID, sub := c.addUser(t, "owner")
	return c, ownerID, sub
}

func draftFlowInsertCompany(t *testing.T, pool *pgxpool.Pool, status string) uuid.UUID {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO companies (id, name, rfc, industry_id, status)
		 VALUES ($1, $2, $3, 'technology', $4)`,
		id, "Draft Flow "+id.String(), strings.ToUpper(strings.ReplaceAll(id.String(), "-", "")), status,
	); err != nil {
		t.Fatalf("insert company: %v", err)
	}
	return id
}

func draftFlowInsertUser(t *testing.T, pool *pgxpool.Pool) (uuid.UUID, string) {
	t.Helper()
	id := uuid.Must(uuid.NewV7())
	sub := "draft-flow-" + id.String()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, 'recruiter')`,
		id, sub, sub+"@example.test", "Draft Flow",
	); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id, sub
}

func draftFlowInsertMembership(t *testing.T, pool *pgxpool.Pool, companyID, userID uuid.UUID, role string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO company_members (id, user_id, company_id, role)
		 VALUES ($1, $2, $3, $4)`,
		uuid.Must(uuid.NewV7()), userID, companyID, role,
	); err != nil {
		t.Fatalf("insert membership: %v", err)
	}
}

// --- HTTP ----------------------------------------------------------------

type draftFlowResponse struct {
	status int
	header http.Header
	body   []byte
}

// draftFlowCall is one goroutine outcome delivered over a channel, so
// concurrent callers never write to a shared slice.
type draftFlowCall struct {
	resp draftFlowResponse
	err  error
}

func (h *draftFlowHarness) roundTrip(method, path, body, token string, headers map[string]string) (draftFlowResponse, error) {
	req, err := http.NewRequest(method, h.server.URL+path, strings.NewReader(body))
	if err != nil {
		return draftFlowResponse{}, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return draftFlowResponse{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return draftFlowResponse{}, err
	}
	return draftFlowResponse{status: resp.StatusCode, header: resp.Header.Clone(), body: raw}, nil
}

func (h *draftFlowHarness) do(t *testing.T, method, path, body, token string, headers map[string]string) draftFlowResponse {
	t.Helper()
	resp, err := h.roundTrip(method, path, body, token, headers)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

// draftFlowCreate posts a draft and returns its id, ETag and exact response
// body. It fails the test on anything but 201.
func (h *draftFlowHarness) create(t *testing.T, actor draftFlowActor, key, body string) (string, string, []byte) {
	t.Helper()
	resp := h.do(t, http.MethodPost, draftFlowPath, body, actor.token, map[string]string{
		"Idempotency-Key": key,
		"Content-Type":    "application/json",
	})
	if resp.status != http.StatusCreated {
		t.Fatalf("create status = %d, want 201; body=%s", resp.status, resp.body)
	}
	env := draftFlowObject(t, resp.body)
	id, ok := env["id"].(string)
	if !ok {
		t.Fatalf("create envelope has no string id: %s", resp.body)
	}
	return id, resp.header.Get("ETag"), resp.body
}

// --- assertions ----------------------------------------------------------

func draftFlowObject(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode JSON object %q: %v", body, err)
	}
	return out
}

func draftFlowFields(t *testing.T, body []byte) map[string]any {
	t.Helper()
	fields, ok := draftFlowObject(t, body)["fields"].(map[string]any)
	if !ok {
		t.Fatalf("envelope.fields is not an object: %s", body)
	}
	return fields
}

func draftFlowCatalogCode(t *testing.T, body []byte) string {
	t.Helper()
	code, _ := draftFlowObject(t, body)["code"].(string)
	return code
}

func draftFlowAssertNoStore(t *testing.T, resp draftFlowResponse) {
	t.Helper()
	if got := resp.header.Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store; body=%s", got, resp.body)
	}
}

func draftFlowAssertError(t *testing.T, resp draftFlowResponse, wantStatus int, wantCode string) {
	t.Helper()
	draftFlowAssertCatalogError(t, resp, wantStatus, wantCode)
	draftFlowAssertNoStore(t, resp)
}

// draftFlowAssertCatalogError checks status + code without the private no-store
// expectation; legacy routes are not private draft routes.
func draftFlowAssertCatalogError(t *testing.T, resp draftFlowResponse, wantStatus int, wantCode string) {
	t.Helper()
	if resp.status != wantStatus {
		t.Fatalf("status = %d, want %d; body=%s", resp.status, wantStatus, resp.body)
	}
	if got := draftFlowCatalogCode(t, resp.body); got != wantCode {
		t.Fatalf("code = %q, want %q; body=%s", got, wantCode, resp.body)
	}
}

func draftFlowAssertVersion(t *testing.T, body []byte, want string) {
	t.Helper()
	if got, _ := draftFlowObject(t, body)["version"].(string); got != want {
		t.Fatalf("version = %q, want %q; body=%s", got, want, body)
	}
}

func draftFlowCount(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count (%s): %v", query, err)
	}
	return n
}

func draftFlowAuditCount(t *testing.T, pool *pgxpool.Pool, entityID uuid.UUID, eventType string) int {
	t.Helper()
	return draftFlowCount(t, pool,
		`SELECT count(*) FROM audit_events WHERE entity_id = $1 AND event_type = $2`,
		entityID, eventType)
}

func draftFlowDraftRow(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) (version int64, fields []byte, created, updated time.Time) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT version, fields, created_at, updated_at FROM job_drafts WHERE id = $1`, id,
	).Scan(&version, &fields, &created, &updated); err != nil {
		t.Fatalf("read draft row: %v", err)
	}
	return version, fields, created, updated
}

func draftFlowUUID(t *testing.T, id string) uuid.UUID {
	t.Helper()
	parsed, err := uuid.Parse(id)
	if err != nil {
		t.Fatalf("parse draft id %q: %v", id, err)
	}
	return parsed
}

// --- core create -> get -> save -> stale ----------------------------------

func TestDraftFlow_CreateGetSaveStaleConflictExactLevels(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)

	resp := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, actor.token, map[string]string{
		"Idempotency-Key": uuid.NewString(),
		"Content-Type":    "application/json",
	})
	if resp.status != http.StatusCreated {
		t.Fatalf("create status = %d, want 201; body=%s", resp.status, resp.body)
	}
	draftFlowAssertNoStore(t, resp)
	if got := resp.header.Get("Content-Type"); got != "application/json" {
		t.Fatalf("Content-Type = %q, want application/json", got)
	}
	if got := resp.header.Get("Idempotency-Replayed"); got != "false" {
		t.Fatalf("Idempotency-Replayed = %q, want false", got)
	}

	env := draftFlowObject(t, resp.body)
	id, _ := env["id"].(string)
	draftUUID := draftFlowUUID(t, id)
	wantV1 := `"jd-r1-` + id + `-v1"`
	if got := resp.header.Get("ETag"); got != wantV1 {
		t.Fatalf("create ETag = %q, want %q", got, wantV1)
	}
	if env["status"] != "draft" {
		t.Fatalf("status = %#v, want draft", env["status"])
	}
	if env["schema_version"] != float64(1) {
		t.Fatalf("schema_version = %#v, want 1", env["schema_version"])
	}
	if env["principal_recruiter_id"] != ownerID.String() {
		t.Fatalf("principal_recruiter_id = %#v, want %s", env["principal_recruiter_id"], ownerID)
	}
	draftFlowAssertVersion(t, resp.body, "1")

	fields := draftFlowFields(t, resp.body)
	if fields["title"] != "Backend Go" || fields["professional_area"] != "technology_systems" {
		t.Fatalf("submitted fields not echoed: %#v", fields)
	}
	comp, ok := fields["compensation"].(map[string]any)
	if !ok {
		t.Fatalf("compensation missing: %#v", fields["compensation"])
	}
	if comp["currency"] != "MXN" || comp["pay_period"] != "monthly" || comp["public_visible"] != false {
		t.Fatalf("compensation defaults wrong: %#v", comp)
	}
	for _, key := range []string{"mode", "amount", "min", "max", "basis"} {
		if comp[key] != nil {
			t.Fatalf("compensation.%s = %#v, want null", key, comp[key])
		}
	}
	if skills, ok := fields["skills"].([]any); !ok || len(skills) != 0 {
		t.Fatalf("skills default = %#v, want []", fields["skills"])
	}
	if fields["description_plain"] != nil {
		t.Fatalf("description_plain = %#v, want null", fields["description_plain"])
	}

	// GET reproduces the stored bytes and ETag byte-for-byte.
	get := h.do(t, http.MethodGet, draftFlowPath+"/"+id, "", actor.token, nil)
	if get.status != http.StatusOK {
		t.Fatalf("GET status = %d, want 200; body=%s", get.status, get.body)
	}
	draftFlowAssertNoStore(t, get)
	if got := get.header.Get("ETag"); got != wantV1 {
		t.Fatalf("GET ETag = %q, want %q", got, wantV1)
	}
	if !bytes.Equal(get.body, resp.body) {
		t.Fatalf("GET body differs from create body:\ncreate=%s\nget=%s", resp.body, get.body)
	}

	// PATCH compensation 30000..45000 -> v2 with exact two-decimal money.
	patch := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, draftFlowCompensation, actor.token, map[string]string{
		"If-Match":     wantV1,
		"Content-Type": "application/json",
	})
	if patch.status != http.StatusOK {
		t.Fatalf("PATCH status = %d, want 200; body=%s", patch.status, patch.body)
	}
	draftFlowAssertNoStore(t, patch)
	wantV2 := `"jd-r1-` + id + `-v2"`
	if got := patch.header.Get("ETag"); got != wantV2 {
		t.Fatalf("PATCH ETag = %q, want %q", got, wantV2)
	}
	draftFlowAssertVersion(t, patch.body, "2")
	patched := draftFlowFields(t, patch.body)["compensation"].(map[string]any)
	if patched["min"] != "30000.00" || patched["max"] != "45000.00" {
		t.Fatalf("compensation money not normalized to 2 decimals: %#v", patched)
	}
	if patched["mode"] != "range" || patched["amount"] != nil || patched["currency"] != "MXN" ||
		patched["pay_period"] != "monthly" || patched["basis"] != "gross" || patched["public_visible"] != false {
		t.Fatalf("compensation edit wrong: %#v", patched)
	}
	if got := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftSaved); got != 1 {
		t.Fatalf("JobDraftSaved audit rows = %d, want 1", got)
	}
	versionBefore, fieldsBefore, _, updatedBefore := draftFlowDraftRow(t, h.pool, draftUUID)
	savedBefore := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftSaved)

	// Stale v1 -> 412 with no data and no state/audit change.
	stale := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{"title":"Backend Rust"}}`, actor.token, map[string]string{
		"If-Match":     wantV1,
		"Content-Type": "application/json",
	})
	if stale.status != http.StatusPreconditionFailed {
		t.Fatalf("stale PATCH status = %d, want 412; body=%s", stale.status, stale.body)
	}
	if got := draftFlowCatalogCode(t, stale.body); got != "version_conflict" {
		t.Fatalf("stale code = %q, want version_conflict", got)
	}
	draftFlowAssertNoStore(t, stale)
	if _, hasData := draftFlowObject(t, stale.body)["data"]; hasData {
		t.Fatalf("412 must carry no data: %s", stale.body)
	}

	after := h.do(t, http.MethodGet, draftFlowPath+"/"+id, "", actor.token, nil)
	if after.status != http.StatusOK {
		t.Fatalf("GET after stale status = %d, want 200; body=%s", after.status, after.body)
	}
	if !bytes.Equal(after.body, patch.body) {
		t.Fatalf("stale 412 changed the draft:\nbefore=%s\nafter=%s", patch.body, after.body)
	}
	versionAfter, fieldsAfter, _, updatedAfter := draftFlowDraftRow(t, h.pool, draftUUID)
	if versionAfter != versionBefore || !bytes.Equal(fieldsAfter, fieldsBefore) || !updatedAfter.Equal(updatedBefore) {
		t.Fatalf("stale 412 changed persisted state: version %d->%d", versionBefore, versionAfter)
	}
	if got := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftSaved); got != savedBefore {
		t.Fatalf("stale 412 changed audit count: %d -> %d", savedBefore, got)
	}
}

// GET schema isolation is exercised through real HTTP/auth. SQL is used only
// to seed stored versions unavailable through v1 POST and snapshot side effects.
func TestDraftFlow_GetSchemaIsolation(t *testing.T) {
	h := newDraftFlowHarness(t)
	cases := []struct {
		name   string
		stored string // Empty means keep the canonical v1 bytes from POST.
		status int
		code   string
	}{
		{"schema1", "", http.StatusOK, ""},
		{"schema2", `{"schema_version":2,"fields":{}}`, http.StatusNotFound, "not_found"},
		{"schema2_before_requester_and_render", `{"schema_version":2,"fields":{"requester":{"kind":"client","id":"invalid"},"description":"invalid"}}`, http.StatusNotFound, "not_found"},
		{"missing_schema", `{"fields":{}}`, http.StatusInternalServerError, "internal_error"},
		{"unknown_schema", `{"schema_version":3,"fields":{}}`, http.StatusInternalServerError, "internal_error"},
		{"null_schema", `{"schema_version":null,"fields":{}}`, http.StatusInternalServerError, "internal_error"},
		{"string_schema", `{"schema_version":"1","fields":{}}`, http.StatusInternalServerError, "internal_error"},
		{"corrupt_json", `{"schema_version":`, http.StatusInternalServerError, "internal_error"},
		{"duplicate_schema", `{"schema_version":1,"schema_version":2,"fields":{}}`, http.StatusInternalServerError, "internal_error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, ownerID, sub)
			peerID, peerSub := company.addUser(t, "recruiter")
			_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
			id, etag, original := h.create(t, owner, uuid.NewString(), draftFlowMinimalCreate)
			if tc.stored != "" {
				if _, err := h.pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, []byte(tc.stored), id); err != nil {
					t.Fatalf("seed stored schema: %v", err)
				}
			}
			// Include complete rows (bytes, CAS, timestamps and frozen replay), not
			// just counts, to catch accidental replacement as well as insertion.
			snapshot := func() string {
				t.Helper()
				var state string
				err := h.pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
					'drafts', (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM job_drafts d WHERE company_id=$1),
					'idempotency', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM job_draft_idempotency i WHERE company_id=$1),
					'audit', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_events a WHERE entity_id=$2)
				)::text`, company.companyID, id).Scan(&state)
				if err != nil {
					t.Fatalf("snapshot draft state: %v", err)
				}
				return state
			}
			for _, caller := range []struct {
				name   string
				token  string
				status int
				code   string
			}{
				{"authorized", owner.token, tc.status, tc.code},
				{"non_principal", h.actor(t, peerID, peerSub).token, http.StatusNotFound, "not_found"},
				{"cross_company", h.actor(t, foreignID, foreignSub).token, http.StatusNotFound, "not_found"},
				{"unauthenticated", "", http.StatusUnauthorized, "unauthenticated"},
			} {
				t.Run(caller.name, func(t *testing.T) {
					before := snapshot()
					resp := h.do(t, http.MethodGet, draftFlowPath+"/"+id, "", caller.token, nil)
					if after := snapshot(); after != before {
						t.Errorf("GET mutated draft, audit or idempotency rows")
					}
					draftFlowAssertNoStore(t, resp)
					if resp.status != caller.status {
						t.Fatalf("status=%d want=%d body=%s", resp.status, caller.status, resp.body)
					}
					if caller.status == http.StatusOK {
						if !bytes.Equal(resp.body, original) || resp.header.Get("ETag") != etag {
							t.Fatalf("v1 GET body/ETag changed: %s", resp.body)
						}
						return
					}
					draftFlowAssertError(t, resp, caller.status, caller.code)
					if resp.header.Get("ETag") != "" {
						t.Errorf("rejected GET leaked ETag")
					}
					body := draftFlowObject(t, resp.body)
					message, ok := body["error"].(string)
					if len(body) != 2 || !ok || message == "" {
						t.Errorf("error must contain only error/code, no editor data: %s", resp.body)
					}
				})
			}
		})
	}
}

// --- idempotency replay ----------------------------------------------------

func TestDraftFlow_CreateReplayFrozenV1WhileGetShowsV2(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)

	key := uuid.NewString()
	id, originalETag, originalBody := h.create(t, actor, key, draftFlowMinimalCreate)
	draftUUID := draftFlowUUID(t, id)

	patch := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{"title":"Backend Rust"}}`, actor.token, map[string]string{
		"If-Match": originalETag,
	})
	if patch.status != http.StatusOK {
		t.Fatalf("PATCH status = %d, want 200; body=%s", patch.status, patch.body)
	}
	draftFlowAssertVersion(t, patch.body, "2")

	replay := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, actor.token, map[string]string{
		"Idempotency-Key": key,
	})
	if replay.status != http.StatusCreated {
		t.Fatalf("replay status = %d, want 201; body=%s", replay.status, replay.body)
	}
	draftFlowAssertNoStore(t, replay)
	if got := replay.header.Get("Idempotency-Replayed"); got != "true" {
		t.Fatalf("replay Idempotency-Replayed = %q, want true", got)
	}
	if got := replay.header.Get("ETag"); got != originalETag {
		t.Fatalf("replay ETag = %q, want the frozen %q", got, originalETag)
	}
	if !bytes.Equal(replay.body, originalBody) {
		t.Fatalf("replay body is not the frozen original:\noriginal=%s\nreplay=%s", originalBody, replay.body)
	}
	draftFlowAssertVersion(t, replay.body, "1")

	current := h.do(t, http.MethodGet, draftFlowPath+"/"+id, "", actor.token, nil)
	if current.status != http.StatusOK {
		t.Fatalf("current GET status = %d, want 200; body=%s", current.status, current.body)
	}
	draftFlowAssertVersion(t, current.body, "2")
	if got := current.header.Get("ETag"); got != `"jd-r1-`+id+`-v2"` {
		t.Fatalf("current GET ETag = %q, want v2", got)
	}

	if got := draftFlowCount(t, h.pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, h.companyIDOf(t, draftUUID)); got != 1 {
		t.Fatalf("replay created a second draft row: %d", got)
	}
	if got := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftCreated); got != 1 {
		t.Fatalf("replay re-audited creation: %d", got)
	}
}

// companyIDOf resolves a draft's company for row-scoped counts.
func (h *draftFlowHarness) companyIDOf(t *testing.T, draftID uuid.UUID) uuid.UUID {
	t.Helper()
	var companyID uuid.UUID
	if err := h.pool.QueryRow(context.Background(), `SELECT company_id FROM job_drafts WHERE id = $1`, draftID).Scan(&companyID); err != nil {
		t.Fatalf("read draft company: %v", err)
	}
	return companyID
}

func TestDraftFlow_CreateNormalizedPayloadReplays(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)

	key := uuid.NewString()
	first := `{"fields":{"title":"Backend Go","compensation":{"mode":"range","amount":null,"min":"30000.00","max":"45000","currency":"MXN","pay_period":"monthly","basis":"gross","public_visible":false}}}`
	second := `{"fields":{"compensation":{"public_visible":false,"basis":"gross","pay_period":"monthly","currency":"MXN","max":"45000.00","min":"30000","amount":null,"mode":"range"},"title":"Backend Go"}}`

	_, _, originalBody := h.create(t, actor, key, first)
	replay := h.do(t, http.MethodPost, draftFlowPath, second, actor.token, map[string]string{
		"Idempotency-Key": key,
	})
	if replay.status != http.StatusCreated {
		t.Fatalf("normalized replay status = %d, want 201; body=%s", replay.status, replay.body)
	}
	if got := replay.header.Get("Idempotency-Replayed"); got != "true" {
		t.Fatalf("normalized replay Idempotency-Replayed = %q, want true", got)
	}
	if !bytes.Equal(replay.body, originalBody) {
		t.Fatalf("normalized replay body differs:\noriginal=%s\nreplay=%s", originalBody, replay.body)
	}
}

// TestDraftFlow_IdempotencyKeyCanonicalizationReplays pins the T3 correction:
// alternative spellings of one UUID are one identity, not two drafts.
func TestDraftFlow_IdempotencyKeyCanonicalizationReplays(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)

	canonical := uuid.NewString()
	_, originalETag, originalBody := h.create(t, actor, strings.ToUpper(canonical), draftFlowMinimalCreate)

	hyphenless := strings.ReplaceAll(canonical, "-", "")
	replay := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, actor.token, map[string]string{
		"Idempotency-Key": hyphenless,
	})
	if replay.status != http.StatusCreated {
		t.Fatalf("canonical-key replay status = %d, want 201; body=%s", replay.status, replay.body)
	}
	if got := replay.header.Get("Idempotency-Replayed"); got != "true" {
		t.Fatalf("canonical-key replay Idempotency-Replayed = %q, want true", got)
	}
	if got := replay.header.Get("ETag"); got != originalETag {
		t.Fatalf("canonical-key replay ETag = %q, want %q", got, originalETag)
	}
	if !bytes.Equal(replay.body, originalBody) {
		t.Fatalf("canonical-key replay body differs from the original")
	}

	id := draftFlowUUID(t, draftFlowObject(t, originalBody)["id"].(string))
	companyID := h.companyIDOf(t, id)
	if got := draftFlowCount(t, h.pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, companyID); got != 1 {
		t.Fatalf("key spellings produced %d drafts, want 1", got)
	}
}

// --- concurrency -----------------------------------------------------------

func TestDraftFlow_ConcurrentCreateSameKeyOneRowOneAudit(t *testing.T) {
	h := newDraftFlowHarness(t)
	c, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)
	key := uuid.NewString()

	const callers = 2
	outcomes := make(chan draftFlowCall, callers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, err := h.roundTrip(http.MethodPost, draftFlowPath, draftFlowMinimalCreate, actor.token, map[string]string{
				"Idempotency-Key": key,
			})
			outcomes <- draftFlowCall{resp: resp, err: err}
		}()
	}
	close(start)
	wg.Wait()
	close(outcomes)

	replayed := 0
	var id uuid.UUID
	for call := range outcomes {
		if call.err != nil {
			t.Fatalf("concurrent create: %v", call.err)
		}
		resp := call.resp
		if resp.status != http.StatusCreated {
			t.Fatalf("concurrent create status = %d, want 201; body=%s", resp.status, resp.body)
		}
		draftFlowAssertNoStore(t, resp)
		if resp.header.Get("Idempotency-Replayed") == "true" {
			replayed++
		}
		got := draftFlowUUID(t, draftFlowObject(t, resp.body)["id"].(string))
		if id == uuid.Nil {
			id = got
		} else if got != id {
			t.Fatalf("concurrent creates returned different draft ids")
		}
	}
	if replayed != callers-1 {
		t.Fatalf("replayed callers = %d, want %d", replayed, callers-1)
	}

	if got := draftFlowCount(t, h.pool, `SELECT count(*) FROM job_drafts WHERE company_id = $1`, c.companyID); got != 1 {
		t.Fatalf("concurrent creates: draft rows = %d, want 1", got)
	}
	if got := draftFlowAuditCount(t, h.pool, id, entities.EventJobDraftCreated); got != 1 {
		t.Fatalf("concurrent creates: JobDraftCreated audit rows = %d, want 1", got)
	}
	if got := draftFlowCount(t, h.pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND idem_key = $3`,
		c.companyID, actor.userID, key); got != 1 {
		t.Fatalf("concurrent creates: idempotency rows = %d, want 1", got)
	}
}

func TestDraftFlow_ConcurrentSaveSameTagOne200One412(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)

	id, tagV1, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
	draftUUID := draftFlowUUID(t, id)
	body := `{"fields":{"title":"Backend Concurrent"}}`

	const callers = 2
	outcomes := make(chan draftFlowCall, callers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, err := h.roundTrip(http.MethodPatch, draftFlowPath+"/"+id, body, actor.token, map[string]string{
				"If-Match": tagV1,
			})
			outcomes <- draftFlowCall{resp: resp, err: err}
		}()
	}
	close(start)
	wg.Wait()
	close(outcomes)

	ok, conflicts := 0, 0
	for call := range outcomes {
		if call.err != nil {
			t.Fatalf("concurrent save: %v", call.err)
		}
		resp := call.resp
		switch resp.status {
		case http.StatusOK:
			ok++
			draftFlowAssertVersion(t, resp.body, "2")
			if got := resp.header.Get("ETag"); got != `"jd-r1-`+id+`-v2"` {
				t.Fatalf("winning save ETag = %q, want v2", got)
			}
		case http.StatusPreconditionFailed:
			conflicts++
			if got := draftFlowCatalogCode(t, resp.body); got != "version_conflict" {
				t.Fatalf("losing save code = %q, want version_conflict; body=%s", got, resp.body)
			}
			if _, hasData := draftFlowObject(t, resp.body)["data"]; hasData {
				t.Fatalf("412 must carry no data: %s", resp.body)
			}
		default:
			t.Fatalf("concurrent save status = %d, want 200 or 412; body=%s", resp.status, resp.body)
		}
		draftFlowAssertNoStore(t, resp)
	}
	if ok != 1 || conflicts != 1 {
		t.Fatalf("concurrent saves: 200=%d 412=%d, want one of each", ok, conflicts)
	}

	if version, _, _, _ := draftFlowDraftRow(t, h.pool, draftUUID); version != 2 {
		t.Fatalf("final version = %d, want 2", version)
	}
	if got := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftSaved); got != 1 {
		t.Fatalf("concurrent saves: JobDraftSaved audit rows = %d, want 1", got)
	}
}

// --- no-op -----------------------------------------------------------------

func TestDraftFlow_NoOpSaveKeepsVersionAndWritesNoAudit(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)

	id, tagV1, createBody := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
	draftUUID := draftFlowUUID(t, id)

	noop := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{"title":"Backend Go"}}`, actor.token, map[string]string{
		"If-Match": tagV1,
	})
	if noop.status != http.StatusOK {
		t.Fatalf("no-op status = %d, want 200; body=%s", noop.status, noop.body)
	}
	draftFlowAssertNoStore(t, noop)
	if got := noop.header.Get("ETag"); got != tagV1 {
		t.Fatalf("no-op ETag = %q, want unchanged %q", got, tagV1)
	}
	if !bytes.Equal(noop.body, createBody) {
		t.Fatalf("no-op changed the envelope:\ncreate=%s\nnoop=%s", createBody, noop.body)
	}

	if version, _, _, _ := draftFlowDraftRow(t, h.pool, draftUUID); version != 1 {
		t.Fatalf("no-op version = %d, want 1", version)
	}
	if got := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftSaved); got != 0 {
		t.Fatalf("no-op wrote %d JobDraftSaved rows, want 0", got)
	}
}

// --- legacy routes ---------------------------------------------------------

func TestDraftFlow_LegacyRoutesCannotFindDraftID(t *testing.T) {
	h := newDraftFlowHarness(t)
	_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	actor := h.actor(t, ownerID, sub)

	id, _, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
	draftUUID := draftFlowUUID(t, id)

	versionBefore, fieldsBefore, createdBefore, updatedBefore := draftFlowDraftRow(t, h.pool, draftUUID)
	companyID := h.companyIDOf(t, draftUUID)
	createdAuditBefore := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftCreated)
	idempotencyBefore := draftFlowCount(t, h.pool, `SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1`, companyID)
	ifMatch := time.Now().UTC().Format(time.RFC3339)

	// Legacy public GET /jobs/{id} must not find a draft id.
	get := h.do(t, http.MethodGet, "/jobs/"+id, "", "", nil)
	draftFlowAssertCatalogError(t, get, http.StatusNotFound, "not_found")

	// Legacy PATCH /jobs/{id}: real auth + real recruiter gate + valid body.
	patch := h.do(t, http.MethodPatch, "/jobs/"+id, `{"title":"Legacy Updated"}`, actor.token, map[string]string{
		"If-Unmodified-Since": ifMatch,
		"Content-Type":        "application/json",
	})
	draftFlowAssertCatalogError(t, patch, http.StatusNotFound, "not_found")

	// Legacy DELETE /jobs/{id}.
	del := h.do(t, http.MethodDelete, "/jobs/"+id, "", actor.token, map[string]string{
		"If-Unmodified-Since": ifMatch,
	})
	draftFlowAssertCatalogError(t, del, http.StatusNotFound, "not_found")

	versionAfter, fieldsAfter, createdAfter, updatedAfter := draftFlowDraftRow(t, h.pool, draftUUID)
	if versionAfter != versionBefore || !bytes.Equal(fieldsAfter, fieldsBefore) ||
		!createdAfter.Equal(createdBefore) || !updatedAfter.Equal(updatedBefore) {
		t.Fatalf("legacy routes mutated the draft: version %d->%d", versionBefore, versionAfter)
	}
	if got := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftCreated); got != createdAuditBefore {
		t.Fatalf("legacy routes changed create audit: %d -> %d", createdAuditBefore, got)
	}
	if got := draftFlowCount(t, h.pool, `SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1`, companyID); got != idempotencyBefore {
		t.Fatalf("legacy routes changed idempotency rows: %d -> %d", idempotencyBefore, got)
	}
}

// --- error catalogue / no-store on every private failure -------------------

func TestDraftFlow_PrivateErrorsCarryNoStore(t *testing.T) {
	h := newDraftFlowHarness(t)

	t.Run("401 missing token", func(t *testing.T) {
		resp := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, "", map[string]string{
			"Idempotency-Key": uuid.NewString(),
		})
		draftFlowAssertError(t, resp, http.StatusUnauthorized, "unauthenticated")
	})

	t.Run("401 expired token", func(t *testing.T) {
		_, _, sub := draftFlowNewPrincipal(t, h.pool, "active")
		resp := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, h.signer.expiredToken(t, sub), map[string]string{
			"Idempotency-Key": uuid.NewString(),
		})
		draftFlowAssertError(t, resp, http.StatusUnauthorized, "unauthenticated")
	})

	t.Run("400 idempotency_key_required", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		resp := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, h.actor(t, ownerID, sub).token, nil)
		draftFlowAssertError(t, resp, http.StatusBadRequest, "idempotency_key_required")
	})

	t.Run("400 invalid_idempotency_key", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		resp := h.do(t, http.MethodPost, draftFlowPath, draftFlowMinimalCreate, h.actor(t, ownerID, sub).token, map[string]string{
			"Idempotency-Key": "not-a-uuid",
		})
		draftFlowAssertError(t, resp, http.StatusBadRequest, "invalid_idempotency_key")
	})

	t.Run("413 payload_too_large", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		resp := h.do(t, http.MethodPost, draftFlowPath, strings.Repeat(" ", 1048577), h.actor(t, ownerID, sub).token, map[string]string{
			"Idempotency-Key": uuid.NewString(),
		})
		draftFlowAssertError(t, resp, http.StatusRequestEntityTooLarge, "payload_too_large")
	})

	t.Run("428 precondition_required", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		id, _, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
		resp := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{"title":"x"}}`, actor.token, nil)
		draftFlowAssertError(t, resp, http.StatusPreconditionRequired, "precondition_required")
	})

	t.Run("400 invalid if-match", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		id, _, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
		resp := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{"title":"x"}}`, actor.token, map[string]string{
			"If-Match": `W/"weak"`,
		})
		draftFlowAssertError(t, resp, http.StatusBadRequest, "invalid_request")
	})

	t.Run("400 empty_patch", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		id, tag, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
		resp := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{}}`, actor.token, map[string]string{
			"If-Match": tag,
		})
		draftFlowAssertError(t, resp, http.StatusBadRequest, "empty_patch")
	})

	t.Run("404 unknown draft", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		resp := h.do(t, http.MethodGet, draftFlowPath+"/"+uuid.NewString(), "", h.actor(t, ownerID, sub).token, nil)
		draftFlowAssertError(t, resp, http.StatusNotFound, "not_found")
	})

	t.Run("409 idempotency_conflict", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		key := uuid.NewString()
		h.create(t, actor, key, draftFlowMinimalCreate)
		resp := h.do(t, http.MethodPost, draftFlowPath, `{"fields":{"title":"Different"}}`, actor.token, map[string]string{
			"Idempotency-Key": key,
		})
		draftFlowAssertError(t, resp, http.StatusConflict, "idempotency_conflict")
	})

	t.Run("412 stale", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		id, _, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
		resp := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{"title":"x"}}`, actor.token, map[string]string{
			"If-Match": `"jd-r1-` + id + `-v99"`,
		})
		draftFlowAssertError(t, resp, http.StatusPreconditionFailed, "version_conflict")
	})

	t.Run("403 membership removed", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		id, _, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)
		if _, err := h.pool.Exec(context.Background(), `DELETE FROM company_members WHERE user_id = $1`, ownerID); err != nil {
			t.Fatalf("remove membership: %v", err)
		}
		resp := h.do(t, http.MethodGet, draftFlowPath+"/"+id, "", actor.token, nil)
		draftFlowAssertError(t, resp, http.StatusForbidden, "forbidden")
	})

	t.Run("403 company tombstoned", func(t *testing.T) {
		c, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		if _, err := h.pool.Exec(context.Background(), `UPDATE companies SET deleted_at = now() WHERE id = $1`, c.companyID); err != nil {
			t.Fatalf("tombstone company: %v", err)
		}
		resp := h.do(t, http.MethodGet, draftFlowPath+"/"+uuid.NewString(), "", h.actor(t, ownerID, sub).token, nil)
		draftFlowAssertError(t, resp, http.StatusForbidden, "company_inactive")
	})

	t.Run("409 company not active", func(t *testing.T) {
		c, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		if _, err := h.pool.Exec(context.Background(), `UPDATE companies SET status = 'suspended' WHERE id = $1`, c.companyID); err != nil {
			t.Fatalf("suspend company: %v", err)
		}
		resp := h.do(t, http.MethodGet, draftFlowPath+"/"+uuid.NewString(), "", h.actor(t, ownerID, sub).token, nil)
		draftFlowAssertError(t, resp, http.StatusConflict, "company_not_active")
	})

	t.Run("404 cross-org", func(t *testing.T) {
		_, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		id, _, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)

		_, otherOwnerID, otherSub := draftFlowNewPrincipal(t, h.pool, "active")
		resp := h.do(t, http.MethodGet, draftFlowPath+"/"+id, "", h.actor(t, otherOwnerID, otherSub).token, nil)
		draftFlowAssertError(t, resp, http.StatusNotFound, "not_found")
	})

	t.Run("404 non-principal", func(t *testing.T) {
		c, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		actor := h.actor(t, ownerID, sub)
		id, _, _ := h.create(t, actor, uuid.NewString(), draftFlowMinimalCreate)

		recruiterID, recruiterSub := c.addUser(t, "recruiter")
		resp := h.do(t, http.MethodGet, draftFlowPath+"/"+id, "", h.actor(t, recruiterID, recruiterSub).token, nil)
		draftFlowAssertError(t, resp, http.StatusNotFound, "not_found")
	})
}

// --- PATCH schema isolation ------------------------------------------------

// PATCH schema isolation is exercised through real HTTP/auth. SQL is used only
// to seed stored schema versions unavailable through v1 POST. The matrix pins
// the store order auth -> schema -> If-Match -> body: a known foreign schema is
// hidden before the precondition or the body is ever parsed, a corrupt or
// unknown marker fails closed, and every rejected request leaves the complete
// draft, audit and idempotency state untouched. The schema1 rows keep the
// existing v1 change/no-op behavior as a regression guard.
func TestDraftFlow_PatchSchemaIsolation(t *testing.T) {
	h := newDraftFlowHarness(t)

	type patchCase struct {
		name           string
		stored         string // Empty keeps the canonical v1 bytes from POST.
		ifMatch        string // valid | missing | malformed | stale | list
		body           string
		wantStatus     int
		wantCode       string
		wantVersion    string
		wantSavedAudit int
		wantMutation   bool
	}

	validBody := `{"fields":{"title":"Backend Rust"}}`
	schema2 := `{"schema_version":2,"fields":{}}`
	cases := []patchCase{
		{name: "schema1_valid_change", ifMatch: "valid", body: validBody, wantStatus: http.StatusOK, wantVersion: "2", wantSavedAudit: 1, wantMutation: true},
		{name: "schema1_no_op", ifMatch: "valid", body: `{"fields":{"title":"Backend Go"}}`, wantStatus: http.StatusOK, wantVersion: "1", wantSavedAudit: 0},
		{name: "schema2_missing_if_match", stored: schema2, ifMatch: "missing", body: validBody, wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "schema2_malformed_if_match", stored: schema2, ifMatch: "malformed", body: validBody, wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "schema2_stale_if_match", stored: schema2, ifMatch: "stale", body: validBody, wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "schema2_list_if_match", stored: schema2, ifMatch: "list", body: validBody, wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "schema2_malformed_body", stored: schema2, ifMatch: "valid", body: `{"fields":{"title":}`, wantStatus: http.StatusNotFound, wantCode: "not_found"},
		{name: "missing_schema_missing_if_match", stored: `{"fields":{}}`, ifMatch: "missing", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
		{name: "missing_schema_valid_if_match", stored: `{"fields":{}}`, ifMatch: "valid", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
		{name: "unknown_schema_missing_if_match", stored: `{"schema_version":3,"fields":{}}`, ifMatch: "missing", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
		{name: "null_schema_missing_if_match", stored: `{"schema_version":null,"fields":{}}`, ifMatch: "missing", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
		{name: "string_schema_missing_if_match", stored: `{"schema_version":"1","fields":{}}`, ifMatch: "missing", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
		{name: "duplicate_schema_missing_if_match", stored: `{"schema_version":1,"schema_version":2,"fields":{}}`, ifMatch: "missing", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
		{name: "corrupt_schema_missing_if_match", stored: `{"schema_version":`, ifMatch: "missing", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
		{name: "corrupt_schema_valid_if_match", stored: `{"schema_version":`, ifMatch: "valid", body: validBody, wantStatus: http.StatusInternalServerError, wantCode: "internal_error"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, ownerID, sub)
			peerID, peerSub := company.addUser(t, "recruiter")
			_, foreignID, foreignSub := draftFlowNewPrincipal(t, h.pool, "active")
			id, etag, createBody := h.create(t, owner, uuid.NewString(), draftFlowMinimalCreate)
			draftUUID := draftFlowUUID(t, id)
			if tc.stored != "" {
				if _, err := h.pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, []byte(tc.stored), id); err != nil {
					t.Fatalf("seed stored schema: %v", err)
				}
			}

			// Include complete rows (bytes, CAS, timestamps and frozen replay), not
			// just counts, to catch accidental replacement as well as insertion.
			snapshot := func() string {
				t.Helper()
				var state string
				err := h.pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
					'drafts', (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM job_drafts d WHERE company_id=$1),
					'idempotency', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM job_draft_idempotency i WHERE company_id=$1),
					'audit', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_events a WHERE entity_id=$2)
				)::text`, company.companyID, draftUUID).Scan(&state)
				if err != nil {
					t.Fatalf("snapshot draft state: %v", err)
				}
				return state
			}

			headers := map[string]string{"Content-Type": "application/json"}
			switch tc.ifMatch {
			case "valid":
				headers["If-Match"] = etag
			case "missing":
				// no header
			case "malformed":
				headers["If-Match"] = `W/"weak"`
			case "stale":
				headers["If-Match"] = `"jd-r1-` + id + `-v999"`
			case "list":
				headers["If-Match"] = etag + `,"jd-r1-` + id + `-v999"`
			default:
				t.Fatalf("unknown ifMatch kind %q", tc.ifMatch)
			}

			callers := []struct {
				name   string
				token  string
				status int
				code   string
			}{
				{"authorized", owner.token, tc.wantStatus, tc.wantCode},
				{"non_principal", h.actor(t, peerID, peerSub).token, http.StatusNotFound, "not_found"},
				{"cross_company", h.actor(t, foreignID, foreignSub).token, http.StatusNotFound, "not_found"},
				{"unauthenticated", "", http.StatusUnauthorized, "unauthenticated"},
			}
			for _, caller := range callers {
				caller := caller
				t.Run(caller.name, func(t *testing.T) {
					before := snapshot()
					resp := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, tc.body, caller.token, headers)
					after := snapshot()
					draftFlowAssertNoStore(t, resp)

					if resp.status == http.StatusOK {
						if tc.wantStatus != http.StatusOK {
							t.Fatalf("status = %d, want %d; body=%s", resp.status, tc.wantStatus, resp.body)
						}
						if caller.name != "authorized" {
							t.Fatalf("non-owner caller unexpectedly saved: %s", resp.body)
						}
						if !tc.wantMutation {
							if after != before {
								t.Errorf("no-op PATCH mutated draft, audit or idempotency rows")
							}
							if !bytes.Equal(resp.body, createBody) {
								t.Fatalf("no-op changed the envelope:\ncreate=%s\nnoop=%s", createBody, resp.body)
							}
						}
						wantETag := `"jd-r1-` + id + `-v` + tc.wantVersion + `"`
						if got := resp.header.Get("ETag"); got != wantETag {
							t.Fatalf("ETag = %q, want %q", got, wantETag)
						}
						draftFlowAssertVersion(t, resp.body, tc.wantVersion)
						if got := draftFlowAuditCount(t, h.pool, draftUUID, entities.EventJobDraftSaved); got != tc.wantSavedAudit {
							t.Fatalf("JobDraftSaved rows = %d, want %d", got, tc.wantSavedAudit)
						}
						return
					}

					if after != before {
						t.Errorf("rejected PATCH mutated draft, audit or idempotency rows")
					}
					draftFlowAssertError(t, resp, caller.status, caller.code)
					if resp.header.Get("ETag") != "" {
						t.Errorf("rejected PATCH leaked ETag")
					}
					body := draftFlowObject(t, resp.body)
					message, ok := body["error"].(string)
					if len(body) != 2 || !ok || message == "" {
						t.Errorf("error must contain only error/code, no editor data: %s", resp.body)
					}
				})
			}
		})
	}
}

// --- replay schema isolation (U1b2) ----------------------------------------
//
// POST replay current-row isolation is exercised through real HTTP/auth. SQL is
// used only to seed stored schema versions unavailable through v1 POST and to
// snapshot side effects. The addressed draft row must be gated on its
// schema_version AFTER authorization but BEFORE the persisted fingerprint and
// replay decision, so a known foreign schema hides the draft (404) while a
// missing/unknown/corrupt marker fails closed (500) even when the request would
// otherwise replay or conflict. Every rejected request leaves the complete
// draft, audit and idempotency state untouched, the frozen replay bytes and ETag
// stay byte-exact, and the row's independent CAS version keeps advancing.

// draftFlowSeedDraftFields overwrites a draft row's canonical bytes directly.
// It never bumps the row CAS version, so a seeded marker stands in for a row
// written by a future v2 writer at the same version.
func draftFlowSeedDraftFields(t *testing.T, h *draftFlowHarness, id, stored string) {
	t.Helper()
	if _, err := h.pool.Exec(context.Background(), `UPDATE job_drafts SET fields=$1 WHERE id=$2`, []byte(stored), id); err != nil {
		t.Fatalf("seed stored fields: %v", err)
	}
}

// draftFlowReplaySnapshot captures the complete draft, idempotency and audit
// rows (bytes, CAS, timestamps and frozen replay), not just counts, so a
// rejected replay that replaces or inserts rows is caught as well as one that
// merely counts wrong.
func draftFlowReplaySnapshot(t *testing.T, h *draftFlowHarness, companyID uuid.UUID, id string) string {
	t.Helper()
	var state string
	err := h.pool.QueryRow(context.Background(), `SELECT jsonb_build_object(
		'drafts', (SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM job_drafts d WHERE company_id=$1),
		'idempotency', (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM job_draft_idempotency i WHERE company_id=$1),
		'audit', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM audit_events a WHERE entity_id=$2)
	)::text`, companyID, id).Scan(&state)
	if err != nil {
		t.Fatalf("snapshot replay state: %v", err)
	}
	return state
}

// draftFlowReplayPOST issues one POST replay and asserts its exact outcome.
func draftFlowReplayPOST(t *testing.T, h *draftFlowHarness, token, key, body string, wantStatus int, wantCode string) draftFlowResponse {
	t.Helper()
	resp := h.do(t, http.MethodPost, draftFlowPath, body, token, map[string]string{
		"Idempotency-Key": key,
		"Content-Type":    "application/json",
	})
	if resp.status != wantStatus {
		t.Fatalf("replay status = %d, want %d; body=%s", resp.status, wantStatus, resp.body)
	}
	if wantStatus != http.StatusCreated {
		draftFlowAssertError(t, resp, wantStatus, wantCode)
		if resp.header.Get("ETag") != "" {
			t.Errorf("rejected replay leaked ETag")
		}
		respBody := draftFlowObject(t, resp.body)
		message, ok := respBody["error"].(string)
		if len(respBody) != 2 || !ok || message == "" {
			t.Errorf("error must contain only error/code, no editor data: %s", resp.body)
		}
		return resp
	}
	draftFlowAssertNoStore(t, resp)
	return resp
}

// draftFlowAssertFrozenReplay asserts a 201 replay returns the stored frozen
// bytes and ETag exactly, tagged as a replay.
func draftFlowAssertFrozenReplay(t *testing.T, resp draftFlowResponse, originalBody []byte, originalETag string) {
	t.Helper()
	if got := resp.header.Get("Idempotency-Replayed"); got != "true" {
		t.Fatalf("replay Idempotency-Replayed = %q, want true", got)
	}
	if got := resp.header.Get("ETag"); got != originalETag {
		t.Fatalf("replay ETag = %q, want the frozen %q", got, originalETag)
	}
	if !bytes.Equal(resp.body, originalBody) {
		t.Fatalf("replay body is not the frozen original:\noriginal=%s\nreplay=%s", originalBody, resp.body)
	}
}

// TestDraftFlow_ReplayUnknownSchemaFailsClosedBeforeConflict pins the current-row
// gate ordering: an unknown stored schema on the addressed draft returns 500
// internal_error before the changed fingerprint could return 409, and a replay
// of the original payload returns the frozen bytes/ETag unchanged once the row
// is back to schema 1.
func TestDraftFlow_ReplayUnknownSchemaFailsClosedBeforeConflict(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)

	key := uuid.NewString()
	id, originalETag, originalBody := h.create(t, owner, key, draftFlowMinimalCreate)
	draftUUID := draftFlowUUID(t, id)

	// A concurrent save advances the row CAS to v2 while its schema stays v1.
	patch := h.do(t, http.MethodPatch, draftFlowPath+"/"+id, `{"fields":{"title":"Backend Rust"}}`, owner.token, map[string]string{
		"If-Match": originalETag,
	})
	if patch.status != http.StatusOK {
		t.Fatalf("PATCH status = %d, want 200; body=%s", patch.status, patch.body)
	}
	draftFlowAssertVersion(t, patch.body, "2")
	// The stored column is the canonical writable envelope, never the read
	// envelope the API returns, so capture the real canonical bytes to restore.
	_, canonicalV2, _, _ := draftFlowDraftRow(t, h.pool, draftUUID)

	draftFlowSeedDraftFields(t, h, id, `{"schema_version":3,"fields":{}}`)
	before := draftFlowReplaySnapshot(t, h, company.companyID, id)
	// A changed payload with the same key would be a 409 conflict; the unknown
	// current-row marker must win with 500 and mutate nothing.
	draftFlowReplayPOST(t, h, owner.token, key, `{"fields":{"title":"Backend Rust Changed"}}`, http.StatusInternalServerError, "internal_error")
	if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != before {
		t.Errorf("rejected replay mutated draft, audit or idempotency rows")
	}

	// Restore the captured canonical bytes: the v1 frozen replay must return the
	// original stored response/ETag byte-exact with no mutation of its own, even
	// though the current row CAS is ahead of the replayed ETag.
	draftFlowSeedDraftFields(t, h, id, string(canonicalV2))
	restored := draftFlowReplaySnapshot(t, h, company.companyID, id)
	replay := draftFlowReplayPOST(t, h, owner.token, key, draftFlowMinimalCreate, http.StatusCreated, "")
	draftFlowAssertFrozenReplay(t, replay, originalBody, originalETag)
	draftFlowAssertVersion(t, replay.body, "1")
	if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != restored {
		t.Errorf("successful replay mutated draft, audit or idempotency rows")
	}
	if got := draftFlowCount(t, h.pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND idem_key = $3`,
		company.companyID, owner.userID, key); got != 1 {
		t.Fatalf("replay isolation left %d idempotency rows, want 1", got)
	}
	if version, _, _, _ := draftFlowDraftRow(t, h.pool, draftUUID); version != 2 {
		t.Fatalf("current row version = %d, want the independent CAS 2", version)
	}
}

// TestDraftFlow_ReplayCorruptSchemaMarkersFailClosed pins the corrupt/unknown
// marker matrix on the addressed draft: each must return 500 internal_error with
// no mutation, for BOTH a would-be replay (same payload) and a would-be conflict
// (changed fingerprint), because the current-row gate runs before the persisted
// fingerprint is ever compared.
func TestDraftFlow_ReplayCorruptSchemaMarkersFailClosed(t *testing.T) {
	h := newDraftFlowHarness(t)

	cases := []struct {
		name   string
		stored string
	}{
		{"missing_schema", `{"fields":{}}`},
		{"unknown_schema", `{"schema_version":3,"fields":{}}`},
		{"null_schema", `{"schema_version":null,"fields":{}}`},
		{"string_schema", `{"schema_version":"1","fields":{}}`},
		{"duplicate_schema", `{"schema_version":1,"schema_version":2,"fields":{}}`},
		{"corrupt_json", `{"schema_version":`},
	}
	payloads := []struct {
		name string
		body string
	}{
		{"same_payload", draftFlowMinimalCreate},
		{"changed_fingerprint", `{"fields":{"title":"Backend Rust Changed"}}`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			for _, pl := range payloads {
				pl := pl
				t.Run(pl.name, func(t *testing.T) {
					company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
					owner := h.actor(t, ownerID, sub)
					key := uuid.NewString()
					id, _, _ := h.create(t, owner, key, draftFlowMinimalCreate)
					draftFlowSeedDraftFields(t, h, id, tc.stored)
					before := draftFlowReplaySnapshot(t, h, company.companyID, id)
					draftFlowReplayPOST(t, h, owner.token, key, pl.body, http.StatusInternalServerError, "internal_error")
					if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != before {
						t.Errorf("rejected replay mutated draft, audit or idempotency rows")
					}
					if got := draftFlowCount(t, h.pool,
						`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND idem_key = $3`,
						company.companyID, owner.userID, key); got != 1 {
						t.Fatalf("rejected replay changed idempotency rows: %d, want 1", got)
					}
				})
			}
		})
	}
}

// TestDraftFlow_ReplayKnownForeignSchemaHidesDraft pins known-schema-2 on the
// addressed draft through real HTTP: the draft is hidden (404 not_found) for
// both a would-be replay (same payload) and a would-be conflict (changed
// fingerprint), with the complete draft/audit/idempotency state untouched and
// no ETag or editor data on the response.
func TestDraftFlow_ReplayKnownForeignSchemaHidesDraft(t *testing.T) {
	h := newDraftFlowHarness(t)

	payloads := []struct {
		name string
		body string
	}{
		{"same_payload", draftFlowMinimalCreate},
		{"changed_fingerprint", `{"fields":{"title":"Backend Rust Changed"}}`},
	}
	for _, pl := range payloads {
		pl := pl
		t.Run(pl.name, func(t *testing.T) {
			company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, ownerID, sub)
			key := uuid.NewString()
			id, _, _ := h.create(t, owner, key, draftFlowMinimalCreate)
			draftFlowSeedDraftFields(t, h, id, `{"schema_version":2,"fields":{}}`)
			before := draftFlowReplaySnapshot(t, h, company.companyID, id)
			draftFlowReplayPOST(t, h, owner.token, key, pl.body, http.StatusNotFound, "not_found")
			if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != before {
				t.Errorf("hidden replay mutated draft, audit or idempotency rows")
			}
			if got := draftFlowCount(t, h.pool,
				`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND idem_key = $3`,
				company.companyID, owner.userID, key); got != 1 {
				t.Fatalf("hidden replay changed idempotency rows: %d, want 1", got)
			}
		})
	}
}

// TestDraftFlow_ReplayBaselinePrecedence preserves the existing create order: a
// schema1 changed payload is still a 409 conflict with no writes, and a body
// that fails draftinput.DecodeCreate is still a 400 invalid_request BEFORE the
// existing idempotency row (and therefore the current-row replay gate) is ever
// consulted — proven by pinning the malformed body against a corrupt row that
// would otherwise be a 500.
func TestDraftFlow_ReplayBaselinePrecedence(t *testing.T) {
	h := newDraftFlowHarness(t)

	t.Run("schema1_changed_payload_conflicts_without_writes", func(t *testing.T) {
		company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		owner := h.actor(t, ownerID, sub)
		key := uuid.NewString()
		id, _, _ := h.create(t, owner, key, draftFlowMinimalCreate)
		before := draftFlowReplaySnapshot(t, h, company.companyID, id)
		draftFlowReplayPOST(t, h, owner.token, key, `{"fields":{"title":"Backend Rust Changed"}}`, http.StatusConflict, "idempotency_conflict")
		if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != before {
			t.Errorf("conflicting replay mutated draft, audit or idempotency rows")
		}
	})

	t.Run("malformed_body_precedes_corrupt_row_gate", func(t *testing.T) {
		company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
		owner := h.actor(t, ownerID, sub)
		key := uuid.NewString()
		id, _, _ := h.create(t, owner, key, draftFlowMinimalCreate)
		// The corrupt marker would be a 500 if the replay row gate ran first; the
		// body decode failing first must keep the answer 400 invalid_request.
		draftFlowSeedDraftFields(t, h, id, `{"schema_version":3,"fields":{}}`)
		before := draftFlowReplaySnapshot(t, h, company.companyID, id)
		draftFlowReplayPOST(t, h, owner.token, key, `{"fields":{"title":}`, http.StatusBadRequest, "invalid_request")
		if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != before {
			t.Errorf("rejected malformed replay mutated draft, audit or idempotency rows")
		}
	})
}

// TestDraftFlow_ReplayAuthorizationPrecedesCurrentRowGate reproduces the
// authorized-then-lost-ownership sequence that actually reaches the idempotency
// row: the key is scoped to the original actor, so a different actor would
// attempt a fresh create instead. The original actor keeps the key and the
// membership but is demoted to a non-owner role while the addressed draft's
// principal is transferred to a same-company peer. The addressed draft is also
// seeded with a corrupt schema marker, so a 404 (not 500) proves the
// resource-authorization gate runs BEFORE the current-row schema gate. The
// adapter never demotes a member or reassigns principal_recruiter_id itself; the
// seed stands in for those future ownership transfers, which are exactly the
// concern the addressed-draft check exists for.
func TestDraftFlow_ReplayAuthorizationPrecedesCurrentRowGate(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, sub)

	key := uuid.NewString()
	id, _, _ := h.create(t, owner, key, draftFlowMinimalCreate)
	// The actor keeps the key and its membership but is no longer the owner and
	// no longer the addressed draft's principal, while remaining in the company.
	peerID, _ := company.addUser(t, "recruiter")
	if _, err := h.pool.Exec(context.Background(), `UPDATE company_members SET role = 'recruiter' WHERE user_id = $1 AND company_id = $2`, ownerID, company.companyID); err != nil {
		t.Fatalf("demote owner to non-owner role: %v", err)
	}
	if _, err := h.pool.Exec(context.Background(), `UPDATE job_drafts SET principal_recruiter_id=$1 WHERE id=$2`, peerID, id); err != nil {
		t.Fatalf("transfer draft principal: %v", err)
	}
	// A corrupt current-row marker would be a 500 once the schema gate runs; the
	// expected 404 therefore pins authorization ahead of that gate.
	draftFlowSeedDraftFields(t, h, id, `{"schema_version":3,"fields":{}}`)

	before := draftFlowReplaySnapshot(t, h, company.companyID, id)
	// Same actor and key, so this hits the existing idempotency row and the
	// resource-authorization gate, not a fresh create: 404, never 409 or 500.
	draftFlowReplayPOST(t, h, owner.token, key, `{"fields":{"title":"Backend Rust Changed"}}`, http.StatusNotFound, "not_found")
	if after := draftFlowReplaySnapshot(t, h, company.companyID, id); after != before {
		t.Errorf("unauthorized replay mutated draft, audit or idempotency rows")
	}
	if got := draftFlowCount(t, h.pool,
		`SELECT count(*) FROM job_draft_idempotency WHERE company_id = $1 AND actor_id = $2 AND idem_key = $3`,
		company.companyID, owner.userID, key); got != 1 {
		t.Fatalf("unauthorized replay created %d idempotency rows, want 1", got)
	}
	if version, _, _, _ := draftFlowDraftRow(t, h.pool, draftFlowUUID(t, id)); version != 1 {
		t.Fatalf("unauthorized replay changed the row version: %d, want 1", version)
	}
}
