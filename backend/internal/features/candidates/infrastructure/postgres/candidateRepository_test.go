//go:build integration

// Package postgres_integration exercises the candidates persistence port
// against a real PostgreSQL instance. These tests run only when the
// `integration` build tag is set (see Makefile target `test-integration`).
//
// Scope: cover the spec scenarios that depend on the database boundary
// (upsert idempotency, atomic language replace, FK enforcement) so the
// application layer can rely on the adapter without spinning up Postgres
// in unit tests.
package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newTestRepo connects to Postgres (skipping when DATABASE_URL is not
// available), wraps the pool in a *CandidateRepository, and yields both
// for tests that need direct SQL cleanup. Each test gets a unique user
// row so concurrent runs do not collide on the (user_id, language) PK.
func newTestRepo(t *testing.T) (*CandidateRepository, *pgxpool.Pool) {
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

	return NewCandidateRepository(pool), pool
}

// seedUser creates a fresh users row so candidate_profiles.user_id FK
// resolves. The cognito_sub is unique per call to avoid collisions with
// other tests in the same DB.
func seedUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	id := uuid.New()
	sub := fmt.Sprintf("itest-cand-%d-%s", time.Now().UnixNano(), id.String()[:8])
	_, err := pool.Exec(ctx,
		`INSERT INTO users (id, cognito_sub, email, full_name, user_type)
		 VALUES ($1, $2, $3, $4, $5)`,
		id, sub, sub+"@example.com", "IT Candidate", "candidate",
	)
	if err != nil {
		t.Fatalf("seed users: %v", err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM candidate_languages WHERE user_id = $1`, id)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM candidate_profiles WHERE user_id = $1`, id)
		_, _ = pool.Exec(cleanupCtx, `DELETE FROM users WHERE id = $1`, id)
	})
	return id
}

// TestUpsertProfile_CreateThenUpdate covers the spec scenarios
// "PUT creates on first call" and "PUT is idempotent on repeat": the
// postgres adapter's ON CONFLICT (user_id) DO UPDATE must persist the
// first payload, then overwrite it with the second without inserting a
// second row.
func TestUpsertProfile_CreateThenUpdate(t *testing.T) {
	repo, pool := newTestRepo(t)
	userID := seedUser(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	profile, err := entities.NewCandidateProfile(userID.String(), entities.CandidateProfileInput{
		EducationLevel: "bachelor",
		Skills:         []string{"Go", "AWS"},
	})
	if err != nil {
		t.Fatalf("NewCandidateProfile (1st): %v", err)
	}
	title1 := "Backend Engineer"
	profile.ProfessionalTitle = &title1
	profile.City = strPtr("CDMX")
	profile.YearsOfExperience = intPtr(3)

	got, err := repo.UpsertProfile(ctx, profile)
	if err != nil {
		t.Fatalf("UpsertProfile (create): %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil profile from create upsert")
	}
	if got.ProfessionalTitle == nil || *got.ProfessionalTitle != title1 {
		t.Errorf("ProfessionalTitle after create: want %q, got %v", title1, got.ProfessionalTitle)
	}
	// Skills are lowercased on write (NormalizeSkills in the entity).
	if len(got.Skills) != 2 || got.Skills[0] != "go" || got.Skills[1] != "aws" {
		t.Errorf("Skills: want [go aws], got %v", got.Skills)
	}

	// Second upsert overwrites.
	title2 := "Senior Backend Engineer"
	got2, err := repo.UpsertProfile(ctx, mustRebuildProfile(t, profile, func(p *entities.CandidateProfile) {
		p.ProfessionalTitle = &title2
		p.YearsOfExperience = intPtr(7)
		p.Skills = []string{"go", "aws", "kubernetes"}
	}))
	if err != nil {
		t.Fatalf("UpsertProfile (update): %v", err)
	}
	if got2.ProfessionalTitle == nil || *got2.ProfessionalTitle != title2 {
		t.Errorf("ProfessionalTitle after update: want %q, got %v", title2, got2.ProfessionalTitle)
	}
	if got2.YearsOfExperience == nil || *got2.YearsOfExperience != 7 {
		t.Errorf("YearsOfExperience after update: want 7, got %v", got2.YearsOfExperience)
	}
	if len(got2.Skills) != 3 {
		t.Errorf("Skills after update: want 3 entries, got %v", got2.Skills)
	}

	// Exactly ONE row for this user.
	var count int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM candidate_profiles WHERE user_id = $1`, userID,
	).Scan(&count); err != nil {
		t.Fatalf("count profiles: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 candidate_profiles row, got %d", count)
	}
}

// TestGetProfileByUserID_Found covers the spec scenario "GET returns
// the caller's profile": after an upsert, the same row reads back with
// the typed nullable columns preserved.
func TestGetProfileByUserID_Found(t *testing.T) {
	repo, pool := newTestRepo(t)
	userID := seedUser(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	profile, err := entities.NewCandidateProfile(userID.String(), entities.CandidateProfileInput{
		EducationLevel:       "master",
		ExpectedSalaryPeriod: "monthly",
		Skills:               []string{"go", "react"},
	})
	if err != nil {
		t.Fatalf("NewCandidateProfile: %v", err)
	}
	profile.Phone = strPtr("+52 55 1234 5678")
	profile.ProfileSummary = strPtr("Summary line.")
	profile.City = strPtr("CDMX")
	profile.Country = strPtr("MX")
	if _, err := repo.UpsertProfile(ctx, profile); err != nil {
		t.Fatalf("seed upsert: %v", err)
	}

	got, err := repo.GetProfileByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("GetProfileByUserID: %v", err)
	}
	if got.UserID != userID.String() {
		t.Errorf("UserID: want %s, got %s", userID, got.UserID)
	}
	if got.Phone == nil || *got.Phone != "+52 55 1234 5678" {
		t.Errorf("Phone: %v", got.Phone)
	}
	if got.ProfileSummary == nil || *got.ProfileSummary != "Summary line." {
		t.Errorf("ProfileSummary: %v", got.ProfileSummary)
	}
	if got.City == nil || *got.City != "CDMX" {
		t.Errorf("City: %v", got.City)
	}
	if got.EducationLevel == nil || *got.EducationLevel != valueobjects.Master {
		t.Errorf("EducationLevel: want Master, got %v", got.EducationLevel)
	}
	if got.ExpectedSalaryPeriod == nil || *got.ExpectedSalaryPeriod != valueobjects.MonthlySalary {
		t.Errorf("ExpectedSalaryPeriod: want MonthlySalary, got %v", got.ExpectedSalaryPeriod)
	}
}

// TestGetProfileByUserID_NotFound covers the spec scenario "GET without
// a profile returns 404": the repository must surface the domain
// sentinel entities.ErrProfileNotFound (not pgx.ErrNoRows) so the HTTP
// layer can dispatch via errors.Is.
func TestGetProfileByUserID_NotFound(t *testing.T) {
	repo, pool := newTestRepo(t)
	userID := seedUser(t, pool)
	// No profile inserted; the user row exists so the FK is fine.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := repo.GetProfileByUserID(ctx, userID)
	if !errors.Is(err, entities.ErrProfileNotFound) {
		t.Errorf("expected ErrProfileNotFound, got: %v", err)
	}
	// Defense in depth: the raw pgx sentinel must not leak either.
	if errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("repository must translate pgx.ErrNoRows to ErrProfileNotFound, not leak it")
	}
}

// TestListLanguagesByUserID_EmptyIsNotNil covers the "empty list, not
// nil" invariant the HTTP layer depends on (JSON null vs []).
func TestListLanguagesByUserID_EmptyIsNotNil(t *testing.T) {
	repo, pool := newTestRepo(t)
	userID := seedUser(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	got, err := repo.ListLanguagesByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("ListLanguagesByUserID: %v", err)
	}
	if got == nil {
		t.Fatal("expected non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("expected 0 languages, got %d", len(got))
	}
}

// TestReplaceLanguagesByUserID_Atomic covers the spec scenario "PUT
// replaces the full list atomically". After the call, old rows are gone
// and only the new ones are stored.
func TestReplaceLanguagesByUserID_Atomic(t *testing.T) {
	repo, pool := newTestRepo(t)
	userID := seedUser(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Seed: [english=B2, spanish=C1]
	if err := repo.ReplaceLanguagesByUserID(ctx, userID, []entities.Language{
		{Name: "english", Level: valueobjects.B2},
		{Name: "spanish", Level: valueobjects.C1},
	}); err != nil {
		t.Fatalf("seed replace: %v", err)
	}

	// Replace with [english=C1, french=A2]; spanish should be gone.
	if err := repo.ReplaceLanguagesByUserID(ctx, userID, []entities.Language{
		{Name: "english", Level: valueobjects.C1},
		{Name: "french", Level: valueobjects.A2},
	}); err != nil {
		t.Fatalf("replace: %v", err)
	}

	got, err := repo.ListLanguagesByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("ListLanguagesByUserID: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 languages, got %d: %+v", len(got), got)
	}
	// Rows are ordered by language name.
	want := map[string]valueobjects.CefrLevel{
		"english": valueobjects.C1,
		"french":  valueobjects.A2,
	}
	for _, l := range got {
		w, ok := want[l.Name]
		if !ok {
			t.Errorf("unexpected language %q in result", l.Name)
			continue
		}
		if l.Level != w {
			t.Errorf("language %q level: want %v, got %v", l.Name, w, l.Level)
		}
	}
	// Explicitly assert spanish is gone.
	for _, l := range got {
		if l.Name == "spanish" {
			t.Errorf("spanish should be removed, but found %+v", l)
		}
	}
}

// TestReplaceLanguagesByUserID_RollsBackOnDuplicate covers the
// "duplicate language in payload is rejected" invariant at the database
// boundary. The use case is the first line of defense; the postgres
// adapter's atomic tx is the second: if a duplicate slips through (e.g.
// a race), the unique (user_id, language) PK must reject the second
// insert and the WHOLE transaction must roll back, leaving the original
// list intact.
func TestReplaceLanguagesByUserID_RollsBackOnDuplicate(t *testing.T) {
	repo, pool := newTestRepo(t)
	userID := seedUser(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Seed: [english=B2]
	if err := repo.ReplaceLanguagesByUserID(ctx, userID, []entities.Language{
		{Name: "english", Level: valueobjects.B2},
	}); err != nil {
		t.Fatalf("seed replace: %v", err)
	}

	// Inject a duplicate in the same payload. The use case would reject
	// this, but the adapter must defensively roll back so a future race
	// or bypassed validation never silently corrupts the list.
	err := repo.ReplaceLanguagesByUserID(ctx, userID, []entities.Language{
		{Name: "english", Level: valueobjects.C1},
		{Name: "english", Level: valueobjects.A2},
	})
	if err == nil {
		t.Fatal("expected ErrDuplicateLanguage, got nil")
	}
	if !errors.Is(err, entities.ErrDuplicateLanguage) {
		t.Errorf("expected ErrDuplicateLanguage, got: %v", err)
	}

	// Original [english=B2] must still be the entire list.
	got, err := repo.ListLanguagesByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("ListLanguagesByUserID: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 language after rollback, got %d: %+v", len(got), got)
	}
	if got[0].Name != "english" || got[0].Level != valueobjects.B2 {
		t.Errorf("language after rollback: want [english=B2], got %+v", got[0])
	}
}

// TestReplaceLanguagesByUserID_EmptyClearsList proves that PUT with an
// empty list clears the stored rows (the spec scenario for "atomic
// replace" extends to "delete all, insert none" too).
func TestReplaceLanguagesByUserID_EmptyClearsList(t *testing.T) {
	repo, pool := newTestRepo(t)
	userID := seedUser(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := repo.ReplaceLanguagesByUserID(ctx, userID, []entities.Language{
		{Name: "english", Level: valueobjects.B2},
		{Name: "spanish", Level: valueobjects.C1},
	}); err != nil {
		t.Fatalf("seed replace: %v", err)
	}
	if err := repo.ReplaceLanguagesByUserID(ctx, userID, []entities.Language{}); err != nil {
		t.Fatalf("clear replace: %v", err)
	}
	got, err := repo.ListLanguagesByUserID(ctx, userID)
	if err != nil {
		t.Fatalf("ListLanguagesByUserID: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 languages after clear, got %d: %+v", len(got), got)
	}
}

// TestMapCreateError_NilPassesThrough covers the "no error to map"
// branch. The function is unexported, so the test lives in this package.
func TestMapCreateError_NilPassesThrough(t *testing.T) {
	if got := mapCreateError(nil); got != nil {
		t.Errorf("expected nil, got: %v", got)
	}
}

// --- helpers ---------------------------------------------------------------

func strPtr(s string) *string { return &s }

func intPtr(i int) *int { return &i }

// mustRebuildProfile re-runs the entity factory for a modified copy so
// the canonical normalization (skills, education_level parsing) is the
// same code path the production use case takes.
func mustRebuildProfile(t *testing.T, base *entities.CandidateProfile, mutate func(*entities.CandidateProfile)) *entities.CandidateProfile {
	t.Helper()
	edu := ""
	if base.EducationLevel != nil {
		edu = base.EducationLevel.String()
	}
	period := ""
	if base.ExpectedSalaryPeriod != nil {
		period = base.ExpectedSalaryPeriod.String()
	}
	dup, err := entities.NewCandidateProfile(base.UserID, entities.CandidateProfileInput{
		EducationLevel:       edu,
		ExpectedSalaryPeriod: period,
		Skills:               base.Skills,
	})
	if err != nil {
		t.Fatalf("rebuild profile: %v", err)
	}
	// Copy the optional fields the original carried so the second upsert
	// looks like a real-world follow-up.
	dup.Phone = base.Phone
	dup.LinkedInURL = base.LinkedInURL
	dup.PortfolioURL = base.PortfolioURL
	dup.ProfessionalTitle = base.ProfessionalTitle
	dup.CurrentCompany = base.CurrentCompany
	dup.YearsOfExperience = base.YearsOfExperience
	dup.ProfileSummary = base.ProfileSummary
	dup.BirthDate = base.BirthDate
	dup.City = base.City
	dup.Country = base.Country
	dup.FieldOfStudy = base.FieldOfStudy
	dup.CurrentSalaryGross = base.CurrentSalaryGross
	dup.CurrentSalaryNet = base.CurrentSalaryNet
	dup.ExpectedSalary = base.ExpectedSalary
	dup.SalaryCurrency = base.SalaryCurrency
	dup.CVS3Key = base.CVS3Key
	mutate(dup)
	return dup
}
