// Package valueobjects holds the companies bounded-context value objects.
package valueobjects

import (
	"errors"
	"strings"
)

// ErrCompanyRfcInvalidLength is returned when the RFC is not exactly 12 characters.
var ErrCompanyRfcInvalidLength = errors.New("el RFC de la empresa debe tener 12 caracteres")

type CompanyRfc struct {
	value string
}

func NewCompanyRfc(rfc string) (CompanyRfc, error) {
	cleanRfc := strings.ToUpper(strings.TrimSpace(rfc))

	if len(cleanRfc) != 12 {
		return CompanyRfc{}, ErrCompanyRfcInvalidLength
	}

	return CompanyRfc{value: cleanRfc}, nil
}

func (r CompanyRfc) Value() string {
	return r.value
}
