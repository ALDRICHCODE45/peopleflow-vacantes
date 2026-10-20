//go:build integration

package postgres

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func seedCompanyLocationCatalog(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	for _, statement := range []string{
		`INSERT INTO geo_countries(code,name_es,name_en) VALUES('MX','México','Mexico') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_states(country_code,code,name,abbreviation) VALUES('MX','14','Jalisco','Jal.') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_municipalities(country_code,state_code,code,name) VALUES('MX','14','14039','Guadalajara') ON CONFLICT DO NOTHING`,
		`INSERT INTO geo_postal_codes(country_code,postal_code,municipality_code) VALUES('MX','44100','14039') ON CONFLICT DO NOTHING`,
	} {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
}
