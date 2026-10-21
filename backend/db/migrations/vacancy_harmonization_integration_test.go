//go:build integration

package migrations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io/fs"
	"strings"
	"testing"
	"time"

	migrations "github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func vacancyLegacyLanguage(language string, name, level any) any {
	return map[string]any{"language": language, "custom_name": name, "level": level}
}
func vacancyRequirement(code, level string) any {
	return map[string]any{languages.CodeField: code, "min_level": level}
}
func vacancyDocument(t *testing.T, seniority any, items []any) (map[string]any, []byte) {
	t.Helper()
	created, err := draftinput.DecodeCreateV2([]byte(nulMigrationFixture))
	if err != nil {
		t.Fatal(err)
	}
	value, err := draftjson.Decode(created.Fingerprint())
	if err != nil {
		t.Fatal(err)
	}
	root := value.(map[string]any)
	fields := root["fields"].(map[string]any)
	fields["seniority"], fields["languages"] = seniority, items
	for _, key := range []string{"min_years_of_experience", "min_education_level", "accepts_in_progress_education"} {
		delete(fields, key)
	}
	return root, vacancyEncode(t, root)
}
func vacancyEncode(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := draftjson.EncodeValidatedValue(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func vacancyExpected(t *testing.T, root map[string]any, seniority any, items []any) []byte {
	t.Helper()
	fields := root["fields"].(map[string]any)
	fields["seniority"], fields["languages"] = seniority, items
	fields["min_years_of_experience"], fields["min_education_level"], fields["accepts_in_progress_education"] = nil, nil, false
	return vacancyEncode(t, root)
}

func TestVacancyHarmonizationStoredDraftsAndProjectionUpDown(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 40)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	type fixture struct {
		id            uuid.UUID
		before, after []byte
	}
	var fixtures []fixture
	var replayKey string
	defer func() {
		for _, f := range fixtures {
			if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1`, f.id); err != nil {
				t.Error(err)
			}
		}
		if replayKey != "" {
			if _, err := pool.Exec(ctx, `DELETE FROM job_draft_idempotency WHERE idem_key=$1`, replayKey); err != nil {
				t.Error(err)
			}
		}
		gooseUpAll(t, db)
	}()
	for _, seniority := range []any{nil, "intern", "junior", "mid", "senior", "lead"} {
		root, before := vacancyDocument(t, seniority, []any{
			vacancyLegacyLanguage("es", nil, "basic"),
			vacancyLegacyLanguage("en", nil, "intermediate"),
			vacancyLegacyLanguage("other", "FRANCE\u0301S", "advanced"),
			vacancyLegacyLanguage("other", "German", "native"),
			vacancyLegacyLanguage("other", "NaHuAtL", "basic"),
			vacancyLegacyLanguage("other", "Norwegian Bokmal", "intermediate"),
			vacancyLegacyLanguage("other", "English", "advanced"),
			vacancyLegacyLanguage("other", "ESPAÑOL", "native"),
			vacancyLegacyLanguage("es", nil, nil),
			vacancyLegacyLanguage("en", nil, nil),
			vacancyLegacyLanguage("other", "Italian", nil),
			vacancyLegacyLanguage("other", "Unknown language", "advanced"),
			vacancyLegacyLanguage("other", nil, "basic"),
			vacancyLegacyLanguage("other", "Spanish", "basic"),
		})
		mapped := seniority
		if seniority == "mid" {
			mapped = "semi_senior"
		}
		after := vacancyExpected(t, root, mapped, []any{
			vacancyRequirement("es", "native"), vacancyRequirement("en", "C1"), vacancyRequirement("fr", "C1"),
			vacancyRequirement("de", "native"), vacancyRequirement("nah", "A2"), vacancyRequirement("nb", "B1"),
		})
		id := uuid.New()
		insertDraftAt(t, pool, company, actor, id, before)
		if _, err := pool.Exec(ctx, `UPDATE job_drafts SET version=7,updated_at='2000-01-01' WHERE id=$1`, id); err != nil {
			t.Fatal(err)
		}
		fixtures = append(fixtures, fixture{id, before, after})
	}
	// Real frozen create replay: both fingerprint and response bytes/ETag stay fixed.
	key := uuid.NewString()
	replayKey = key
	insertTaggedIdempotencyAt(t, pool, company, actor, key, legacyAlgorithmTag, fixtures[0].before, fixtures[0].before)
	var frozenBefore string
	if err := pool.QueryRow(ctx, `SELECT row_to_json(i)::text FROM job_draft_idempotency i WHERE idem_key=$1`, key).Scan(&frozenBefore); err != nil {
		t.Fatal(err)
	}
	// Supply every NOT NULL/no-default column: 00020's base fields (location
	// removed by 00031), plus skills TEXT[] and screening_questions INTEGER
	// from 00025. search_vector is generated. Later migrations add no others.
	// A projection's independent source version must not be changed by the rewrite.
	projectionID := fixtures[3].id
	if _, err := pool.Exec(ctx, `INSERT INTO vacancy_processes(id,company_id,status,published_at,published_by) VALUES($1,$2,'published',now(),$3)`, projectionID, company, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO vacancy_public_projections(id,company_id,title,description_plain,work_mode,work_schedule,contract_type,professional_area,seniority,benefits,skills,screening_questions,published_at,source_draft_version)
 VALUES($1,$2,'Go','Go','remote','full_time','indefinite','technology_systems','mid','[]','{}',0,now(),7)`, projectionID, company); err != nil {
		t.Fatal(err)
	}
	gooseUpTo(t, db, 41)
	for _, f := range fixtures {
		var got []byte
		var version int64
		var updated time.Time
		if err := pool.QueryRow(ctx, `SELECT fields,version,updated_at FROM job_drafts WHERE id=$1`, f.id).Scan(&got, &version, &updated); err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, f.after) || version != 8 || updated.Year() == 2000 {
			t.Fatalf("draft %s version=%d updated=%v\ngot=%s\nwant=%s", f.id, version, updated, got, f.after)
		}
		// Every full stored source document becomes a valid canonical schema-2 draft.
		if err := draftinput.ValidatePersistedDraftV2(got); err != nil {
			t.Fatalf("rewritten draft: %v", err)
		}
	}
	var frozenUp string
	if err := pool.QueryRow(ctx, `SELECT row_to_json(i)::text FROM job_draft_idempotency i WHERE idem_key=$1`, key).Scan(&frozenUp); err != nil || frozenUp != frozenBefore {
		t.Fatal("Up mutated frozen replay", err)
	}
	var seniority string
	var sourceVersion int64
	if err := pool.QueryRow(ctx, `SELECT seniority,source_draft_version FROM vacancy_public_projections WHERE id=$1`, projectionID).Scan(&seniority, &sourceVersion); err != nil || seniority != "semi_senior" || sourceVersion != 7 {
		t.Fatal(seniority, sourceVersion, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE vacancy_public_projections SET seniority='mid' WHERE id=$1`, projectionID); err == nil {
		t.Fatal("old projection vocabulary accepted")
	}
	for _, value := range []string{"manager", "director"} {
		if _, err := pool.Exec(ctx, `UPDATE vacancy_public_projections SET seniority=$2 WHERE id=$1`, projectionID, value); err != nil {
			t.Fatal(err)
		}
		if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "projection seniority") {
			t.Fatalf("down %s: %v", value, err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE vacancy_public_projections SET seniority='semi_senior' WHERE id=$1`, projectionID); err != nil {
		t.Fatal(err)
	}
	gooseDownTo(t, db, 40)
	for _, f := range fixtures {
		var got []byte
		var version int64
		if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, f.id).Scan(&got, &version); err != nil || !bytes.Equal(got, f.before) || version != 9 {
			t.Fatalf("down version=%d got=%s err=%v", version, got, err)
		}
	}
	if err := pool.QueryRow(ctx, `SELECT seniority FROM vacancy_public_projections WHERE id=$1`, projectionID).Scan(&seniority); err != nil || seniority != "mid" {
		t.Fatal(seniority, err)
	}
	var frozenAfter string
	if err := pool.QueryRow(ctx, `SELECT row_to_json(i)::text FROM job_draft_idempotency i WHERE idem_key=$1`, key).Scan(&frozenAfter); err != nil || frozenBefore != frozenAfter {
		t.Fatal("frozen replay mutated", err)
	}
}

func TestVacancyHarmonizationOverflowAndNotice(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 40)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	items, expected := []any{}, []any{}
	for i, language := range languages.All()[:23] {
		items = append(items, vacancyLegacyLanguage("other", language.Name, "basic"))
		if i < 20 {
			expected = append(expected, vacancyRequirement(language.Code, "A2"))
		}
	}
	// A late duplicate strengthens a retained code without changing its order.
	items = append(items, vacancyLegacyLanguage("other", languages.All()[0].Name, "native"))
	expected[0] = vacancyRequirement(languages.All()[0].Code, "native")
	root, before := vacancyDocument(t, "mid", items)
	want := vacancyExpected(t, root, "semi_senior", expected)
	id := uuid.New()
	insertDraftAt(t, pool, company, actor, id, before)
	defer func() {
		if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1`, id); err != nil {
			t.Error(err)
		}
		gooseUpAll(t, db)
	}()
	// Execute the actual Up SQL on a pinned connection to capture PostgreSQL NOTICE.
	config := pool.Config().ConnConfig.Copy()
	var notices []string
	config.OnNotice = func(_ *pgconn.PgConn, n *pgconn.Notice) { notices = append(notices, n.Message) }
	conn, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00041_vacancy_harmonization.sql")
	if err != nil {
		t.Fatal(err)
	}
	up, _, _ := strings.Cut(string(raw), "-- +goose Down")
	if _, err := tx.Exec(ctx, up); err != nil {
		t.Fatal(err)
	}
	var got []byte
	if err := tx.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&got); err != nil || !bytes.Equal(got, want) {
		t.Fatalf("got=%s want=%s err=%v", got, want, err)
	}
	if err := draftinput.ValidatePersistedDraftV2(got); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(notices, "\n"), "1 duplicates collapsed, 3 distinct overflow codes dropped") {
		t.Fatalf("missing overflow NOTICE: %v", notices)
	}
	// Every frozen Spanish catalog name resolves, not just the overflow sample.
	for _, language := range languages.All() {
		root, source := vacancyDocument(t, nil, []any{vacancyLegacyLanguage("other", language.Name, "basic")})
		want := vacancyExpected(t, root, nil, []any{vacancyRequirement(language.Code, "A2")})
		if err := tx.QueryRow(ctx, `SELECT pg_temp.vacancy_rewrite($1::bytea,TRUE)`, source).Scan(&got); err != nil || !bytes.Equal(got, want) {
			t.Fatalf("catalog %s: got=%s want=%s err=%v", language.Code, got, want, err)
		}
		if err := draftinput.ValidatePersistedDraftV2(got); err != nil {
			t.Fatal(err)
		}
	}
	_, down, _ := strings.Cut(string(raw), "-- +goose Down")
	if _, err := tx.Exec(ctx, down); err != nil {
		t.Fatal(err)
	}
	var version int64
	if err := tx.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, id).Scan(&got, &version); err != nil || !bytes.Equal(got, before) || version != 3 {
		t.Fatalf("overflow rollback lost data: %s version=%d err=%v", got, version, err)
	}
}

func TestVacancyHarmonizationDownGuards(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 40)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	id, newID := uuid.New(), uuid.New()
	defer func() {
		if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1 OR id=$2`, id, newID); err != nil {
			t.Error(err)
		}
		gooseUpAll(t, db)
	}()
	_, before := vacancyDocument(t, nil, []any{})
	insertDraftAt(t, pool, company, actor, id, before)
	gooseUpTo(t, db, 41)
	var migrated []byte
	if err := pool.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&migrated); err != nil {
		t.Fatal(err)
	}
	for _, change := range []struct {
		key   string
		value any
	}{
		{"seniority", "manager"}, {"seniority", "director"},
		{"min_years_of_experience", "1.5"}, {"min_education_level", "bachelor"}, {"accepts_in_progress_education", true},
		{"languages", []any{vacancyRequirement("en", "B2")}},
		{"languages", []any{vacancyRequirement("es", "A1")}},
		{"languages", []any{vacancyRequirement("en", "C2")}},
	} {
		value, _ := draftjson.Decode(migrated)
		root := value.(map[string]any)
		root["fields"].(map[string]any)[change.key] = change.value
		changed := vacancyEncode(t, root)
		if _, err := pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, id, changed); err != nil {
			t.Fatal(err)
		}
		if err := gooseDownOnce(t, db); err == nil || !strings.Contains(err.Error(), "rollback refused") {
			t.Fatalf("%s: %v", change.key, err)
		}
		var got []byte
		var version int64
		if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, id).Scan(&got, &version); err != nil || !bytes.Equal(got, changed) || version != 2 {
			t.Fatal("failed Down was not atomic", err)
		}
	}
	if _, err := pool.Exec(ctx, `UPDATE job_drafts SET fields=$2 WHERE id=$1`, id, migrated); err != nil {
		t.Fatal(err)
	}
	insertDraftAt(t, pool, company, actor, newID, migrated)
	gooseDownTo(t, db, 40)
	for _, rowID := range []uuid.UUID{id, newID} {
		var got []byte
		if err := pool.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, rowID).Scan(&got); err != nil || !bytes.Equal(got, before) {
			t.Fatalf("representable existing/new draft: %s err=%v", got, err)
		}
	}
}

func TestVacancyHarmonizationCanonicalAndHistoricalEnvelopes(t *testing.T) {
	db, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	gooseUpAll(t, db)
	gooseDownTo(t, db, 40)
	ctx := context.Background()
	_, company, actor := seedPrereqs(ctx, t, pool)
	type fixture struct {
		id        uuid.UUID
		canonical []byte
		schema    any
	}
	fixtures := []fixture{}
	bareID := uuid.New()
	defer func() {
		for _, f := range fixtures {
			if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1`, f.id); err != nil {
				t.Error(err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM job_drafts WHERE id=$1`, bareID); err != nil {
			t.Error(err)
		}
		gooseUpAll(t, db)
	}()
	for _, schema := range []int64{1, 2} {
		for _, title := range vacancyCanonicalTitles {
			root, _ := vacancyDocument(t, "mid", []any{})
			root["schema_version"] = schema
			root["fields"].(map[string]any)["title"] = title
			canonical := vacancyEncode(t, root)
			// MarshalIndent proves the migration does not assume canonical input bytes.
			source, err := json.MarshalIndent(root, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			id := uuid.New()
			insertDraftAt(t, pool, company, actor, id, source)
			fixtures = append(fixtures, fixture{id, canonical, schema})
		}
	}
	insertDraftAt(t, pool, company, actor, bareID, []byte(" { } \n"))
	gooseUpTo(t, db, 41)
	for _, f := range fixtures {
		var got []byte
		if err := pool.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, f.id).Scan(&got); err != nil {
			t.Fatal(err)
		}
		value, _ := draftjson.Decode(f.canonical)
		want := vacancyExpected(t, value.(map[string]any), "semi_senior", []any{})
		if !bytes.Equal(got, want) {
			t.Fatalf("got=%s want=%s", got, want)
		}
		if f.schema == int64(2) {
			if err := draftinput.ValidatePersistedDraftV2(got); err != nil {
				t.Fatal(err)
			}
		}
	}
	var bare []byte
	var version int64
	if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, bareID).Scan(&bare, &version); err != nil || string(bare) != "{}" || version != 2 {
		t.Fatal(string(bare), version, err)
	}
	gooseDownTo(t, db, 40)
	for _, f := range fixtures {
		var got []byte
		if err := pool.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, f.id).Scan(&got); err != nil || !bytes.Equal(got, f.canonical) {
			t.Fatalf("restored=%s want=%s err=%v", got, f.canonical, err)
		}
	}
}
