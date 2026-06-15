// Package dtos
package dtos

type CreateCompanyDto struct {
	Name       string
	Rfc        string
	IndustryID string

	Website *string
	LogoURL *string
}
