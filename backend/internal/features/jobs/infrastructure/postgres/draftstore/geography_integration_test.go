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

func TestMigration00031RewrittenDraftReadsNoopPatchesAndPublishes(t *testing.T) {
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
	fields["location"] = "old test location <&> \u2028\u2029"
	fields["title"] = "Canonical <&> \u2028\u2029 \"quoted\" \\slash"
	fields["requester"] = envelopeOf(t, draft.Body)["fields"].(map[string]any)["requester"]
	delete(fields, "remote_scope")
	if requester, ok := fields["requester"].(map[string]any); ok {
		delete(requester, "name")
	}
	if _, err := pool.Exec(ctx, `UPDATE job_drafts SET fields=$2,version=10 WHERE id=$1`, id, mustCanonical(t, doc)); err != nil {
		t.Fatal(err)
	}
	if err := goose.UpToContext(ctx, sqlDB, ".", 31); err != nil {
		t.Fatal(err)
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
	noop, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, read.ETag, true, mustCanonical(t, map[string]any{"fields": map[string]any{"title": fields["title"]}}))
	if err != nil || noop.ETag != read.ETag {
		t.Fatal("rewritten no-op", noop, err)
	}
	patched, err := s.SaveV2(ctx, p.companyID, p.ownerID, id, read.ETag, true, []byte(`{"fields":{"remote_scope":{"kind":"anywhere"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Publish(ctx, p.companyID, p.ownerID, id, uuid.NewString(), true, patched.ETag, true, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
}
