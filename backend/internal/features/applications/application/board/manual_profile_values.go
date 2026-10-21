package board

import "strings"

// Keep the intake vocabulary aligned with candidate profiles without importing
// another feature's domain. Education normalizes; CEFR is deliberately exact.
func manualEducationLevel(raw string) (string, bool) {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case "high_school", "bachelor", "master", "phd":
		return value, true
	default:
		return "", false
	}
}

func manualCEFRLevel(raw string) (string, bool) {
	switch raw {
	case "A1", "A2", "B1", "B2", "C1", "C2":
		return raw, true
	default:
		return "", false
	}
}
