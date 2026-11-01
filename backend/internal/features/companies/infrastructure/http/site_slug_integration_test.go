//go:build integration

package http

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	companypostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestGetCompanySiteSlugIntegration(t *testing.T) {
	dsn := os.Getenv("DRAFT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("DRAFT_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	suffix := uuid.NewString()
	industry, user := "site-slug-"+suffix, uuid.New()
	var companies []uuid.UUID
	// Cleanup is restricted to this test's randomly identified fixture rows.
	t.Cleanup(func() {
		for _, id := range companies {
			if _, err := pool.Exec(ctx, `DELETE FROM company_sites WHERE company_id=$1`, id); err != nil {
				t.Error(err)
			}
			if _, err := pool.Exec(ctx, `DELETE FROM companies WHERE id=$1`, id); err != nil {
				t.Error(err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, user); err != nil {
			t.Error(err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM industries WHERE id=$1`, industry); err != nil {
			t.Error(err)
		}
	})
	if _, err := pool.Exec(ctx, `INSERT INTO industries(id,label_es,label_en,active) VALUES($1,'Site slug test','Site slug test',true)`, industry); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Site slug test','recruiter')`, user, "site-slug-"+suffix, suffix+"@example.test"); err != nil {
		t.Fatal(err)
	}
	repo := companypostgres.NewCompanyRepository(pool, nil)
	router := newTestRouter(NewCompanyHandler(usecases.NewCompanyService(repo)))
	for _, state := range []string{"published", "unpublished", "no site row"} {
		t.Run(state, func(t *testing.T) {
			company, err := entities.NewCompany("Site slug integration", "SLUG"+strings.ToUpper(uuid.NewString()[:8]), industry, entities.CompanyProfile{})
			if err != nil {
				t.Fatal(err)
			}
			if err := repo.Create(ctx, company); err != nil {
				t.Fatal(err)
			}
			companies = append(companies, company.ID)
			slug := "current-" + company.ID.String()
			if state != "no site row" {
				// Draft slug deliberately differs: the public response must use only published_slug.
				if _, err := pool.Exec(ctx, `INSERT INTO company_sites(company_id,draft,draft_slug,published,published_version,published_slug,published_at,updated_by) VALUES($1,'{}',$2,'{}',1,$3,now(),$4)`, company.ID, "draft-"+company.ID.String(), slug, user); err != nil {
					t.Fatal(err)
				}
				if state == "unpublished" {
					if _, err := pool.Exec(ctx, `UPDATE company_sites SET published=NULL,published_version=NULL,published_slug=NULL,published_at=NULL WHERE company_id=$1`, company.ID); err != nil {
						t.Fatal(err)
					}
				}
			}
			assertSlug := func(want string) {
				t.Helper()
				rec := doGet(t, router, "/companies/"+company.ID.String())
				if rec.Code != http.StatusOK {
					t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
				}
				var body map[string]json.RawMessage
				if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if string(body["site_slug"]) != want {
					t.Fatalf("site_slug=%s want=%s body=%s", body["site_slug"], want, rec.Body.String())
				}
			}
			if state == "published" {
				assertSlug(`"` + slug + `"`)
				// A later publication changes the current slug, never returning a retired/draft slug.
				slug += "-new"
				if _, err := pool.Exec(ctx, `UPDATE company_sites SET published_slug=$2 WHERE company_id=$1`, company.ID, slug); err != nil {
					t.Fatal(err)
				}
				assertSlug(`"` + slug + `"`)
			} else {
				assertSlug("null")
			}
		})
	}
}
