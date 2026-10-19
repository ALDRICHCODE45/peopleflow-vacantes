//go:build integration

package migrations_test

import (
	"context"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/catalog"
	geohttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/http"
	geopostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/postgres"
	"github.com/go-chi/chi/v5"
)

func TestGeoCatalogMigrationConstraintsAndDown(t *testing.T) {
	sqlDB, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, sqlDB)
	gooseDownTo(t, sqlDB, 29)
	defer gooseUpAll(t, sqlDB)
	gooseUpTo(t, sqlDB, 30)
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, sql := range []string{
		`INSERT INTO geo_countries VALUES('MX','México','Mexico'),('US','Estados Unidos','United States')`,
		`INSERT INTO geo_states VALUES('MX','01','Aguascalientes','Ags.'),('MX','02','Baja California','BC')`,
		`INSERT INTO geo_municipalities VALUES('MX','01','01001','Árbol'),('MX','01','01002','Zorro'),('MX','01','01003','Álamo')`,
		`INSERT INTO geo_postal_codes VALUES('MX','01000','01001')`,
	} {
		if _, err := tx.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ name, sql string }{
		{"country format", `INSERT INTO geo_countries VALUES('mx','Mexico','Mexico')`},
		{"short country", `INSERT INTO geo_countries VALUES('M','Mexico','Mexico')`},
		{"state format", `INSERT INTO geo_states VALUES('MX','1','Bad','B')`},
		{"state country FK", `INSERT INTO geo_states VALUES('ZZ','01','Bad','B')`},
		{"municipality format", `INSERT INTO geo_municipalities VALUES('MX','01','0101','Bad')`},
		{"municipality prefix", `INSERT INTO geo_municipalities VALUES('MX','01','02001','Bad')`},
		{"municipality state FK", `INSERT INTO geo_municipalities VALUES('MX','99','99001','Bad')`},
		{"postal format", `INSERT INTO geo_postal_codes VALUES('MX','1000','01001')`},
		{"postal municipality FK", `INSERT INTO geo_postal_codes VALUES('MX','01000','01999')`},
		{"cross country FK", `INSERT INTO geo_postal_codes VALUES('US','01000','01001')`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			nested, err := tx.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer nested.Rollback(ctx)
			if _, err = nested.Exec(ctx, tc.sql); err == nil {
				t.Fatal("invalid value accepted")
			}
		})
	}
	q := db.New(tx)
	items, err := q.GeoMunicipalities(ctx, db.GeoMunicipalitiesParams{CountryCode: "MX", StateCode: "01"})
	if err != nil || len(items) != 3 || items[0].Name != "Álamo" || items[1].Name != "Árbol" {
		t.Fatal("Spanish ordering", items, err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	gooseDownTo(t, sqlDB, 29)
	for _, name := range []string{"geo_countries", "geo_states", "geo_municipalities", "geo_postal_codes", "geo_catalog_imports"} {
		var exists bool
		if err = pool.QueryRow(ctx, `SELECT to_regclass($1) IS NOT NULL`, name).Scan(&exists); err != nil || exists {
			t.Fatal("down retained table", name, err)
		}
	}
	var collation bool
	if err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_collation WHERE collname='geo_es')`).Scan(&collation); err != nil || collation {
		t.Fatal("down retained collation", err)
	}
}

func TestGeoCatalogImportIdempotencyOrphanRefusalAndHTTP(t *testing.T) {
	sqlDB, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, sqlDB)
	gooseDownTo(t, sqlDB, 29)
	gooseUpTo(t, sqlDB, 30)
	defer func() { gooseDownTo(t, sqlDB, 29); gooseUpAll(t, sqlDB) }()
	data := catalog.Data{
		Countries:      []catalog.Country{{Code: "MX", NameEs: "México", NameEn: "Mexico"}, {Code: "US", NameEs: "Estados Unidos", NameEn: "United States"}},
		States:         []catalog.State{{Code: "01", Name: "Aguascalientes", Abbreviation: "Ags."}},
		Municipalities: []catalog.Municipality{{StateCode: "01", Code: "01001", Name: "Aguascalientes"}, {StateCode: "01", Code: "01002", Name: "Asientos"}},
		PostalCodes:    []catalog.PostalCode{{PostalCode: "01000", StateCode: "01", MunicipalityCode: "01001"}, {PostalCode: "01000", StateCode: "01", MunicipalityCode: "01002"}, {PostalCode: "99999", StateCode: "01", MunicipalityCode: "01999"}},
	}
	var sources []geopostgres.Source
	for _, name := range []string{"countries.csv", "mx_states.csv", "mx_municipalities.csv", "mx_postal_codes.csv"} {
		sources = append(sources, geopostgres.Source{File: name, Source: name, SourceDate: "2026-01-01"})
	}
	importData := func(input catalog.Data, allow bool) (geopostgres.ImportReport, error) {
		return geopostgres.Import(ctx, pool, input, sources, allow)
	}
	r, err := importData(data, false)
	if err != nil || len(r.Skipped) != 1 {
		t.Fatal(r, err)
	}
	if _, err = importData(data, false); err != nil {
		t.Fatal("idempotent reimport", err)
	}
	count := func(table string) int {
		t.Helper()
		var n int
		switch table {
		case "countries":
			err = pool.QueryRow(ctx, `SELECT count(*) FROM geo_countries`).Scan(&n)
		case "postal":
			err = pool.QueryRow(ctx, `SELECT count(*) FROM geo_postal_codes`).Scan(&n)
		case "imports":
			err = pool.QueryRow(ctx, `SELECT count(*) FROM geo_catalog_imports`).Scan(&n)
		}
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if count("countries") != 2 || count("postal") != 2 || count("imports") != 8 {
		t.Fatal("duplicate catalog data or missing provenance")
	}
	var dated int
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM geo_catalog_imports WHERE source_date='2026-01-01'`).Scan(&dated); err != nil || dated != 8 {
		t.Fatal("source dates", dated, err)
	}
	reader := geopostgres.NewReader(db.New(pool))
	router := chi.NewRouter()
	geohttp.RegisterRoutes(router, reader)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/v2/geo/countries/MX/postal-codes/01000", nil))
	if w.Code != 200 || strings.Count(w.Body.String(), `"municipality":`) != 2 {
		t.Fatal(w.Code, w.Body)
	}
	tag := w.Header().Get("ETag")
	if _, err = importData(data, false); err != nil {
		t.Fatal(err)
	}
	next := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/v2/geo/countries/MX/postal-codes/01000", nil)
	req.Header.Set("If-None-Match", tag)
	router.ServeHTTP(next, req)
	if next.Code != 200 || next.Header().Get("ETag") == tag {
		t.Fatal("import must invalidate ETag")
	}
	smaller := data
	smaller.Countries = data.Countries[:1]
	smaller.Countries[0].NameEs = "Changed"
	before := count("imports")
	r, err = importData(smaller, false)
	var orphan *geopostgres.OrphanError
	if !errors.As(err, &orphan) || len(r.Orphans) != 1 || r.Orphans[0] != "country/US" {
		t.Fatal("missing code must refuse", r, err)
	}
	var name string
	if err = pool.QueryRow(ctx, `SELECT name_es FROM geo_countries WHERE code='MX'`).Scan(&name); err != nil || name != "México" || count("imports") != before {
		t.Fatal("refused import changed data or provenance", name, err)
	}
	if _, err = importData(smaller, true); err != nil || count("countries") != 2 {
		t.Fatal("allow-orphans must retain old code", err)
	}
	smaller = data
	smaller.Municipalities = data.Municipalities[:1]
	smaller.PostalCodes = data.PostalCodes[:1]
	if _, err = importData(smaller, false); !errors.As(err, &orphan) {
		t.Fatal("referenced municipality/postal pair disappearance must refuse", err)
	}
}
