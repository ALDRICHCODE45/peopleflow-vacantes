package pool

import (
	"context"
	"encoding/json"
	"sort"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	geoapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/google/uuid"
)

// OrganicETag binds the independent correction version to its company as well
// as the candidate. A token from another company cannot authorize this edit.
func OrganicETag(company, id uuid.UUID, version int64) string {
	return ETag("organic-"+company.String(), id, version)
}

// OrganicValues converts the uncorrected public projection to edit/history
// shapes. The snapshot has no full study list or professional/link attributes.
func OrganicValues(o *Original) map[string]json.RawMessage {
	var location any
	if l := o.Profile.Location; l != nil {
		var state, municipality *string
		if l.State != nil {
			state = &l.State.ID
		}
		if l.Municipality != nil {
			municipality = &l.Municipality.ID
		}
		location = map[string]any{"country": l.Country.ID, "state": state, "municipality": municipality, "postal_code": l.PostalCode}
	}
	values := map[string]any{"full_name": o.FullName, "email": o.Contact.Email, "phone": o.Contact.Phone, "location": location, "professional_title": nil, "current_company": nil, "seniority": o.Profile.Seniority, "years_of_experience": o.Profile.YearsOfExperience, "education": nil, "languages": o.Profile.Languages, "skills": o.Profile.Skills, "linkedin_url": nil, "portfolio_url": nil}
	out := map[string]json.RawMessage{}
	for key, value := range values {
		out[key], _ = json.Marshal(value)
	}
	return out
}

// PrepareOrganicEdit never mutates originals. Resets are validated against the
// correction map, not effective equality: dropping even an equal correction is
// a real change. Legacy originals are not revalidated on reset, except contact.
func PrepareOrganicEdit(ctx context.Context, lookup geoapp.Lookup, original, corrections, set map[string]json.RawMessage, reset []string) (map[string]json.RawMessage, []Change, error) {
	before := map[string]json.RawMessage{}
	for k, v := range original {
		before[k] = v
	}
	next := map[string]json.RawMessage{}
	for k, v := range corrections {
		before[k] = v
		next[k] = v
	}
	effective := map[string]json.RawMessage{}
	for k, v := range before {
		effective[k] = v
	}
	for _, k := range reset {
		if _, ok := corrections[k]; !ok {
			return nil, nil, board.ErrInvalidRequest
		}
		delete(next, k)
		effective[k] = original[k]
	}
	after, changes, _, err := PrepareManualEdit(ctx, lookup, effective, set)
	if err != nil {
		return nil, nil, err
	}
	for _, c := range changes {
		next[c.Field] = after[c.Field]
	}
	for _, k := range reset {
		c := Change{Field: k, Reset: true}
		if k == "full_name" || k == "email" || k == "phone" {
			c.Contact = true
		} else {
			c.From = before[k]
			c.To = original[k]
		}
		changes = append(changes, c)
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Field < changes[j].Field })
	return next, changes, nil
}
