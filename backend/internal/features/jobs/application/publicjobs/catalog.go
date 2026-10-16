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
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftfields"
	"github.com/google/uuid"
)

var (
	ErrInvalidRequest = errors.New("invalid public jobs request")
	ErrNotFound       = errors.New("public job not found")
)

type Company struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
type LegacySalary struct {
	Min      *string `json:"min"`
	Max      *string `json:"max"`
	Currency string  `json:"currency"`
}
type Item struct {
	ID                   uuid.UUID     `json:"id"`
	Source               string        `json:"source"`
	Title                string        `json:"title"`
	Company              Company       `json:"company"`
	Location             *string       `json:"location"`
	WorkMode             string        `json:"work_mode"`
	WorkSchedule         *string       `json:"work_schedule"`
	ContractType         *string       `json:"contract_type"`
	ProfessionalArea     *string       `json:"professional_area"`
	Seniority            *string       `json:"seniority"`
	LegacyEmploymentType *string       `json:"legacy_employment_type"`
	Compensation         *Compensation `json:"compensation"`
	LegacySalary         *LegacySalary `json:"legacy_salary"`
	PublishedAt          time.Time     `json:"published_at"`
}
type Detail struct {
	Item
	Description      json.RawMessage `json:"description"`
	DescriptionPlain string          `json:"description_plain"`
	Requirements     Requirements    `json:"requirements"`
	Benefits         Benefits        `json:"benefits"`
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
	Q, Location, WorkMode, WorkSchedule, ContractType, ProfessionalArea string
	Limit                                                               int
	After                                                               *Position
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
		page.Items = append(page.Items, row.Detail.Item)
	}
	return page, nil
}
func (c *Catalog) Get(ctx context.Context, id uuid.UUID) (Detail, error) {
	return c.reader.Get(ctx, id)
}

// ParseQuery rejects unknown/duplicate keys and invalid URL encoding, and
// reuses the exact draft scalar catalogs rather than inventing public enums.
func ParseQuery(raw string) (Query, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return Query{}, ErrInvalidRequest
	}
	q := Query{Limit: 20}
	for key, vs := range values {
		if len(vs) != 1 || !utf8.ValidString(vs[0]) || strings.ContainsRune(vs[0], 0) {
			return Query{}, ErrInvalidRequest
		}
		v := vs[0]
		switch key {
		case "q":
			q.Q = strings.TrimSpace(v)
		case "location":
			q.Location = strings.TrimSpace(v)
		case "work_mode", "work_schedule", "contract_type", "professional_area":
			if v == "" {
				return Query{}, ErrInvalidRequest
			}
			if _, err := draftfields.ValidateScalars(map[string]any{key: v}); err != nil {
				return Query{}, ErrInvalidRequest
			}
			switch key {
			case "work_mode":
				q.WorkMode = v
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

type cursorToken struct {
	Version  int      `json:"v"`
	Filters  string   `json:"filters"`
	Position Position `json:"position"`
}

func filterHash(q Query) string {
	raw, _ := json.Marshal([]string{q.Q, q.Location, q.WorkMode, q.WorkSchedule, q.ContractType, q.ProfessionalArea})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
func encodeCursor(q Query, p Position) (string, error) {
	raw, err := json.Marshal(cursorToken{Version: 1, Filters: filterHash(q), Position: p})
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
	if err != nil || canonical != raw || token.Version != 1 || token.Filters != filterHash(q) {
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
