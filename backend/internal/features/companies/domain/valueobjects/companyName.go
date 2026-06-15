// Package valueobjects holds the companies bounded-context value objects.
package valueobjects

import (
	"errors"
	"strings"
)

type CompanyName struct {
	value string
}

func NewCompanyName(name string) (CompanyName, error) {
	cleanName := strings.TrimSpace(name)

	if len(cleanName) <= 3 {
		return CompanyName{}, errors.New("el nombre de la compañía no puede ser menor a 4 caracteres")
	}

	return CompanyName{value: cleanName}, nil
}

func (n CompanyName) Value() string {
	return n.value
}
