// Package dashboard defines the read-only employer dashboard projection.
package dashboard

import (
	"context"
	"github.com/google/uuid"
	"time"
	_ "time/tzdata"
)

type Positions struct {
	Covered  int64 `json:"covered"`
	Required int64 `json:"required"`
}
type Day struct {
	Date    string `json:"date"`
	Organic int64  `json:"organic"`
	Manual  int64  `json:"manual"`
}
type Candidate struct {
	Kind string    `json:"kind"`
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
type Vacancy struct {
	ID    uuid.UUID `json:"id"`
	Title string    `json:"title"`
}
type Person struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
type Recent struct {
	ParticipationID uuid.UUID `json:"participation_id"`
	Candidate       Candidate `json:"candidate"`
	Vacancy         Vacancy   `json:"vacancy"`
	Stage           Person    `json:"stage"`
	Source          string    `json:"source"`
	AppliedAt       time.Time `json:"applied_at"`
	AddedBy         *Person   `json:"added_by"`
}
type Dashboard struct {
	PublishedVacancies int64     `json:"published_vacancies"`
	InProcess          int64     `json:"in_process"`
	PoolAddedLast7Days int64     `json:"pool_added_last_7_days"`
	Positions          Positions `json:"positions"`
	OriginByDay        []Day     `json:"origin_by_day"`
	Recent             []Recent  `json:"recent"`
}
type Reader interface {
	Dashboard(context.Context, uuid.UUID, uuid.UUID) (Dashboard, error)
}
type Service struct {
	reader Reader
	now    func() time.Time
}

func NewService(reader Reader, now func() time.Time) *Service {
	return &Service{reader: reader, now: now}
}
func (s *Service) Read(ctx context.Context, company, actor uuid.UUID) (Dashboard, error) {
	// Capture the day before IO so one response cannot straddle local midnight.
	loc, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		return Dashboard{}, err
	}
	today := s.now().In(loc)
	out, err := s.reader.Dashboard(ctx, company, actor)
	if err != nil {
		return Dashboard{}, err
	}
	counts := make(map[string]Day, len(out.OriginByDay))
	for _, day := range out.OriginByDay {
		counts[day.Date] = day
	}
	out.OriginByDay = make([]Day, 90)
	for i := range out.OriginByDay {
		date := today.AddDate(0, 0, i-89).Format("2006-01-02")
		day := counts[date]
		day.Date = date
		out.OriginByDay[i] = day
	}
	if out.Recent == nil {
		out.Recent = []Recent{}
	}
	return out, nil
}
