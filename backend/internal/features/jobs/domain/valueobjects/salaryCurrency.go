package valueobjects

import (
	"errors"
	"strings"
)

var ErrInvalidSalaryCurrency = errors.New("invalid salary currency")

type SalaryCurrency int

const (
	USD SalaryCurrency = iota
	MXN
)

func (c SalaryCurrency) String() string {
	switch c {
	case USD:
		return "USD"
	case MXN:
		return "MXN"
	default:
		return "unknown_salary_currency"
	}
}

func ParseSalaryCurrency(raw string) (SalaryCurrency, error) {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "USD":
		return USD, nil
	case "MXN":
		return MXN, nil
	default:
		return 0, ErrInvalidSalaryCurrency
	}
}
