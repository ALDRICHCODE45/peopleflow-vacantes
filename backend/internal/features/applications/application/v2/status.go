package v2

import "github.com/google/uuid"

// CandidateStatus exposes no internal pipeline identity or history.
func CandidateStatus(stage, initial uuid.UUID) string {
	if stage == initial {
		return "submitted"
	}
	return "in_process"
}
