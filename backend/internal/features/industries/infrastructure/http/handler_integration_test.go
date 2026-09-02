//go:build integration

// Live-Postgres evidence for the WS3B industries contract (task 3.2) via
// the real sqlc query path and the shared production route registrar:
// inactive exclusion, sort_order-ASC/id-ASC ordering (tied sort case),
// shared 500 internal_error envelope on DB failure, and endpoint smoke
// with an Authorization header. Skips without DATABASE_URL.
package http

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func skipIfNoDatabaseForIndustries(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("cannot connect to Postgres: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skipf("cannot ping Postgres: %v", err)
	}
	return pool
}

// ws3bIndustry is a live seed row; label_es/label_en are seeded from the
// id (only ids and key sets are asserted). The ws3b_ ID prefix keeps
// fixture cleanup unambiguous even on a shared developer database.
type ws3bIndustry struct {
	id        string
	sortOrder int32
	active    bool
}

func seedWS3BIndustries(t *testing.T, pool *pgxpool.Pool, rows []ws3bIndustry) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, row := range rows {
		if _, err := pool.Exec(ctx,
			`INSERT INTO industries (id, label_es, label_en, sort_order, active)
			 VALUES ($1, $1, $1, $2, $3) ON CONFLICT (id) DO UPDATE
			 SET label_es = EXCLUDED.label_es, label_en = EXCLUDED.label_en,
			     sort_order = EXCLUDED.sort_order, active = EXCLUDED.active`,
			row.id, row.sortOrder, row.active); err != nil {
			t.Fatalf("seed industry %s: %v", row.id, err)
		}
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := pool.Exec(cleanupCtx, `DELETE FROM industries WHERE id LIKE 'ws3b_%'`); err != nil {
			t.Errorf("cleanup ws3b_ industries: %v", err)
		}
	})
}

// canonicalIndustriesRouter builds a router through the production-owned
// registrar (RegisterRoutes) — the EXACT function the composition root
// (backend/cmd/api/main.go) calls, so the smoke exercises production wiring.
func canonicalIndustriesRouter(queries *db.Queries) http.Handler {
	r := chi.NewRouter()
	RegisterRoutes(r, queries)
	return r
}

// TestIndustries_Live_ActiveOnlyOrderedThroughCanonicalRegistration seeds
// one inactive row plus three active rows (two TIED at sort_order 5) and
// proves over HTTP: the inactive row never appears, every element carries
// exactly id/label_es/label_en/sort_order, and ordering is sort_order ASC
// with the id tiebreak (ws3b_b < ws3b_a < ws3b_c). Insertion order
// deliberately mismatches the read order so a query without
// ORDER BY sort_order, id would fail.
func TestIndustries_Live_ActiveOnlyOrderedThroughCanonicalRegistration(t *testing.T) {
	pool := skipIfNoDatabaseForIndustries(t)
	// Pool close is registered BEFORE seeding so LIFO cleanup removes the
	// rows on an open pool first (same pattern as the WS2D-B1 fix).
	t.Cleanup(pool.Close)

	seedWS3BIndustries(t, pool, []ws3bIndustry{
		{id: "ws3b_c", sortOrder: 5, active: true},
		{id: "ws3b_inactive", sortOrder: 1, active: false},
		{id: "ws3b_a", sortOrder: 5, active: true},
		{id: "ws3b_b", sortOrder: 2, active: true},
	})

	srv := httptest.NewServer(canonicalIndustriesRouter(db.New(pool)))
	t.Cleanup(srv.Close)

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/industries", nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer ws3b-smoke-token") // must be ignored

	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("GET /industries: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusOK {
		t.Fatalf("want 200, got %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type: want application/json, got %q", ct)
	}

	var rows []map[string]json.RawMessage
	if err := json.NewDecoder(res.Body).Decode(&rows); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if rows == nil {
		t.Fatal("response decoded as null; want a JSON array")
	}

	seen := make(map[string]map[string]json.RawMessage, len(rows))
	var order []string
	for _, row := range rows {
		id := strings.Trim(string(row["id"]), `"`)
		seen[id] = row
		order = append(order, id)
	}

	if _, ok := seen["ws3b_inactive"]; ok {
		t.Errorf("inactive row ws3b_inactive MUST NOT be returned; got ids %v", order)
	}
	for _, want := range []string{"ws3b_a", "ws3b_b", "ws3b_c"} {
		row, ok := seen[want]
		if !ok {
			t.Errorf("active row %s missing from response; got ids %v", want, order)
			continue
		}
		assertExactWireKeys(t, row)
	}

	idx := func(id string) int { return slices.Index(order, id) }
	b, a, c := idx("ws3b_b"), idx("ws3b_a"), idx("ws3b_c")
	if b == -1 || a == -1 || c == -1 {
		t.Fatalf("fixture rows missing: b=%d a=%d c=%d (ids %v)", b, a, c, order)
	}
	if !(b < a && a < c) {
		t.Errorf("ordering must be sort_order ASC, id ASC: want ws3b_b < ws3b_a < ws3b_c, got %v", order)
	}
}

// TestIndustries_Live_DatabaseFailureReturnsCatalogEnvelope proves the DB
// failure path against a closed live pool: 500 with the shared stable
// envelope (code internal_error) and no driver detail on the wire.
func TestIndustries_Live_DatabaseFailureReturnsCatalogEnvelope(t *testing.T) {
	pool := skipIfNoDatabaseForIndustries(t)
	pool.Close() // force every subsequent query to fail

	srv := httptest.NewServer(canonicalIndustriesRouter(db.New(pool)))
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/industries")
	if err != nil {
		t.Fatalf("GET /industries: %v", err)
	}
	defer res.Body.Close()

	if res.StatusCode != http.StatusInternalServerError {
		t.Fatalf("want 500, got %d", res.StatusCode)
	}
	var env httpjson.ErrorEnvelope
	if err := json.NewDecoder(res.Body).Decode(&env); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if env.Code != httpjson.CodeInternalError {
		t.Errorf("code: want %q, got %q", httpjson.CodeInternalError, env.Code)
	}
	if strings.Contains(env.Error, "pool") || strings.Contains(env.Error, "closed") {
		t.Errorf("error message must be generic, got %q", env.Error)
	}
}
