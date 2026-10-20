//go:build integration

package migrations_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/catalog"
	geohttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/http"
	geopostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/httpjson"
	"github.com/go-chi/chi/v5"
)

func TestGeoCatalogImportWithoutPostalCodesAndEmptyPostalHTTP(t *testing.T) {
	sqlDB, pool, cleanup := isolatedMigrationDB(t)
	defer cleanup()
	ctx := context.Background()
	gooseUpAll(t, sqlDB)
	gooseDownTo(t, sqlDB, 29)
	gooseUpTo(t, sqlDB, 30)
	defer func() { gooseDownTo(t, sqlDB, 29); gooseUpAll(t, sqlDB) }()
	data := catalog.Data{
		Countries:      []catalog.Country{{Code: "MX", NameEs: "México", NameEn: "Mexico"}},
		States:         []catalog.State{{Code: "14", Name: "Jalisco", Abbreviation: "Jal."}},
		Municipalities: []catalog.Municipality{{StateCode: "14", Code: "14039", Name: "Guadalajara"}},
	}
	var coreSources []geopostgres.Source
	for _, file := range []string{"countries.csv", "mx_states.csv", "mx_municipalities.csv"} {
		coreSources = append(coreSources, geopostgres.Source{File: file, Source: file, SourceDate: "2026-10-19"})
	}
	skip := geopostgres.ImportOptions{SkipPostalCodes: true}
	report, err := geopostgres.ImportWithOptions(ctx, pool, data, coreSources, skip)
	if err != nil || len(report.Counts) != 3 {
		t.Fatal("base import must not require postal data/provenance", report, err)
	}
	stats := func(wantPostal, wantHistory int) {
		t.Helper()
		var postal, history int
		if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM geo_postal_codes), (SELECT count(*) FROM geo_catalog_imports)`).Scan(&postal, &history); err != nil || postal != wantPostal || history != wantHistory {
			t.Fatalf("postal=%d history=%d err=%v", postal, history, err)
		}
	}
	stats(0, 3)
	router := chi.NewRouter()
	geohttp.RegisterRoutes(router, geopostgres.NewReader(db.New(pool)))
	for _, tc := range []struct{ path, want string }{
		{"/v2/geo/countries", `{"items":[{"id":"MX","name":"México"}]}`},
		{"/v2/geo/countries/MX/states", `{"items":[{"id":"14","name":"Jalisco"}]}`},
		{"/v2/geo/countries/MX/states/14/municipalities", `{"items":[{"id":"14039","name":"Guadalajara"}]}`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
			if w.Code != 200 || strings.TrimSpace(w.Body.String()) != tc.want || w.Header().Get("Cache-Control") != "public, max-age=86400" || w.Header().Get("ETag") == "" {
				t.Fatal(w.Code, w.Body, w.Header())
			}
			req := httptest.NewRequest("GET", tc.path, nil)
			req.Header.Set("If-None-Match", w.Header().Get("ETag"))
			cached := httptest.NewRecorder()
			router.ServeHTTP(cached, req)
			if cached.Code != 304 || cached.Body.Len() != 0 {
				t.Fatal(cached.Code, cached.Body)
			}
		})
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/v2/geo/countries/MX/postal-codes/44100", nil))
	var envelope httpjson.ErrorEnvelope
	if err = json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || w.Code != 404 || envelope.Code != httpjson.CodePostalCodeNotFound {
		t.Fatal(w.Code, w.Body, err)
	}
	if _, err = geopostgres.ImportWithOptions(ctx, pool, data, coreSources, skip); err != nil {
		t.Fatal("base-only reimport must be idempotent", err)
	}
	stats(0, 6)
	allSources := append(append([]geopostgres.Source(nil), coreSources...), geopostgres.Source{File: "mx_postal_codes.csv", Source: "SEPOMEX", SourceDate: "2026-10-18"})
	data.PostalCodes = []catalog.PostalCode{{PostalCode: "44100", StateCode: "14", MunicipalityCode: "14039"}}
	if _, err = geopostgres.Import(ctx, pool, data, allSources, false); err != nil {
		t.Fatal("default import must still enable postal step", err)
	}
	stats(1, 10)
	data.PostalCodes = []catalog.PostalCode{{PostalCode: "ignored invalid data"}}
	report, err = geopostgres.ImportWithOptions(ctx, pool, data, coreSources, skip)
	if err != nil || len(report.Orphans) != 0 || len(report.Counts) != 3 {
		t.Fatal("skipping must ignore postal values and postal orphans", report, err)
	}
	stats(1, 13)
	retained := httptest.NewRecorder()
	router.ServeHTTP(retained, httptest.NewRequest("GET", "/v2/geo/countries/MX/postal-codes/44100", nil))
	if retained.Code != 200 {
		t.Fatal("skip is not a delete/disable operation", retained.Code, retained.Body)
	}
}
