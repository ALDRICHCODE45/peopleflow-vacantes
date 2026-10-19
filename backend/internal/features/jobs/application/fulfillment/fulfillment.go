// Package fulfillment owns the historical delivery snapshot and civil-day rules.
package fulfillment

import (
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/google/uuid"
)

var (
	ErrFulfilled            = errors.New("delivery fulfilled")
	ErrConfirmationRequired = errors.New("fulfillment confirmation required")
	ErrNotPublished         = errors.New("vacancy not published")
)

type Person struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
}
type Candidate struct {
	ParticipationID uuid.UUID `json:"participation_id"`
	Candidate       Person    `json:"candidate"`
	ReachedAt       time.Time `json:"reached_at"`
}
type Snapshot struct {
	FulfilledAt       time.Time   `json:"fulfilled_at"`
	Result            string      `json:"result"`
	BusinessDaysDelta int         `json:"business_days_delta"`
	Target            int64       `json:"target"`
	CutoffStageID     string      `json:"cutoff_stage_id"`
	CutoffStageName   string      `json:"cutoff_stage_name"`
	CommitmentDate    string      `json:"commitment_date"`
	Candidates        []Candidate `json:"candidates"`
}
type Status struct {
	State                 string    `json:"state"`
	Delivered             int64     `json:"delivered"`
	Target                int64     `json:"target"`
	CutoffStageID         string    `json:"cutoff_stage_id"`
	CommitmentDate        string    `json:"commitment_date"`
	BusinessDaysRemaining *int      `json:"business_days_remaining"`
	Fulfillment           *Snapshot `json:"fulfillment"`
}
type Preview struct {
	WouldFulfill bool        `json:"would_fulfill"`
	Delivered    int64       `json:"delivered"`
	Target       *int64      `json:"target"`
	Candidates   []Candidate `json:"candidates"`
}

// Evaluate compares whole Mexico City dates, not elapsed hours. A weekend can
// be late even when no business day has elapsed (result and delta are distinct).
func Evaluate(at time.Time, commitment string, zone *time.Location) (string, int) {
	result := "on_time"
	if at.In(zone).Format(time.DateOnly) > commitment {
		result = "late"
	}
	return result, Remaining(at, commitment, zone)
}

// Remaining excludes the earlier endpoint and includes the later endpoint;
// the sign is positive before the commitment and negative after it.
func Remaining(at time.Time, commitment string, zone *time.Location) int {
	today, _ := time.Parse(time.DateOnly, at.In(zone).Format(time.DateOnly))
	deadline, _ := time.Parse(time.DateOnly, commitment)
	start, end, sign := today, deadline, 1
	if start.After(end) {
		start, end, sign = end, start, -1
	}
	days := 0
	for d := start.AddDate(0, 0, 1); !d.After(end); d = d.AddDate(0, 0, 1) {
		if businesscalendar.IsBusinessDay(d) {
			days++
		}
	}
	return days * sign
}
