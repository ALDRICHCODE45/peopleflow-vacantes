package postgres

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/infrastructure/catalog"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Source struct {
	File       string `json:"file"`
	Source     string `json:"source"`
	SourceDate string `json:"source_date"`
}
type ImportReport struct {
	Skipped, Orphans []string
	Counts           map[string]int
}
type OrphanError struct{ Codes []string }

func (e *OrphanError) Error() string {
	return "catalog codes absent from incoming files (retained): " + strings.Join(e.Codes, ", ")
}

type ImportOptions struct {
	AllowOrphans    bool
	SkipPostalCodes bool
}

// Import runs all steps by default, preserving the all-in-one transaction.
func Import(ctx context.Context, pool *pgxpool.Pool, input catalog.Data, sources []Source, allowOrphans bool) (ImportReport, error) {
	return ImportWithOptions(ctx, pool, input, sources, ImportOptions{AllowOrphans: allowOrphans})
}

// ImportWithOptions isolates the optional SEPOMEX step. When skipped, no postal
// table is read, locked or written, no postal orphan is checked, and no postal
// provenance is recorded. Existing postal rows are never removed.
func ImportWithOptions(ctx context.Context, pool *pgxpool.Pool, input catalog.Data, sources []Source, options ImportOptions) (ImportReport, error) {
	report := ImportReport{}
	data, skipped, err := catalog.ValidateWithOptions(input, catalog.Options{SkipPostalCodes: options.SkipPostalCodes})
	report.Skipped = skipped
	if err != nil {
		return report, err
	}
	report.Counts = map[string]int{"countries.csv": len(data.Countries), "mx_states.csv": len(data.States), "mx_municipalities.csv": len(data.Municipalities)}
	if !options.SkipPostalCodes {
		report.Counts["mx_postal_codes.csv"] = len(data.PostalCodes)
	}
	sources, err = selectSources(sources, report.Counts, options.SkipPostalCodes)
	if err != nil {
		return report, err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return report, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	lockSQL := `LOCK TABLE geo_countries, geo_states, geo_municipalities, geo_catalog_imports`
	if !options.SkipPostalCodes {
		lockSQL += `, geo_postal_codes`
	}
	lockSQL += ` IN SHARE ROW EXCLUSIVE MODE`
	if _, err = tx.Exec(ctx, lockSQL); err != nil {
		return report, err
	}
	incoming := map[string]bool{}
	for _, c := range data.Countries {
		incoming["country/"+c.Code] = true
	}
	for _, s := range data.States {
		incoming["state/"+s.Code] = true
	}
	for _, m := range data.Municipalities {
		incoming["municipality/"+m.Code] = true
	}
	for _, p := range data.PostalCodes {
		incoming["postal/"+p.PostalCode+"/"+p.MunicipalityCode] = true
	}
	orphanSQL := `SELECT 'country/' || code FROM geo_countries
 UNION ALL SELECT 'state/' || code FROM geo_states WHERE country_code='MX'
 UNION ALL SELECT 'municipality/' || code FROM geo_municipalities WHERE country_code='MX'`
	if !options.SkipPostalCodes {
		orphanSQL += ` UNION ALL SELECT 'postal/' || postal_code || '/' || municipality_code FROM geo_postal_codes WHERE country_code='MX'`
	}
	rows, err := tx.Query(ctx, orphanSQL)
	if err != nil {
		return report, err
	}
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			rows.Close()
			return report, err
		}
		if !incoming[key] {
			report.Orphans = append(report.Orphans, key)
		}
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return report, err
	}
	sort.Strings(report.Orphans)
	if len(report.Orphans) > 0 && !options.AllowOrphans {
		return report, &OrphanError{Codes: report.Orphans}
	}
	batch := &pgx.Batch{}
	for _, c := range data.Countries {
		batch.Queue(`INSERT INTO geo_countries(code,name_es,name_en) VALUES($1,$2,$3) ON CONFLICT(code) DO UPDATE SET name_es=excluded.name_es,name_en=excluded.name_en`, c.Code, c.NameEs, c.NameEn)
	}
	for _, s := range data.States {
		batch.Queue(`INSERT INTO geo_states(country_code,code,name,abbreviation) VALUES('MX',$1,$2,$3) ON CONFLICT(country_code,code) DO UPDATE SET name=excluded.name,abbreviation=excluded.abbreviation`, s.Code, s.Name, s.Abbreviation)
	}
	for _, m := range data.Municipalities {
		batch.Queue(`INSERT INTO geo_municipalities(country_code,state_code,code,name) VALUES('MX',$1,$2,$3) ON CONFLICT(country_code,code) DO UPDATE SET state_code=excluded.state_code,name=excluded.name`, m.StateCode, m.Code, m.Name)
	}
	if !options.SkipPostalCodes {
		queuePostalCodes(batch, data.PostalCodes)
	}
	for _, source := range sources {
		date, _ := time.Parse(time.DateOnly, source.SourceDate)
		batch.Queue(`INSERT INTO geo_catalog_imports(source,source_date,rows) VALUES($1,$2,$3)`, source.Source, date, report.Counts[source.File])
	}
	result := tx.SendBatch(ctx, batch)
	if err = result.Close(); err != nil {
		return report, fmt.Errorf("upsert geo catalog: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return report, err
	}
	return report, nil
}

// queuePostalCodes is the isolated SEPOMEX write step; the core upserts do not
// consume postal data. It shares the enclosing transaction when enabled.
func queuePostalCodes(batch *pgx.Batch, pairs []catalog.PostalCode) {
	for _, pair := range pairs {
		batch.Queue(`INSERT INTO geo_postal_codes(country_code,postal_code,municipality_code) VALUES('MX',$1,$2) ON CONFLICT DO NOTHING`, pair.PostalCode, pair.MunicipalityCode)
	}
}

func selectSources(sources []Source, counts map[string]int, skipPostalCodes bool) ([]Source, error) {
	selected := make([]Source, 0, len(counts))
	seen := map[string]bool{}
	for _, source := range sources {
		if skipPostalCodes && source.File == "mx_postal_codes.csv" {
			continue
		}
		if _, ok := counts[source.File]; !ok || seen[source.File] || strings.TrimSpace(source.Source) == "" {
			return nil, fmt.Errorf("invalid source manifest")
		}
		if _, err := time.Parse(time.DateOnly, source.SourceDate); err != nil {
			return nil, fmt.Errorf("invalid source date for %s", source.File)
		}
		seen[source.File] = true
		selected = append(selected, source)
	}
	if len(seen) != len(counts) {
		return nil, fmt.Errorf("source manifest must contain every enabled catalog file")
	}
	return selected, nil
}
