package http

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/application/usecases"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/entities"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
	"github.com/google/uuid"
)

type siteSlugRepo struct {
	stubRepo
	slug *string
	err  error
}

func (r *siteSlugRepo) GetPublishedSiteSlug(context.Context, uuid.UUID) (*string, error) {
	return r.slug, r.err
}

func TestGetCompanySiteSlug(t *testing.T) {
	slug := "current-published-slug"
	for _, tc := range []struct {
		name string
		slug *string
		want string
	}{
		{"not published", nil, "null"},
		{"published", &slug, `"current-published-slug"`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repo := &siteSlugRepo{stubRepo: stubRepo{getOut: siteSlugCompany(t)}, slug: tc.slug}
			rec := doGet(t, newTestRouter(NewCompanyHandler(usecaseForSlug(repo))), "/companies/"+repo.getOut.ID.String())
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			var body map[string]json.RawMessage
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if string(body["site_slug"]) != tc.want {
				t.Fatalf("site_slug=%s, want %s; body=%s", body["site_slug"], tc.want, rec.Body.String())
			}
		})
	}
}

func TestGetCompanySiteSlugPreservesExistingPublicFields(t *testing.T) {
	company := siteSlugCompany(t)
	web, logo, linkedin := "https://example.com", "https://example.com/logo", "https://linkedin.com/company/example"
	instagram, facebook, twitter, cover := "instagram", "facebook", "twitter", "cover"
	desc, _ := valueobjects.NewCompanyDescription("Public description")
	size := valueobjects.MediumSize
	year, _ := valueobjects.NewFoundedYear(2010)
	company.Website, company.LogoURL, company.LinkedInURL = &web, &logo, &linkedin
	company.InstagramURL, company.FacebookURL, company.TwitterURL, company.CoverImageURL = &instagram, &facebook, &twitter, &cover
	company.Description, company.Size, company.FoundedYear = &desc, &size, &year
	slug := "published"
	repo := &siteSlugRepo{stubRepo: stubRepo{getOut: company}, slug: &slug}
	rec := doGet(t, newTestRouter(NewCompanyHandler(usecaseForSlug(repo))), "/companies/"+company.ID.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	delete(body, "site_slug")
	want := map[string]any{
		"id": company.ID.String(), "name": "Public Company", "industry_id": "tech",
		"website": web, "logo_url": logo, "description": "Public description", "size": "medium",
		"founded_year": float64(2010), "location": nil, "linkedin_url": linkedin,
		"instagram_url": instagram, "facebook_url": facebook, "twitter_url": twitter, "cover_image_url": cover,
	}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("existing fields changed: got=%v want=%v", body, want)
	}
}

func TestGetCompanySiteSlugReadFailure(t *testing.T) {
	repo := &siteSlugRepo{stubRepo: stubRepo{getOut: siteSlugCompany(t)}, err: errors.New("query failed")}
	rec := doGet(t, newTestRouter(NewCompanyHandler(usecaseForSlug(repo))), "/companies/"+repo.getOut.ID.String())
	if rec.Code != http.StatusInternalServerError || rec.Body.String() != "{\"error\":\"an internal error occurred\",\"code\":\"internal_error\"}\n" {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func usecaseForSlug(repo *siteSlugRepo) *usecases.CompanyService {
	return usecases.NewCompanyService(repo)
}

func siteSlugCompany(t *testing.T) *entities.Company {
	t.Helper()
	name, _ := valueobjects.NewCompanyName("Public Company")
	rfc, _ := valueobjects.NewCompanyRfc("AAA010101AAA")
	return &entities.Company{ID: uuid.New(), Name: name, Rfc: rfc, IndustryID: "tech", Status: valueobjects.Active}
}
