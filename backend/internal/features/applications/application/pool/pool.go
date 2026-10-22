// Package pool owns the company-wide candidate list, independent of vacancy authorization.
package pool

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/google/uuid"
)

var ErrInvalidCursor = errors.New("invalid pool cursor")

// Field is transport-independent validation metadata; the HTTP adapter owns its wire shape.
type Field struct {
	Field string
	Code  string
}
type InvalidFilter struct{ Fields []Field }

func (*InvalidFilter) Error() string { return "invalid filter" }

type Counts struct {
	Total  int64 `json:"total"`
	Active int64 `json:"active"`
}
type Lifecycle struct {
	Publication *string `json:"publication"`
	Process     *string `json:"process"`
}
type Vacancy struct {
	ID        uuid.UUID `json:"id"`
	Title     string    `json:"title"`
	Lifecycle Lifecycle `json:"lifecycle"`
}
type Stage struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}
type Participation struct {
	Vacancy   Vacancy   `json:"vacancy"`
	Stage     Stage     `json:"stage"`
	State     string    `json:"state"`
	AppliedAt time.Time `json:"applied_at"`
}
type Item struct {
	Kind                string         `json:"kind"`
	ID                  uuid.UUID      `json:"id"`
	FullName            string         `json:"full_name"`
	ProfessionalTitle   *string        `json:"professional_title"`
	CurrentCompany      *string        `json:"current_company"`
	Profile             board.Profile  `json:"profile"`
	Participations      Counts         `json:"participations"`
	LatestParticipation *Participation `json:"latest_participation"`
	LastActivityAt      time.Time      `json:"last_activity_at"`
}
type Page struct {
	Items      []Item  `json:"items"`
	Total      int64   `json:"total"`
	NextCursor *string `json:"next_cursor"`
}

// StageNames is composed by the API from the jobs-owned pipeline vocabulary.
// It performs no authorization or IO: every recruiter sees every company vacancy.
type StageNames func(uuid.UUID, json.RawMessage) (map[string]string, error)
type Reader interface {
	Search(context.Context, uuid.UUID, Query) (Page, error)
}
type Service struct{ reader Reader }

func NewService(reader Reader) *Service { return &Service{reader: reader} }
func (s *Service) List(ctx context.Context, company uuid.UUID, raw string) (Page, error) {
	q, err := ParseQuery(company, raw)
	if err != nil {
		return Page{}, err
	}
	page, err := s.reader.Search(ctx, company, q)
	if err != nil {
		return Page{}, err
	}
	if page.Items == nil {
		page.Items = []Item{}
	}
	if len(page.Items) > q.Limit {
		page.Items = page.Items[:q.Limit]
		last := page.Items[q.Limit-1]
		token, err := encodeCursor(company, q, Position{At: last.LastActivityAt, Kind: last.Kind, ID: last.ID})
		if err != nil {
			return Page{}, err
		}
		page.NextCursor = &token
	}
	return page, nil
}
