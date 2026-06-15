// Package valueobjects holds the companies bounded-context value objects.
package valueobjects

import (
	"errors"
	"strings"
)

type CompanyRfc struct {
	value string
}

func NewCompanyRfc(rfc string) (CompanyRfc, error) {
	cleanRfc := strings.ToUpper(strings.TrimSpace(rfc))

	if len(cleanRfc) != 12 {
		return CompanyRfc{}, errors.New("el RFC de la empresa debe tener 12 caracteres")
	}

	return CompanyRfc{value: cleanRfc}, nil
}

func (r CompanyRfc) Value() string {
	return r.value
}
