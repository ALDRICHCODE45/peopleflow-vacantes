// Package dtos defines the input/output shapes for the companies application
// layer. Values arriving from the HTTP boundary are kept as strings/primitives
// so the use case owns the parsing and validation against the domain VOs.
package dtos

import geo "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"

type CreateCompanyDto struct {
	Name       string
	Rfc        string
	IndustryID string

	Website *string
	LogoURL *string

	Description *string
	Size        *string
	FoundedYear *int

	Location    *geo.LocationInput
	LinkedInURL *string

	InstagramURL  *string
	FacebookURL   *string
	TwitterURL    *string
	CoverImageURL *string
}
