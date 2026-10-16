// Package deliveryconfig owns the cut-3 delivery replacement rules without IO.
package deliveryconfig

import (
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

const (
	MaxTargetQuantity = 999
	MaxBodyBytes      = pipelineconfig.MaxBodyBytes
	TimeZone          = "America/Mexico_City"
)

var ErrNonBusinessDate = errors.New("deliveryconfig: non-business date")

// Configuration permits every combination of nulls while a vacancy is a draft.
type Configuration struct {
	CutoffStageID  *string `json:"cutoffStageId"`
	TargetQuantity *int64  `json:"targetQuantity"`
	CommitmentDate *string `json:"commitmentDate"`
}

func (c Configuration) Equal(other Configuration) bool {
	return equal(c.CutoffStageID, other.CutoffStageID) && equal(c.TargetQuantity, other.TargetQuantity) && equal(c.CommitmentDate, other.CommitmentDate)
}
func equal[T comparable](a, b *T) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

// Replace validates against the pipeline read in the caller's locked transaction
// and one calendar snapshot derived from its injected clock.
func Replace(current Configuration, pipeline pipelineconfig.Configuration, body []byte, calendar Calendar) (Configuration, error) {
	if len(body) > MaxBodyBytes {
		return Configuration{}, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok || len(root) != 3 {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	for _, key := range []string{"cutoffStageId", "targetQuantity", "commitmentDate"} {
		if _, exists := root[key]; !exists {
			return Configuration{}, drafts.ErrInvalidRequest
		}
	}
	var next Configuration
	var nextDate time.Time
	if raw := root["cutoffStageId"]; raw != nil {
		v, ok := raw.(string)
		if !ok {
			return Configuration{}, drafts.ErrInvalidRequest
		}
		next.CutoffStageID = &v
	}
	if raw := root["targetQuantity"]; raw != nil {
		v, ok := raw.(int64)
		if !ok {
			return Configuration{}, drafts.ErrInvalidRequest
		}
		next.TargetQuantity = &v
	}
	if raw := root["commitmentDate"]; raw != nil {
		v, ok := raw.(string)
		if !ok {
			return Configuration{}, drafts.ErrInvalidRequest
		}
		d, err := time.Parse(time.DateOnly, v)
		if err != nil || d.Format(time.DateOnly) != v {
			return Configuration{}, drafts.ErrInvalidRequest
		}
		next.CommitmentDate = &v
		nextDate = d
	}
	if next.CutoffStageID != nil {
		id, err := uuid.Parse(*next.CutoffStageID)
		if err != nil {
			return Configuration{}, drafts.ErrValidation
		}
		canonical := id.String()
		found := false
		for _, stage := range pipeline.Stages {
			if stage.ID == canonical && stage.Kind != "discarded" {
				found = true
				break
			}
		}
		if !found {
			return Configuration{}, drafts.ErrValidation
		}
		next.CutoffStageID = &canonical
	}
	if next.TargetQuantity != nil && (*next.TargetQuantity < 1 || *next.TargetQuantity > MaxTargetQuantity) {
		return Configuration{}, drafts.ErrValidation
	}
	if next.CommitmentDate != nil && !equal(next.CommitmentDate, current.CommitmentDate) {
		if *next.CommitmentDate < calendar.MinDate || *next.CommitmentDate > calendar.MaxDate {
			return Configuration{}, drafts.ErrValidation
		}
		if !businesscalendar.IsBusinessDay(nextDate) {
			return Configuration{}, ErrNonBusinessDate
		}
	}
	return next, nil
}

// Calendar is a civil-date view, never timestamps in the viewer's zone.
type Calendar struct {
	TimeZone         string   `json:"timeZone"`
	Today            string   `json:"today"`
	MinDate          string   `json:"minDate"`
	MaxDate          string   `json:"maxDate"`
	NonBusinessDates []string `json:"nonBusinessDates"`
}

// CalendarAt receives the clock instant and the America/Mexico_City location
// from the adapter; it neither reads the clock nor loads zone files itself.
func CalendarAt(now time.Time, mexicoCity *time.Location) Calendar {
	local := now.In(mexicoCity)
	year, month, day := local.Date()
	today := time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
	max := today.AddDate(1, 0, 0)
	if max.Month() != month {
		max = max.AddDate(0, 0, -1)
	} // 29 Feb -> 28 Feb
	return Calendar{TimeZone: TimeZone, Today: today.Format(time.DateOnly), MinDate: today.Format(time.DateOnly), MaxDate: max.Format(time.DateOnly), NonBusinessDates: businesscalendar.NonBusinessDates(today, max)}
}
