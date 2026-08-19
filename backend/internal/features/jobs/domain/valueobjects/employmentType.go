package valueobjects

import (
	"errors"
	"strings"
)

var ErrInvalidEmploymentType = errors.New("invalid employment type")

type EmploymentType int

const (
	FullTime EmploymentType = iota
	PartTime
	Contract
	Internship
)

func (e EmploymentType) String() string {
	switch e {
	case FullTime:
		return "full_time"
	case PartTime:
		return "part_time"
	case Contract:
		return "contract"
	case Internship:
		return "internship"
	default:
		return "unknown_employment_type"
	}
}

func ParseEmploymentType(raw string) (EmploymentType, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "full_time":
		return FullTime, nil
	case "part_time":
		return PartTime, nil
	case "contract":
		return Contract, nil
	case "internship":
		return Internship, nil
	default:
		return 0, ErrInvalidEmploymentType
	}
}
