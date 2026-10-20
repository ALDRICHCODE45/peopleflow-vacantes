package postgres

import (
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/catalog"
	"github.com/jackc/pgx/v5"
)

func TestSelectSourcesWithoutPostalCodes(t *testing.T) {
	counts := map[string]int{"countries.csv": 2, "mx_states.csv": 1, "mx_municipalities.csv": 1}
	var core []Source
	for _, file := range []string{"countries.csv", "mx_states.csv", "mx_municipalities.csv"} {
		core = append(core, Source{File: file, Source: file, SourceDate: "2026-10-19"})
	}
	for _, tc := range []struct {
		name    string
		sources []Source
	}{
		{"postal manifest entry absent", core},
		{"postal manifest entry ignored", append(append([]Source(nil), core...), Source{File: "mx_postal_codes.csv", SourceDate: "not a date"})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			selected, err := selectSources(tc.sources, counts, true)
			if err != nil || len(selected) != 3 {
				t.Fatal(selected, err)
			}
			for _, source := range selected {
				if source.File == "mx_postal_codes.csv" {
					t.Fatal("must not record skipped postal provenance")
				}
			}
		})
	}
	if _, err := selectSources(core[:2], counts, true); err == nil {
		t.Fatal("skip postal must not waive core provenance")
	}
	counts["mx_postal_codes.csv"] = 1
	if _, err := selectSources(core, counts, false); err == nil {
		t.Fatal("default import must require postal provenance")
	}
}

func TestPostalWriteStep(t *testing.T) {
	batch := &pgx.Batch{}
	queuePostalCodes(batch, nil)
	if batch.Len() != 0 {
		t.Fatal("empty postal data must queue no writes")
	}
	queuePostalCodes(batch, []catalog.PostalCode{{PostalCode: "01000", StateCode: "01", MunicipalityCode: "01001"}})
	if batch.Len() != 1 {
		t.Fatal("postal step must queue its own upsert")
	}
}
