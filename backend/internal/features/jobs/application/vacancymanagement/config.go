// Package vacancymanagement owns the internal request-date and headcount rules.
package vacancymanagement

import (
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

const (
	MaxHiringHeadcount = 999
	MaxBodyBytes       = pipelineconfig.MaxBodyBytes
	TimeZone           = "America/Mexico_City"
)

type Configuration struct {
	RequestDate     *string `json:"requestDate"`
	HiringHeadcount *int64  `json:"hiringHeadcount"`
	// TargetCloseDate is optional on the wire (stakeholder-metrics-v1 §2.2):
	// omitted while unset so existing clients and audit values keep their shape.
	TargetCloseDate *string `json:"targetCloseDate,omitempty"`
}

func (c Configuration) Equal(other Configuration) bool {
	return equal(c.RequestDate, other.RequestDate) && equal(c.HiringHeadcount, other.HiringHeadcount) && equal(c.TargetCloseDate, other.TargetCloseDate)
}
func equal[T comparable](a, b *T) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
func TodayAt(now time.Time, zone *time.Location) string { return now.In(zone).Format(time.DateOnly) }
func ETag(id uuid.UUID, version int64) string {
	digest := sha256.Sum256([]byte("job-draft-management:r1:" + id.String() + ":" + strconv.FormatInt(version, 10)))
	return `"mc1-` + base64.RawURLEncoding.EncodeToString(digest[:]) + `"`
}

// Replace accepts unchanged stored dates even when the clock has moved backwards.
// targetCloseDate is the one optional key: absent keeps the stored value, null
// clears it, so clients that predate it never erase it.
func Replace(current Configuration, body []byte, today string) (Configuration, error) {
	if len(body) > MaxBodyBytes {
		return Configuration{}, drafts.ErrPayloadTooLarge
	}
	value, err := draftjson.Decode(body)
	if err != nil {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	target, hasTarget := root["targetCloseDate"]
	keys := 2
	if hasTarget {
		keys = 3
	}
	if !ok || len(root) != keys {
		return Configuration{}, drafts.ErrInvalidRequest
	}
	for _, key := range []string{"requestDate", "hiringHeadcount"} {
		if _, ok := root[key]; !ok {
			return Configuration{}, drafts.ErrInvalidRequest
		}
	}
	var next Configuration
	if next.RequestDate, err = dateValue(root["requestDate"]); err != nil {
		return Configuration{}, err
	}
	next.TargetCloseDate = current.TargetCloseDate
	if hasTarget {
		if next.TargetCloseDate, err = dateValue(target); err != nil {
			return Configuration{}, err
		}
	}
	if raw := root["hiringHeadcount"]; raw != nil {
		v, ok := raw.(int64)
		if !ok {
			return Configuration{}, drafts.ErrInvalidRequest
		}
		next.HiringHeadcount = &v
	}
	if next.HiringHeadcount != nil && (*next.HiringHeadcount < 1 || *next.HiringHeadcount > MaxHiringHeadcount) {
		return Configuration{}, drafts.ErrValidation
	}
	if next.RequestDate != nil && !equal(next.RequestDate, current.RequestDate) && *next.RequestDate > today {
		return Configuration{}, drafts.ErrValidation
	}
	return next, nil
}

// dateValue accepts null or an exact YYYY-MM-DD string.
func dateValue(raw any) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	v, ok := raw.(string)
	if !ok {
		return nil, drafts.ErrInvalidRequest
	}
	date, err := time.Parse(time.DateOnly, v)
	if err != nil || date.Format(time.DateOnly) != v {
		return nil, drafts.ErrInvalidRequest
	}
	return &v, nil
}
