//go:build integration

// WS2D-B1 live-DB evidence (task 2.4 of `openspec/changes/backend-go-closure`,
// B1 slice of the B1/B2 split):
//
//	Compact all-fields `UpdateCompany` integration: one real
//	`repo.UpdateCompany` call persists every supplied mutable
//	field and appends audit delta +1.
//
//	WS2D-B2 (NOT in this file) owns the PATCH/DELETE live bidirectional
//	races, the controlled-order writer-A-first / writer-B-first
//	subtests, and the zero-audit assertions for the lost-CAS adapter
//	path. B2 reaches into the `raceAudit` decorator and `racePair`
//	helper that were removed during the B1 carve.
package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/repositories"
	sharedvalueobjects "github.com/aldrichcode45/peopleflow-vacantes/internal/shared/valueobjects"
	"github.com/google/uuid"
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

// cleanupRaceCompany removes the seeded company + its audit rows; shared
// with B2 once the race helpers re-land.
func cleanupRaceCompany(t *testing.T, pool *pgxpool.Pool, entityID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := pool.Exec(ctx, `DELETE FROM audit_events WHERE entity_id = $1`, entityID); err != nil {
		t.Logf("cleanup audit: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, entityID); err != nil {
		t.Logf("cleanup company: %v", err)
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

	eventID, _ := uuid.NewV7()
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
