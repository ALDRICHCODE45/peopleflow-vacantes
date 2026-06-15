// Package valueobjects holds the companies bounded-context value objects.
package valueobjects

import (
	"errors"
	"strings"
)

var ErrInvalidCompanyStatus = errors.New("invalid company status")

type CompanyStatus int

const (
	PendingVerification CompanyStatus = iota
	Active
	Suspended
)

func (s CompanyStatus) String() string {
	switch s {
	case PendingVerification:
		return "pending_verification"
	case Active:
		return "active"
	case Suspended:
		return "suspended"
	default:
		return "unknown_status"
	}
}

func ParseCompanyStatus(raw string) (CompanyStatus, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "pending_verification":
		return PendingVerification, nil
	case "active":
		return Active, nil
	case "suspended":
		return Suspended, nil
	default:
		return 0, ErrInvalidCompanyStatus
	}
}
