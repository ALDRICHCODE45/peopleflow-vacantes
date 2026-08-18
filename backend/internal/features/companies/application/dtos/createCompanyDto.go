// Package dtos defines the input/output shapes for the companies application
// layer. Values arriving from the HTTP boundary are kept as strings/primitives
// so the use case owns the parsing and validation against the domain VOs.
package dtos

type CreateCompanyDto struct {
	Name       string
	Rfc        string
	IndustryID string

	Website *string
	LogoURL *string

	Description *string
	Size        *string
	FoundedYear *int

	City        *string
	Country     *string
	LinkedInURL *string

	InstagramURL  *string
	FacebookURL   *string
	TwitterURL    *string
	CoverImageURL *string
}
