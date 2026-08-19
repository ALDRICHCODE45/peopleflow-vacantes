package valueobjects

import (
	"errors"
	"strings"
)

var ErrInvalidWorkMode = errors.New("invalid work mode")

type WorkMode int

const (
	Onsite WorkMode = iota
	Remote
	Hybrid
)

func (w WorkMode) String() string {
	switch w {
	case Onsite:
		return "onsite"
	case Remote:
		return "remote"
	case Hybrid:
		return "hybrid"
	default:
		return "unknown_work_mode"
	}
}

func ParseWorkMode(raw string) (WorkMode, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "onsite":
		return Onsite, nil
	case "remote":
		return Remote, nil
	case "hybrid":
		return Hybrid, nil
	default:
		return 0, ErrInvalidWorkMode
	}
}
