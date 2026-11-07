package application

import (
	"math"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Calendar is the business-day rule of delivery fulfillment (§2.0), injected
// by the composition root so this feature owns no copy of the holiday set.
type Calendar func(time.Time) bool

// Between counts business dates in (from, to]: the earlier date is excluded
// and the later one included, as delivery fulfillment counts them. A reversed
// range is 0.
func (c Calendar) Between(from, to time.Time) int {
	days := 0
	for d := from.AddDate(0, 0, 1); !d.After(to); d = d.AddDate(0, 0, 1) {
		if c(d) {
			days++
		}
	}
	return days
}

// BetweenInstants counts business days between the local dates of two instants.
func (c Calendar) BetweenInstants(from, to time.Time) int {
	return c.Between(civilOf(from), civilOf(to))
}

// Rate always travels as an object; Value is null when the denominator is 0 (F4).
type Rate struct {
	Value       *float64 `json:"value"`
	Numerator   int      `json:"numerator"`
	Denominator int      `json:"denominator"`
}

// NewRate rounds the value to four decimals.
func NewRate(numerator, denominator int) Rate {
	r := Rate{Numerator: numerator, Denominator: denominator}
	if denominator > 0 {
		v := math.Round(float64(numerator)/float64(denominator)*10000) / 10000
		r.Value = &v
	}
	return r
}

// Median is null without a sample; an even sample averages the middle pair.
func Median(values []int) *float64 {
	if len(values) == 0 {
		return nil
	}
	s := slices.Clone(values)
	slices.Sort(s)
	n := len(s)
	m := float64(s[n/2])
	if n%2 == 0 {
		m = float64(s[n/2-1]+s[n/2]) / 2
	}
	return &m
}

// Person is every person in a response (F5). Name is null for a deleted
// account; FormerMember follows the audit screen's member rule: the user is no
// longer a member of this company.
type Person struct {
	UserID       uuid.UUID `json:"user_id"`
	Name         *string   `json:"name"`
	FormerMember bool      `json:"former_member"`
}

// Requester is a vacancy's current requester; ID and Name are null for «sin
// especificar», and the whole value is null for «sin solicitante» (F5).
type Requester struct {
	Kind string     `json:"kind"`
	ID   *uuid.UUID `json:"id"`
	Name *string    `json:"name"`
}
