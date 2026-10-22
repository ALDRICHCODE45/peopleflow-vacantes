package pool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	geoapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/geo/application"
	"github.com/google/uuid"
)

var ErrPreconditionFailed = errors.New("candidate precondition failed")

type Study struct {
	Level       string  `json:"level"`
	Institution *string `json:"institution"`
	Field       *string `json:"field"`
	Status      string  `json:"status"`
	StartYear   *int    `json:"start_year"`
	EndYear     *int    `json:"end_year"`
}

type Change struct {
	Field   string          `json:"field"`
	Contact bool            `json:"contact,omitempty"`
	From    json.RawMessage `json:"from,omitempty"`
	To      json.RawMessage `json:"to,omitempty"`
}
type HistoryEntry struct {
	ID      uuid.UUID `json:"id"`
	At      time.Time `json:"at"`
	Actor   Creator   `json:"actor"`
	Kind    string    `json:"kind"`
	Changes []Change  `json:"changes"`
}
type HistoryPage struct {
	Items      []HistoryEntry `json:"items"`
	NextCursor *string        `json:"next_cursor"`
}

// Editing is separate from the existing reader port to preserve read-only fakes.
type Editor interface {
	Edit(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string, []byte) (Detail, error)
	History(context.Context, uuid.UUID, string, uuid.UUID, HistoryQuery) (HistoryPage, error)
}

func ETag(kind string, id uuid.UUID, version int64) string {
	return fmt.Sprintf(`"%s-%s-%d"`, kind, id, version)
}

func (s *Service) Edit(ctx context.Context, company, actor uuid.UUID, kind string, id uuid.UUID, etag string, body []byte) (Detail, error) {
	// Check company membership/identity even for the temporarily unsupported kind.
	if kind == "organic" {
		if _, err := s.reader.Detail(ctx, company, kind, id); err != nil {
			return Detail{}, err
		}
		return Detail{}, board.ErrInvalidRequest
	}
	editor, ok := s.reader.(Editor)
	if !ok {
		return Detail{}, errors.New("candidate editor unavailable")
	}
	return editor.Edit(ctx, company, actor, id, etag, body)
}

// PrepareManualEdit owns normalization, effective validation and no-op detection.
// Persistence calls it under the candidate lock, with the transaction's catalog.
func PrepareManualEdit(ctx context.Context, lookup geoapp.Lookup, before, set map[string]json.RawMessage) (map[string]json.RawMessage, []Change, *board.ManualCandidate, error) {
	candidate, fields, err := board.ValidateManualEdit(ctx, lookup, before, set)
	if err != nil {
		return nil, nil, nil, err
	}
	if len(fields) > 0 {
		return nil, nil, nil, &board.ManualValidationError{Fields: fields}
	}
	// Languages are a code-keyed catalog and both pool reads and intake return
	// code order. Normalize before equality/history, not only after persistence.
	sort.Slice(candidate.Languages, func(i, j int) bool { return candidate.Languages[i].Code < candidate.Languages[j].Code })
	normalized := ManualValues(candidate)
	after := make(map[string]json.RawMessage, len(before))
	for k, v := range before {
		after[k] = v
	}
	for k := range set {
		after[k] = normalized[k]
	}
	return after, Changes(before, after, set), candidate, nil
}

// ManualValues projects intake-normalized values in the public edit/history
// shapes, not the summary profile. Null optional strings are retained as null.
func ManualValues(c *board.ManualCandidate) map[string]json.RawMessage {
	education := make([]Study, 0, len(c.Education))
	for _, e := range c.Education {
		education = append(education, Study{e.Level, e.Institution, e.Field, e.Status, e.StartYear, e.EndYear})
	}
	var location any
	if c.Residence != nil {
		location = map[string]any{"country": c.Residence.Country, "state": nullable(c.Residence.State), "municipality": nullable(c.Residence.Municipality), "postal_code": nullable(c.Residence.PostalCode)}
	}
	values := map[string]any{"full_name": c.FullName, "email": c.Email, "phone": c.Phone, "location": location, "professional_title": c.ProfessionalTitle, "current_company": c.CurrentCompany, "seniority": c.Seniority, "years_of_experience": c.YearsOfExperience, "education": education, "languages": c.Languages, "skills": c.Skills, "linkedin_url": c.LinkedInURL, "portfolio_url": c.PortfolioURL}
	out := make(map[string]json.RawMessage, len(values))
	for k, v := range values {
		out[k], _ = json.Marshal(v)
	} // All values are JSON-safe concrete DTOs.
	return out
}
func nullable(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func Changes(before, after, set map[string]json.RawMessage) []Change {
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	changes := []Change{}
	for _, key := range keys {
		var a, b any
		_ = json.Unmarshal(before[key], &a)
		_ = json.Unmarshal(after[key], &b)
		aa, _ := json.Marshal(a)
		bb, _ := json.Marshal(b)
		if string(aa) == string(bb) {
			continue
		}
		change := Change{Field: key}
		if key == "full_name" || key == "email" || key == "phone" {
			change.Contact = true
		} else {
			change.From = aa
			change.To = bb
		}
		changes = append(changes, change)
	}
	return changes
}
