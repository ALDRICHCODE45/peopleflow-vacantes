package publicjobs

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/vacancygeo"
	"github.com/google/uuid"
)

var (
	ErrInvalidRequest = errors.New("invalid public jobs request")
	ErrInvalidFilter  = errors.New("invalid public jobs filter")
	ErrNotFound       = errors.New("public job not found")
)

type Company struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	LogoURL *string   `json:"logo_url"`
}
type LegacySalary struct {
	Min      *string `json:"min"`
	Max      *string `json:"max"`
	Currency string  `json:"currency"`
}
type Item struct {
	ID                   uuid.UUID                   `json:"id"`
	Source               string                      `json:"source"`
	Title                string                      `json:"title"`
	Company              Company                     `json:"company"`
	Location             *vacancygeo.ReadLocation    `json:"location"`
	LocationLabel        *string                     `json:"location_label"`
	RemoteScope          *vacancygeo.ReadRemoteScope `json:"remote_scope"`
	WorkMode             string                      `json:"work_mode"`
	WorkSchedule         *string                     `json:"work_schedule"`
	ContractType         *string                     `json:"contract_type"`
	ProfessionalArea     *string                     `json:"professional_area"`
	Seniority            *string                     `json:"seniority"`
	LegacyEmploymentType *string                     `json:"legacy_employment_type"`
	Compensation         *Compensation               `json:"compensation"`
	LegacySalary         *LegacySalary               `json:"legacy_salary"`
	PublishedAt          time.Time                   `json:"published_at"`
	Excerpt              *string                     `json:"excerpt"`
	ExcerptTruncated     bool                        `json:"excerpt_truncated"`
	BenefitsPreview      Benefits                    `json:"benefits_preview"`
	BenefitsTotal        int                         `json:"benefits_total"`
	SkillsPreview        []string                    `json:"skills_preview"`
	SkillsTotal          int                         `json:"skills_total"`
	Applicants           *string                     `json:"applicants"`
	ScreeningQuestions   *int                        `json:"screening_questions"`
}
type Detail struct {
	Item
	Description      json.RawMessage `json:"description"`
	DescriptionPlain string          `json:"description_plain"`
	Requirements     Requirements    `json:"requirements"`
	Benefits         Benefits        `json:"benefits"`
	Skills           []string        `json:"skills"`
}
type Page struct {
	Items      []Item  `json:"items"`
	NextCursor *string `json:"next_cursor"`
}
type Position struct {
	Rank        float64   `json:"rank"`
	PublishedAt time.Time `json:"published_at"`
	Source      string    `json:"source"`
	ID          uuid.UUID `json:"id"`
}
type Query struct {
	Q, WorkSchedule, ContractType, ProfessionalArea, ApplicantCountry string
	States, Municipalities, WorkModes                                 []string
	Limit                                                             int
	After                                                             *Position
}
type Row struct {
	Detail Detail
	Rank   float64
}
type Reader interface {
	Search(context.Context, Query) ([]Row, error)
	Get(context.Context, uuid.UUID) (Detail, error)
}
type Catalog struct{ reader Reader }

func NewCatalog(reader Reader) *Catalog { return &Catalog{reader: reader} }

func (c *Catalog) List(ctx context.Context, q Query) (Page, error) {
	limit := q.Limit
	if limit < 1 || limit > 50 {
		return Page{}, ErrInvalidRequest
	}
	q.Limit = limit + 1
	rows, err := c.reader.Search(ctx, q)
	if err != nil {
		return Page{}, err
	}
	page := Page{Items: make([]Item, 0, limit)}
	if len(rows) > limit {
		anchor := rows[limit-1]
		token, err := encodeCursor(q, Position{Rank: anchor.Rank, PublishedAt: anchor.Detail.PublishedAt, Source: anchor.Detail.Source, ID: anchor.Detail.ID})
		if err != nil {
			return Page{}, err
		}
		page.NextCursor = &token
		rows = rows[:limit]
	}
	for _, row := range rows {
		detail := enrich(row.Detail)
		page.Items = append(page.Items, detail.Item)
	}
	return page, nil
}

// Get keeps the detail's shared card metadata identical to List.
func (c *Catalog) Get(ctx context.Context, id uuid.UUID) (Detail, error) {
	detail, err := c.reader.Get(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	return enrich(detail), nil
}

// ParseQuery permits repeated state, municipality and work_mode keys only.
// Selected values are distinct, exact and sorted for canonical cursor binding.
// Membership in the imported geography catalog is validated before SQL search.
func ParseQuery(raw string) (Query, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		for _, pair := range strings.Split(raw, "&") {
			key, value, _ := strings.Cut(pair, "=")
			key, _ = url.QueryUnescape(key)
			if isGeoFilter(key) {
				if _, err := url.QueryUnescape(value); err != nil || strings.Contains(pair, ";") {
					return Query{}, ErrInvalidFilter
				}
			}
		}
		return Query{}, ErrInvalidRequest
	}
	q := Query{Limit: 20}
	for key, vs := range values {
		if isGeoFilter(key) {
			if err := parseFilter(&q, key, vs); err != nil {
				return Query{}, err
			}
			continue
		}
		if len(vs) != 1 || !utf8.ValidString(vs[0]) || strings.ContainsRune(vs[0], 0) {
			return Query{}, ErrInvalidRequest
		}
		v := vs[0]
		switch key {
		case "q":
			q.Q = strings.TrimSpace(v)
		case "work_schedule", "contract_type", "professional_area":
			if v == "" {
				return Query{}, ErrInvalidRequest
			}
			if _, err := draftfields.ValidateScalars(map[string]any{key: v}); err != nil {
				return Query{}, ErrInvalidRequest
			}
			switch key {
			case "work_schedule":
				q.WorkSchedule = v
			case "contract_type":
				q.ContractType = v
			case "professional_area":
				q.ProfessionalArea = v
			}
		case "limit":
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 50 || strconv.Itoa(n) != v {
				return Query{}, ErrInvalidRequest
			}
			q.Limit = n
		case "cursor": // Decoded after all filters are known.
		default:
			return Query{}, ErrInvalidRequest
		}
	}
	if raw, ok := values["cursor"]; ok {
		p, err := decodeCursor(q, raw[0])
		if err != nil {
			return Query{}, err
		}
		q.After = &p
	}
	return q, nil
}

func isGeoFilter(key string) bool {
	return key == "state" || key == "municipality" || key == "work_mode" || key == "applicant_country"
}

func parseFilter(q *Query, key string, values []string) error {
	if key == "applicant_country" && len(values) != 1 {
		return ErrInvalidFilter
	}
	selected := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || slices.Contains(selected, value) {
			return ErrInvalidFilter
		}
		switch key {
		case "state", "municipality":
			size := 2
			if key == "municipality" {
				size = 5
			}
			if len(value) != size {
				return ErrInvalidFilter
			}
			for _, c := range value {
				if c < '0' || c > '9' {
					return ErrInvalidFilter
				}
			}
		case "applicant_country":
			if len(value) != 2 || value[0] < 'A' || value[0] > 'Z' || value[1] < 'A' || value[1] > 'Z' {
				return ErrInvalidFilter
			}
		case "work_mode":
			if _, err := draftfields.ValidateScalars(map[string]any{key: value}); err != nil {
				return ErrInvalidFilter
			}
		}
		selected = append(selected, value)
	}
	slices.Sort(selected)
	switch key {
	case "state":
		q.States = selected
	case "municipality":
		q.Municipalities = selected
	case "work_mode":
		q.WorkModes = selected
	case "applicant_country":
		q.ApplicantCountry = selected[0]
	}
	return nil
}

type cursorToken struct {
	Version  int      `json:"v"`
	Filters  string   `json:"filters"`
	Position Position `json:"position"`
}

func filterHash(q Query) string {
	// Sort copies as well: callers constructing Query directly must not affect
	// binding order, and hashing must not mutate their slices.
	canonical := func(values []string) []string {
		out := append([]string{}, values...)
		slices.Sort(out)
		return out
	}
	raw, _ := json.Marshal([]any{q.Q, canonical(q.States), canonical(q.Municipalities), canonical(q.WorkModes), q.ApplicantCountry, q.WorkSchedule, q.ContractType, q.ProfessionalArea})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func encodeCursor(q Query, p Position) (string, error) {
	raw, err := json.Marshal(cursorToken{Version: 2, Filters: filterHash(q), Position: p})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func decodeCursor(q Query, raw string) (Position, error) {
	if len(raw) > 2048 {
		return Position{}, ErrInvalidRequest
	}
	bytes, err := base64.RawURLEncoding.Strict().DecodeString(raw)
	if err != nil {
		return Position{}, ErrInvalidRequest
	}
	var token cursorToken
	if err := json.Unmarshal(bytes, &token); err != nil {
		return Position{}, ErrInvalidRequest
	}
	// Canonical round-trip rejects unknown/duplicate/missing keys and alternate
	// encodings; this token is opaque, versioned, and bound to its filter set.
	canonical, err := encodeCursor(q, token.Position)
	if err != nil || canonical != raw || token.Version != 2 || token.Filters != filterHash(q) {
		return Position{}, ErrInvalidRequest
	}
	p := token.Position
	if math.IsNaN(p.Rank) || math.IsInf(p.Rank, 0) || p.Rank < 0 || p.PublishedAt.IsZero() || p.ID == uuid.Nil {
		return Position{}, ErrInvalidRequest
	}
	if p.Source != "legacy" && p.Source != "vacancy" {
		return Position{}, ErrInvalidRequest
	}
	return p, nil
}
