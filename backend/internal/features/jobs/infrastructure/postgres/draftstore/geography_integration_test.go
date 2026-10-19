//go:build integration

package draftstore

import (
	"bytes"
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftinput"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/publication"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	publicstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/publicjobs"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func seedVacancyGeography(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	for _, sql := range []string{
		`INSERT INTO geo_countries VALUES('MX','México','Mexico'),('CO','Colombia','Colombia') ON CONFLICT(code) DO UPDATE SET name_es=EXCLUDED.name_es`,
		`INSERT INTO geo_states VALUES('MX','14','Jalisco','Jal.'),('MX','09','Ciudad de México','CDMX') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_municipalities VALUES('MX','14','14039','Guadalajara') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_postal_codes VALUES('MX','44100','14039') ON CONFLICT DO NOTHING`,
	} {
		if _, err := pool.Exec(context.Background(), sql); err != nil {
			t.Fatal(err)
		}
	}
}
func TestGeographyDraftValidationReplacementNoopPublishAndRefresh(t *testing.T) {
	pool := requireDraftPool(t)
	seedVacancyGeography(t, pool)
	s, p, draft := readyPublication(t, pool)
	id := draftIDOf(t, draft)
	ctx := context.Background()
	save := func(body string) drafts.Result {
		t.Helper()
		got, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, draft.ETag, true, []byte(body))
		if err != nil {
			t.Fatal(err)
		}
		draft = got
		return got
	}
	saved := save(`{"fields":{"location":{"country":"MX","state":"14","municipality":"14039","postal_code":"44100"},"remote_scope":{"kind":"countries","countries":["CO","MX"]}}}`)
	fields := envelopeOf(t, saved.Body)["fields"].(map[string]any)
	location := fields["location"].(map[string]any)
	if location["label"] != "Guadalajara, Jalisco" || !reflect.DeepEqual(location["country"], map[string]any{"id": "MX", "name": "México"}) {
		t.Fatal(location)
	}
	remote := fields["remote_scope"].(map[string]any)["countries"].([]any)
	if remote[0].(map[string]any)["id"] != "CO" || remote[1].(map[string]any)["id"] != "MX" {
		t.Fatal(remote)
	}
	before := publicationSnapshot(t, pool, id)
	noop := save(`{"fields":{"remote_scope":{"countries":["CO","MX"],"kind":"countries"},"location":{"postal_code":"44100","municipality":"14039","state":"14","country":"MX"}}}`)
	if noop.ETag != saved.ETag || before != publicationSnapshot(t, pool, id) {
		t.Fatal("no-op changed version/state")
	}
	// Scope is also a whole-field replacement: countries never leak through
	// an anywhere value, and explicit null clears rather than preserving it.
	anywhere := save(`{"fields":{"remote_scope":{"kind":"anywhere"}}}`)
	if got := envelopeOf(t, anywhere.Body)["fields"].(map[string]any)["remote_scope"]; !reflect.DeepEqual(got, map[string]any{"kind": "anywhere"}) {
		t.Fatal("scope was merged", got)
	}
	save(`{"fields":{"remote_scope":{"kind":"countries","countries":["MX"]}}}`)
	cleared := save(`{"fields":{"remote_scope":null}}`)
	if got := envelopeOf(t, cleared.Body)["fields"].(map[string]any)["remote_scope"]; got != nil {
		t.Fatal("scope not cleared", got)
	}
	if again := save(`{"fields":{"remote_scope":null}}`); again.ETag != cleared.ETag {
		t.Fatal("cleared scope no-op bumped version")
	}
	var codeOnly []byte
	if err := pool.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&codeOnly); err != nil {
		t.Fatal(err)
	}
	if got := envelopeOf(t, codeOnly)["fields"].(map[string]any)["remote_scope"]; got != nil {
		t.Fatal("stored scope not cleared", got)
	}
	save(`{"fields":{"remote_scope":{"kind":"countries","countries":["CO","MX"]}}}`)
	for _, tc := range []struct {
		name, body, reason string
		remote             bool
	}{
		{"mismatch", `{"fields":{"location":{"country":"MX","state":"09","municipality":"14039"}}}`, "mismatch", false},
		{"unknown country", `{"fields":{"remote_scope":{"kind":"countries","countries":["ZZ"]}}}`, "unknown_country", true},
		{"duplicate", `{"fields":{"remote_scope":{"kind":"countries","countries":["MX","MX"]}}}`, "duplicate", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			snapshot := publicationSnapshot(t, pool, id)
			got, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, draft.ETag, true, []byte(tc.body))
			var invalid *vacancygeo.Invalid
			if !errors.As(err, &invalid) || invalid.Remote != tc.remote || invalid.Details[0].Reason != tc.reason || !reflect.DeepEqual(got, drafts.Result{}) || snapshot != publicationSnapshot(t, pool, id) {
				t.Fatal(got, err)
			}
		})
	}
	// Whole-object replacement removes municipality and postal instead of merging.
	save(`{"fields":{"location":{"country":"MX"}}}`)
	fields = envelopeOf(t, draft.Body)["fields"].(map[string]any)
	if fields["location"].(map[string]any)["municipality"] != nil {
		t.Fatal("nested merge")
	}
	// Partial MX is fine remotely. Publication snapshots codes and countries order.
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, draft.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	reader := publicstore.NewStore(db.New(pool))
	detail, err := reader.Get(ctx, id)
	if err != nil || detail.Location == nil || detail.Location.Label != "México" || detail.RemoteScope == nil || detail.RemoteScope.Countries[0].ID != "CO" {
		t.Fatal(detail, err)
	}
	stateOnly := save(`{"fields":{"location":{"country":"MX","state":"14"}}}`)
	stateLocation := envelopeOf(t, stateOnly.Body)["fields"].(map[string]any)["location"].(map[string]any)
	if stateLocation["label"] != "Jalisco" || stateLocation["municipality"] != nil {
		t.Fatal("editor state-only label", stateLocation)
	}
	detail, err = reader.Get(ctx, id)
	if err != nil || detail.Location == nil || detail.Location.Label != "Jalisco" || detail.Location.Municipality != nil || detail.LocationLabel == nil || *detail.LocationLabel != "Jalisco" {
		t.Fatal("public state-only label", detail, err)
	}
	// Mode changes are still guarded; a partial MX onsite location cannot publish.
	_, err = s.SaveV2(ctx, p.companyID, p.ownerID, id, draft.ETag, true, []byte(`{"fields":{"work_mode":"onsite"}}`))
	var incomplete *publication.Incomplete
	if !errors.As(err, &incomplete) || !reflect.DeepEqual(incomplete.Missing, []string{"location_incomplete"}) {
		t.Fatal(err)
	}
	save(`{"fields":{"work_mode":"hybrid","location":{"country":"MX","state":"14","municipality":"14039"}}}`)
	detail, err = reader.Get(ctx, id)
	if err != nil || detail.RemoteScope != nil || detail.Location.Label != "Guadalajara, Jalisco" {
		t.Fatal(detail, err)
	}
	// Editor retains the expanded scope for mode toggling; projection suppresses it.
	var kind *string
	var countries []string
	if err := pool.QueryRow(ctx, `SELECT remote_scope_kind,remote_countries FROM vacancy_public_projections WHERE id=$1`, id).Scan(&kind, &countries); err != nil || kind != nil || countries != nil {
		t.Fatal(kind, countries, err)
	}
}

func TestMigration00031RealV1V2CreateAndSaveDocuments(t *testing.T) {
	pool := requireDraftPool(t)
	p := newPrincipal(t, pool)
	s := newStore(t, pool)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.DownToContext(ctx, sqlDB, ".", 30); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := goose.UpContext(ctx, sqlDB, "."); err != nil {
			t.Error(err)
		}
	}()
	type stored struct {
		name   string
		id     uuid.UUID
		source []byte
	}
	var rows []stored
	for _, writer := range []struct {
		name   string
		create func(context.Context, uuid.UUID, uuid.UUID, string, []byte) (drafts.Result, error)
		save   func(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, bool, []byte) (drafts.Result, error)
	}{{"v1", s.Create, s.Save}, {"v2", s.CreateV2, s.SaveV2}} {
		created, err := writer.create(ctx, p.companyID, p.ownerID, uuid.NewString(), []byte(`{"fields":{"title":"Actual write\u0000 <>&","description":{"schema_version":1,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Description\u0000"}]}]}}}}`))
		if err != nil {
			t.Fatal(writer.name, err)
		}
		id := draftIDOf(t, created)
		if _, err := writer.save(ctx, p.companyID, p.ownerID, id, created.ETag, true, []byte(`{"fields":{"title":"Real save\u0000 <>&"}}`)); err != nil {
			t.Fatal(writer.name, err)
		}
		var source []byte
		if err := pool.QueryRow(ctx, `SELECT fields FROM job_drafts WHERE id=$1`, id).Scan(&source); err != nil {
			t.Fatal(err)
		}
		rows = append(rows, stored{writer.name, id, source})
	}
	if err := goose.UpToContext(ctx, sqlDB, ".", 31); err != nil {
		t.Fatal(err)
	}
	assertStored := func(up bool, version int64) {
		t.Helper()
		for _, row := range rows {
			root := envelopeOf(t, row.source)
			fields := root["fields"].(map[string]any)
			if up {
				fields["remote_scope"] = nil
			} else {
				fields["location"] = nil
				delete(fields, "remote_scope")
			}
			var got []byte
			var gotVersion int64
			if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, row.id).Scan(&got, &gotVersion); err != nil || gotVersion != version || !bytes.Equal(got, mustCanonical(t, root)) {
				t.Fatalf("%s up=%t version=%d got=%s want=%s err=%v", row.name, up, gotVersion, got, mustCanonical(t, root), err)
			}
		}
	}
	assertStored(true, 3)
	if err := goose.DownToContext(ctx, sqlDB, ".", 30); err != nil {
		t.Fatal(err)
	}
	assertStored(false, 4)
}

func TestMigration00031RewrittenDraftReadsNoopPatchesAndPublishes(t *testing.T) {
	for _, retainedNUL := range []bool{false, true} {
		name := "old_location_NUL_only"
		if retainedNUL {
			name = "retained_NULs_and_old_location"
		}
		t.Run(name, func(t *testing.T) { assertMigration00031DraftLifecycle(t, retainedNUL) })
	}
}

func assertMigration00031DraftLifecycle(t *testing.T, retainedNUL bool) {
	t.Helper()
	pool := requireDraftPool(t)
	s, p, draft := readyPublication(t, pool)
	id := draftIDOf(t, draft)
	ctx := context.Background()
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	goose.SetBaseFS(migrations.MigrationsFS)
	if err := goose.DownToContext(ctx, sqlDB, ".", 30); err != nil {
		t.Fatal(err)
	}
	// Always restore the latest schema before the existing fixture cleanup runs.
	defer func() {
		if err := goose.UpContext(ctx, sqlDB, "."); err != nil {
			t.Error(err)
		}
	}()
	doc := envelopeOf(t, []byte(readV2Document))
	fields := doc["fields"].(map[string]any)
	// NUL is legal in canonical draft strings, including a value that is
	// discarded. Decoy field syntax and escaped backslashes protect tokenizer
	// boundaries: no replacement may occur inside a JSON string.
	fields["location"] = "old\x00 test location <&> \u2028\u2029"
	fields["title"] = "Canonical\x00 <&> \u2028\u2029 \"quoted\" \\slash"
	description := "Description\x00 ,\"location\":\"decoy\",\"remote_scope\":null}\\\\\" <&> \u2028\u2029 literal \\u0000"
	fields["description"] = map[string]any{"schema_version": int64(1), "document": map[string]any{"type": "doc", "content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": description}}}}}}
	fields["skills"] = []any{"Go\x00", "literal \\u0000"}
	fields["custom_benefits"] = []any{"Benefit\x00"}
	fields["required_requirements"] = "Required\x00"
	fields["preferred_requirements"] = "Preferred\x00"
	fields["languages"] = []any{map[string]any{"language": "other", "custom_name": "Language\x00", "level": nil}}
	questions := fields["screening_questions"].([]any)
	questions[0].(map[string]any)["prompt"] = "Prompt\x00"
	evaluated := questions[2].(map[string]any)
	evaluated["options"].([]any)[0].(map[string]any)["label"] = "Option\x00"
	if !retainedNUL {
		baseline := envelopeOf(t, []byte(readV2Document))["fields"].(map[string]any)
		for _, key := range []string{"title", "description", "skills", "custom_benefits", "required_requirements", "preferred_requirements", "languages", "screening_questions"} {
			fields[key] = baseline[key]
		}
		description = "Hello"
	}
	fields["requester"] = envelopeOf(t, draft.Body)["fields"].(map[string]any)["requester"]
	delete(fields, "remote_scope")
	if requester, ok := fields["requester"].(map[string]any); ok {
		delete(requester, "name")
	}
	if _, err := pool.Exec(ctx, `UPDATE job_drafts SET fields=$2,version=10 WHERE id=$1`, id, mustCanonical(t, doc)); err != nil {
		t.Fatal(err)
	}
	// Seed a real pre-G2 response/fingerprint, not just a post-G2 create row.
	frozen := envelopeOf(t, draft.Body)
	frozenFields := envelopeOf(t, mustCanonical(t, doc))["fields"].(map[string]any)
	frozenFields["description_plain"] = description
	if requester, ok := frozenFields["requester"].(map[string]any); ok {
		requester["name"] = "Engineering"
	}
	frozen["fields"] = frozenFields
	frozen["version"] = "1"
	if _, err := pool.Exec(ctx, `UPDATE job_draft_idempotency SET fingerprint=$2,response_body=$3 WHERE company_id=$1 AND operation='create:v2'`, p.companyID, fingerprintDigest(mustCanonical(t, doc)), mustCanonical(t, frozen)); err != nil {
		t.Fatal(err)
	}
	idempotencySnapshot := func() string {
		t.Helper()
		var row string
		if err := pool.QueryRow(ctx, `SELECT row_to_json(i)::text FROM job_draft_idempotency i WHERE company_id=$1 AND operation='create:v2'`, p.companyID).Scan(&row); err != nil {
			t.Fatal(err)
		}
		return row
	}
	frozenBefore := idempotencySnapshot()
	if err := goose.UpToContext(ctx, sqlDB, ".", 31); err != nil {
		t.Fatal(err)
	}
	if after := idempotencySnapshot(); after != frozenBefore {
		t.Fatal("up changed frozen pre-G2 idempotency row")
	}
	fields["location"], fields["remote_scope"] = nil, nil
	want := mustCanonical(t, doc)
	var stored []byte
	var version int64
	if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, id).Scan(&stored, &version); err != nil || version != 11 || !bytes.Equal(stored, want) {
		t.Fatalf("version=%d stored=%s want=%s err=%v", version, stored, want, err)
	}
	if err := draftinput.ValidatePersistedDraftV2(stored); err != nil {
		t.Fatal(err)
	}
	read, err := s.GetV2(ctx, p.companyID, p.ownerID, id)
	if err != nil {
		t.Fatal(err)
	}
	readFields := envelopeOf(t, read.Body)["fields"].(map[string]any)
	if readFields["title"] != fields["title"] || readFields["description_plain"] != description {
		t.Fatal("read lost retained NUL values")
	}
	noop, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, read.ETag, true, mustCanonical(t, map[string]any{"fields": map[string]any{"title": fields["title"]}}))
	if err != nil || noop.ETag != read.ETag {
		t.Fatal("rewritten no-op", noop, err)
	}
	// Publication's existing TEXT/JSONB projection cannot contain NUL. Editing
	// to publishable text is deliberate; migration/read/no-op above retain it.
	publishable := envelopeOf(t, []byte(readV2Document))["fields"].(map[string]any)
	publishable["requester"] = fields["requester"]
	patched, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, read.ETag, true, mustCanonical(t, map[string]any{"fields": publishable}))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, patched.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	// Down must preserve every retained NUL-bearing lexeme, clear structured
	// location, remove remote_scope, and emit byte-canonical previous shape.
	fields["location"] = map[string]any{"country": "MX", "state": "14"}
	fields["remote_scope"] = map[string]any{"kind": "countries", "countries": []any{"CO", "MX"}}
	if _, err := pool.Exec(ctx, `UPDATE job_drafts SET fields=$2,version=20 WHERE id=$1`, id, mustCanonical(t, doc)); err != nil {
		t.Fatal(err)
	}
	if err := goose.DownToContext(ctx, sqlDB, ".", 30); err != nil {
		t.Fatal(err)
	}
	fields["location"] = nil
	delete(fields, "remote_scope")
	if err := pool.QueryRow(ctx, `SELECT fields,version FROM job_drafts WHERE id=$1`, id).Scan(&stored, &version); err != nil || version != 21 || !bytes.Equal(stored, mustCanonical(t, doc)) {
		t.Fatalf("down version=%d stored=%s want=%s err=%v", version, stored, mustCanonical(t, doc), err)
	}
	var restored string
	if err := pool.QueryRow(ctx, `SELECT location FROM vacancy_public_projections WHERE id=$1`, id).Scan(&restored); err != nil || restored != "" {
		t.Fatal("down projection not empty", restored, err)
	}
	if after := idempotencySnapshot(); after != frozenBefore {
		t.Fatal("down changed frozen pre-G2 idempotency row")
	}
}
