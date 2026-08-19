package valueobjects

import (
	"errors"
	"strings"
)

var ErrInvalidJobStatus = errors.New("invalid job status")

type JobStatus int

const (
	// Draft is the zero value (iota 0) — spec §Status Domain requires
	// jobs to be born `status='draft'` (DB DEFAULT 'draft'), and the VO
	// mirrors that so any zero-valued JobStatus serialized out the wire
	// formats as "draft".
	Draft JobStatus = iota
	Published
	Closed
)

func (s JobStatus) String() string {
	switch s {
	case Draft:
		return "draft"
	case Published:
		return "published"
	case Closed:
		return "closed"
	default:
		return "unknown_job_status"
	}
}

func ParseJobStatus(raw string) (JobStatus, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "draft":
		return Draft, nil
	case "published":
		return Published, nil
	case "closed":
		return Closed, nil
	default:
		return 0, ErrInvalidJobStatus
	}
}
