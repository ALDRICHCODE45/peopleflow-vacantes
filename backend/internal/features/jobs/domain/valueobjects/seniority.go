package valueobjects

import (
	"errors"
	"strings"
)

var ErrInvalidSeniority = errors.New("invalid seniority")

type Seniority int

const (
	InternSeniority Seniority = iota
	JuniorSeniority
	MidSeniority
	SeniorSeniority
	LeadSeniority
)

func (s Seniority) String() string {
	switch s {
	case InternSeniority:
		return "intern"
	case JuniorSeniority:
		return "junior"
	case MidSeniority:
		return "mid"
	case SeniorSeniority:
		return "senior"
	case LeadSeniority:
		return "lead"
	default:
		return "unknown_seniority"
	}
}

func ParseSeniority(raw string) (Seniority, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "intern":
		return InternSeniority, nil
	case "junior":
		return JuniorSeniority, nil
	case "mid":
		return MidSeniority, nil
	case "senior":
		return SeniorSeniority, nil
	case "lead":
		return LeadSeniority, nil
	default:
		return 0, ErrInvalidSeniority
	}
}
