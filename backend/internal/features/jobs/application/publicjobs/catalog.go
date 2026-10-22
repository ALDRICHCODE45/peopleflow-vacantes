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
	"github.com/aldrichcode45/peopleflow-vacantes/internal/shared/languages"
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
	RequirementsProfile  RequirementsProfile         `json:"requirements_profile"`
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
	Languages, Seniorities                                            []string
	YearsOfExperience, EducationLevel                                 string
	Salary                                                            *SalaryFilter
	Limit                                                             int
	After                                                             *Position
}

// SalaryFilter is an active public salary filter (SAL-5..SAL-8). Min and Max
// are canonical two-decimal amounts; an empty bound is open. Currency, Period
// and Basis are always set: published salaries match only in the same units.
type SalaryFilter struct {
	Min, Max, Currency, Period, Basis string
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
			if isGeoFilter(key) || isSalaryFilter(key) || isProfileFilter(key) {
				if _, err := url.QueryUnescape(value); err != nil || strings.Contains(pair, ";") {
					return Query{}, ErrInvalidFilter
				}
			}
		}
		return Query{}, ErrInvalidRequest
	}
	q := Query{Limit: 20}
	salary := map[string]string{}
	for key, vs := range values {
		if isProfileFilter(key) {
			if err := parseProfileFilter(&q, key, vs); err != nil {
				return Query{}, err
			}
			continue
		}
		if isSalaryFilter(key) {
			if len(vs) != 1 || vs[0] == "" || !utf8.ValidString(vs[0]) || strings.ContainsRune(vs[0], 0) {
				return Query{}, ErrInvalidFilter
			}
			salary[key] = vs[0]
			continue
		}
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
	if len(salary) > 0 {
		filter, err := parseSalary(salary)
		if err != nil {
			return Query{}, err
		}
		q.Salary = &filter
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

func isProfileFilter(key string) bool {
	return key == "language" || key == "seniority" || key == "years_of_experience" || key == "education_level"
}

func parseProfileFilter(q *Query, key string, values []string) error {
	if (key == "years_of_experience" || key == "education_level") && len(values) != 1 {
		return ErrInvalidFilter
	}
	selected := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || slices.Contains(selected, value) {
			return ErrInvalidFilter
		}
		switch key {
		case "language":
			if _, ok := languages.Lookup(value); !ok {
				return ErrInvalidFilter
			}
		case "seniority":
			if !languages.ValidSeniority(value) {
				return ErrInvalidFilter
			}
		case "years_of_experience":
			normalized, ok := languages.NormalizeYears(value)
			if !ok {
				return ErrInvalidFilter
			}
			q.YearsOfExperience = normalized
		case "education_level":
			if !languages.ValidEducationLevel(value) {
				return ErrInvalidFilter
			}
			q.EducationLevel = value
		}
		selected = append(selected, value)
	}
	slices.Sort(selected)
	switch key {
	case "language":
		q.Languages = selected
	case "seniority":
		q.Seniorities = selected
	}
	return nil
}

func isGeoFilter(key string) bool {
	return key == "state" || key == "municipality" || key == "work_mode" || key == "applicant_country"
}

func isSalaryFilter(key string) bool {
	switch key {
	case "salary_min", "salary_max", "salary_currency", "salary_period", "salary_basis":
		return true
	}
	return false
}

// parseSalary requires at least one amount and all three units whenever any
// salary key is present (SAL-8: one-sided input is allowed, bounds inclusive).
func parseSalary(values map[string]string) (SalaryFilter, error) {
	var f SalaryFilter
	var minCents, maxCents uint64
	for key, target := range map[string]*string{"salary_min": &f.Min, "salary_max": &f.Max} {
		raw, ok := values[key]
		if !ok {
			continue
		}
		normalized, cents, valid := draftfields.NormalizeMoney(raw)
		if !valid {
			return SalaryFilter{}, ErrInvalidFilter
		}
		*target = normalized
		if key == "salary_min" {
			minCents = cents
		} else {
			maxCents = cents
		}
	}
	if f.Min == "" && f.Max == "" {
		return SalaryFilter{}, ErrInvalidFilter
	}
	if f.Min != "" && f.Max != "" && minCents > maxCents {
		return SalaryFilter{}, ErrInvalidFilter
	}
	for key, unit := range map[string]struct {
		target *string
		enum   string
	}{
		"salary_currency": {&f.Currency, "currency"},
		"salary_period":   {&f.Period, "pay_period"},
		"salary_basis":    {&f.Basis, "basis"},
	} {
		raw, ok := values[key]
		if !ok || !draftfields.CompensationEnumAllowed(unit.enum, raw) {
			return SalaryFilter{}, ErrInvalidFilter
		}
		*unit.target = raw
	}
	return f, nil
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
	filters := []any{q.Q, canonical(q.States), canonical(q.Municipalities), canonical(q.WorkModes), q.ApplicantCountry, q.WorkSchedule, q.ContractType, q.ProfessionalArea}
	// Appended only when active, so cursors issued without a salary filter keep
	// their binding.
	if s := q.Salary; s != nil {
		filters = append(filters, []string{s.Min, s.Max, s.Currency, s.Period, s.Basis})
	}
	// Keyed suffixes distinguish dimensions and preserve all pre-H5 bindings
	// (including salary cursors) when no profile filter is selected.
	if len(q.Languages) > 0 {
		filters = append(filters, []any{"language", canonical(q.Languages)})
	}
	if len(q.Seniorities) > 0 {
		filters = append(filters, []any{"seniority", canonical(q.Seniorities)})
	}
	if q.YearsOfExperience != "" {
		years, _ := languages.NormalizeYears(q.YearsOfExperience)
		filters = append(filters, []string{"years_of_experience", years})
	}
	if q.EducationLevel != "" {
		filters = append(filters, []string{"education_level", q.EducationLevel})
	}
	raw, _ := json.Marshal(filters)
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
