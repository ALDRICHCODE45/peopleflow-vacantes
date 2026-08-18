package valueobjects

import "errors"

// ErrCompanyDescriptionTooLong is returned when the description exceeds 3000 characters.
var ErrCompanyDescriptionTooLong = errors.New("la descripción de la compañía no puede exceder 3000 caracteres")

// companyDescriptionMaxLen caps a company description. The spec states ~3000 chars;
// the boundary is inclusive so 3000 is valid, 3001 is rejected.
const companyDescriptionMaxLen = 3000

// CompanyDescription is a free-form textual description of a company. The value
// object owns its own invariant: non-negative length and at most companyDescriptionMaxLen
// runes. An empty description is valid because the underlying DB column is nullable
// and many companies legitimately publish no description.
type CompanyDescription struct {
	value string
}

// NewCompanyDescription builds a CompanyDescription, returning
// ErrCompanyDescriptionTooLong when the input exceeds the maximum allowed length.
func NewCompanyDescription(description string) (CompanyDescription, error) {
	if len(description) > companyDescriptionMaxLen {
		return CompanyDescription{}, ErrCompanyDescriptionTooLong
	}
	return CompanyDescription{value: description}, nil
}

// Value returns the underlying description string.
func (d CompanyDescription) Value() string {
	return d.value
}
