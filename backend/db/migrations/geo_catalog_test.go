package migrations_test

import (
	"os"
	"strings"
	"testing"
)

func TestGeoCatalogMigration(t *testing.T) {
	b, err := os.ReadFile("00030_geo_catalog.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(b)
	for _, want := range []string{"-- +goose Up", "-- +goose Down", "CREATE TABLE geo_countries", "CREATE TABLE geo_states", "CREATE TABLE geo_municipalities", "CREATE TABLE geo_postal_codes", "CREATE TABLE geo_catalog_imports", "^[A-Z]{2}$", "^[0-9]{2}$", "^[0-9]{5}$", "REFERENCES geo_countries", "REFERENCES geo_states", "REFERENCES geo_municipalities", "CREATE COLLATION geo_es", "DROP TABLE geo_catalog_imports", "DROP COLLATION geo_es"} {
		if !strings.Contains(sql, want) {
			t.Errorf("migration missing %q", want)
		}
	}
}
