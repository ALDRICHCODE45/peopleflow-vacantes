package entities

import (
	"errors"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/companies/domain/valueobjects"
)

func TestNewCompany_RequiredFieldsOnly(t *testing.T) {
	c, err := NewCompany("Acme SA de CV", "AAA010101AAA", "tech", CompanyProfile{})
	if err != nil {
		t.Fatalf("expected no error for required-only company, got: %v", err)
	}
	if c == nil {
		t.Fatal("expected company to be non-nil")
	}
	if c.ID.String() == "" {
		t.Error("expected non-zero ID")
	}
	if c.Name.Value() != "Acme SA de CV" {
		t.Errorf("expected name %q, got %q", "Acme SA de CV", c.Name.Value())
	}
	if c.Status != valueobjects.PendingVerification {
		t.Errorf("expected status PendingVerification, got: %v", c.Status)
	}
	if c.Description != nil {
		t.Errorf("expected nil Description when profile omitted, got: %+v", c.Description)
	}
	if c.Size != nil {
		t.Errorf("expected nil Size when profile omitted, got: %+v", c.Size)
	}
	if c.FoundedYear != nil {
		t.Errorf("expected nil FoundedYear when profile omitted, got: %+v", c.FoundedYear)
	}
	if c.Website != nil || c.LogoURL != nil {
		t.Errorf("expected nil Website/LogoURL when profile omitted, got: website=%v logo=%v", c.Website, c.LogoURL)
	}
}

func TestNewCompany_WithOptionalURLs(t *testing.T) {
	web := "https://acme.com"
	logo := "https://acme.com/logo.png"
	c, err := NewCompany("Acme SA de CV", "AAA010101AAA", "tech", CompanyProfile{
		Website: &web,
		LogoURL: &logo,
	})
	if err != nil {
		t.Fatalf("expected no error for company with URLs, got: %v", err)
	}
	if c.Website == nil || *c.Website != web {
		t.Errorf("expected website %q, got: %v", web, c.Website)
	}
	if c.LogoURL == nil || *c.LogoURL != logo {
		t.Errorf("expected logo %q, got: %v", logo, c.LogoURL)
	}
}

func TestNewCompany_WithDescriptionVO(t *testing.T) {
	desc, err := valueobjects.NewCompanyDescription("Líder en logística.")
	if err != nil {
		t.Fatalf("setup: NewCompanyDescription: %v", err)
	}
	c, err := NewCompany("Acme SA de CV", "AAA010101AAA", "tech", CompanyProfile{
		Description: &desc,
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if c.Description == nil || c.Description.Value() != "Líder en logística." {
		t.Errorf("expected description VO with value %q, got: %+v", "Líder en logística.", c.Description)
	}
}

func TestNewCompany_WithSizeAndYear(t *testing.T) {
	cs := valueobjects.MediumSize
	year, err := valueobjects.NewFoundedYear(2010)
	if err != nil {
		t.Fatalf("setup: NewFoundedYear: %v", err)
	}
	c, err := NewCompany("Acme SA de CV", "AAA010101AAA", "tech", CompanyProfile{
		Size:        &cs,
		FoundedYear: &year,
	})
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
	if c.Size == nil || *c.Size != valueobjects.MediumSize {
		t.Errorf("expected size MediumSize, got: %+v", c.Size)
	}
	if c.FoundedYear == nil || c.FoundedYear.Value() != 2010 {
		t.Errorf("expected foundedYear 2010, got: %+v", c.FoundedYear)
	}
}

func TestNewCompany_FullProfile(t *testing.T) {
	desc, _ := valueobjects.NewCompanyDescription("Full-profile company")
	cs := valueobjects.LargeSize
	year, _ := valueobjects.NewFoundedYear(1999)
	web := "https://acme.com"
	logo := "https://acme.com/logo.png"
	city := "CDMX"
	country := "MX"
	linkedin := "https://linkedin.com/company/acme"
	instagram := "https://instagram.com/acme"
	facebook := "https://facebook.com/acme"
	twitter := "https://twitter.com/acme"
	cover := "https://acme.com/cover.jpg"

	c, err := NewCompany("Acme SA de CV", "AAA010101AAA", "tech", CompanyProfile{
		Website:       &web,
		LogoURL:       &logo,
		Description:   &desc,
		Size:          &cs,
		FoundedYear:   &year,
		City:          &city,
		Country:       &country,
		LinkedInURL:   &linkedin,
		InstagramURL:  &instagram,
		FacebookURL:   &facebook,
		TwitterURL:    &twitter,
		CoverImageURL: &cover,
	})
	if err != nil {
		t.Fatalf("expected no error for full profile, got: %v", err)
	}
	if c.City == nil || *c.City != "CDMX" {
		t.Errorf("city not set")
	}
	if c.Country == nil || *c.Country != "MX" {
		t.Errorf("country not set")
	}
	if c.LinkedInURL == nil || *c.LinkedInURL != linkedin {
		t.Errorf("linkedin url not set")
	}
	if c.CoverImageURL == nil || *c.CoverImageURL != cover {
		t.Errorf("cover image url not set")
	}
}

func TestNewCompany_NameTooShort(t *testing.T) {
	_, err := NewCompany("AB", "AAA010101AAA", "tech", CompanyProfile{})
	if err == nil {
		t.Fatal("expected name validation error, got nil")
	}
	if !errors.Is(err, valueobjects.ErrCompanyNameTooShort) {
		t.Errorf("expected ErrCompanyNameTooShort, got: %v", err)
	}
}

func TestNewCompany_RfcInvalid(t *testing.T) {
	_, err := NewCompany("Acme SA de CV", "SHORT", "tech", CompanyProfile{})
	if err == nil {
		t.Fatal("expected RFC length error, got nil")
	}
	if !errors.Is(err, valueobjects.ErrCompanyRfcInvalidLength) {
		t.Errorf("expected ErrCompanyRfcInvalidLength, got: %v", err)
	}
}

func TestNewCompany_EmptyIndustry(t *testing.T) {
	_, err := NewCompany("Acme SA de CV", "AAA010101AAA", "   ", CompanyProfile{})
	if err == nil {
		t.Fatal("expected ErrEmptyIndustry, got nil")
	}
	if !errors.Is(err, ErrEmptyIndustry) {
		t.Errorf("expected ErrEmptyIndustry, got: %v", err)
	}
}
