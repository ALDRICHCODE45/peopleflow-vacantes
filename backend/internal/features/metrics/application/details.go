package application

import (
	"cmp"
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/google/uuid"
)

// VacancyList is the §3.4 vacancy detail list. It carries no candidate data.
type VacancyList struct {
	header
	Items      []VacancyRow `json:"items"`
	NextCursor *string      `json:"next_cursor"`
}

type VacancyRow struct {
	DraftID          uuid.UUID       `json:"draft_id"`
	Title            string          `json:"title"`
	Requester        *Requester      `json:"requester"`
	Responsible      *Person         `json:"responsible"`
	FirstPublishedAt time.Time       `json:"first_published_at"`
	Closes           []CloseRow      `json:"closes"`
	Delivery         VacancyDelivery `json:"delivery"`
	Placements       Coverage        `json:"placements"`
	Reassignments    int             `json:"reassignments"`
}

// CloseRow is one close in the period; Reason is null for legacy closes (M2).
type CloseRow struct {
	Date   string  `json:"date"`
	Reason *string `json:"reason"`
}

type VacancyDelivery struct {
	Result                 string     `json:"result"`
	Target                 *int       `json:"target"`
	Delivered              int        `json:"delivered"`
	TargetReachedAt        *time.Time `json:"target_reached_at"`
	CommitmentDate         *string    `json:"commitment_date"`
	OriginalCommitmentDate *string    `json:"original_commitment_date"`
	Renegotiations         int        `json:"renegotiations"`
	BusinessDaysLate       *int       `json:"business_days_late"`
}

type Coverage struct {
	Covered  int  `json:"covered"`
	Required *int `json:"required"`
}

// ReassignmentList is the §3.4 reassignment list.
type ReassignmentList struct {
	header
	Items      []ReassignmentRow `json:"items"`
	NextCursor *string           `json:"next_cursor"`
}

type ReassignmentRow struct {
	ID                        uuid.UUID       `json:"id"`
	PerformedAt               time.Time       `json:"performed_at"`
	Vacancy                   VacancyRef      `json:"vacancy"`
	From                      Person          `json:"from"`
	To                        Person          `json:"to"`
	Reason                    string          `json:"reason"`
	Note                      *string         `json:"note"`
	PerformedBy               Person          `json:"performed_by"`
	OutgoingTramoBusinessDays int             `json:"outgoing_tramo_business_days"`
	Snapshot                  json.RawMessage `json:"snapshot"`
}

type VacancyRef struct {
	DraftID uuid.UUID `json:"draft_id"`
	Title   string    `json:"title"`
}

// Candidate is a delivered or placed candidate as the company sees them.
type Candidate struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
}

// DeliveryRow is one delivered candidate (§3.5); DeliveredBy is null when an
// organic application landed directly in the cutoff (M3).
type DeliveryRow struct {
	Candidate   Candidate `json:"candidate"`
	ReachedAt   time.Time `json:"reached_at"`
	DeliveredBy *Person   `json:"delivered_by"`
}

// PlacementRow is one active or did_not_hold credit (§3.5, M3).
type PlacementRow struct {
	Candidate  Candidate         `json:"candidate"`
	HiredAt    time.Time         `json:"hired_at"`
	Status     string            `json:"status"`
	Recipients []PlacementPerson `json:"recipients"`
}

type PlacementPerson struct {
	Person Person `json:"person"`
	Kind   string `json:"kind"`
}

// Detail is a §3.5 response.
type Detail[T any] struct {
	header
	DraftID uuid.UUID `json:"draft_id"`
	Items   []T       `json:"items"`
}

// Vacancies lists every vacancy in scope (any activity in the period), newest
// first publication first.
func (s *Service) Vacancies(ctx context.Context, company uuid.UUID, raw string) (*VacancyList, error) {
	q, p, err := prepare(raw, RouteVacancies)
	if err != nil {
		return nil, err
	}
	from, err := after(company, RouteVacancies, q)
	if err != nil {
		return nil, err
	}
	data, err := s.store.Load(ctx, company, Scope{Period: p, Requester: q.Requester, Recruiter: q.RecruiterID})
	if err != nil {
		return nil, err
	}
	now := s.now()
	rows := []VacancyRow{}
	for _, v := range data.Vacancies {
		row := VacancyRow{
			DraftID: v.ID, Title: v.Title, Requester: v.Requester, Responsible: data.personPtr(v.Responsible),
			FirstPublishedAt: v.PublishedAt.UTC(), Closes: []CloseRow{},
			Placements: Coverage{Covered: v.activeCredits(), Required: v.Headcount},
		}
		reasons := map[string]bool{}
		for _, c := range v.closesIn(p.Start, p.End) {
			row.Closes = append(row.Closes, CloseRow{LocalDate(c.At), c.Reason})
			reasons[reasonKey(c.Reason)] = true
		}
		switch q.Outcome {
		case "filled", "cancelled", "other":
			if !reasons[q.Outcome] {
				continue
			}
		case "open":
			if len(row.Closes) > 0 {
				continue
			}
		}
		result, late := v.DeliveryResult(now, s.calendar)
		if q.DeliveryResult != "" && q.DeliveryResult != result {
			continue
		}
		d := v.Delivery
		row.Delivery = VacancyDelivery{Result: result, Target: d.Target, Delivered: v.Delivered(), CommitmentDate: d.Commitment,
			OriginalCommitmentDate: d.OriginalCommitment, Renegotiations: d.Renegotiations, BusinessDaysLate: late}
		if d.TargetReachedAt != nil {
			at := d.TargetReachedAt.UTC()
			row.Delivery.TargetReachedAt = &at
		}
		for _, r := range v.Reassigns {
			if p.Contains(r.At) {
				row.Reassignments++
			}
		}
		rows = append(rows, row)
	}
	at := func(r VacancyRow) Position {
		key := r.FirstPublishedAt.Format(time.RFC3339Nano)
		return Position{Key: &key, ID: r.DraftID}
	}
	slices.SortFunc(rows, func(a, b VacancyRow) int { return compareNewest(at(a), at(b)) })
	rows, next, err := page(company, RouteVacancies, q, rows, from, func(a, b Position) bool { return compareNewest(a, b) < 0 }, at)
	if err != nil {
		return nil, err
	}
	return &VacancyList{header: newHeader(p), Items: rows, NextCursor: next}, nil
}

// compareNewest orders time keys descending, then ids ascending. Keys are
// RFC 3339 instants in UTC, compared as times.
func compareNewest(a, b Position) int {
	ta, _ := time.Parse(time.RFC3339Nano, *a.Key)
	tb, _ := time.Parse(time.RFC3339Nano, *b.Key)
	if c := tb.Compare(ta); c != 0 {
		return c
	}
	return cmp.Compare(a.ID.String(), b.ID.String())
}

// Reassignments lists the reassignments performed in the period, newest first.
// The recruiter filter keeps the rows where that user lost or received.
func (s *Service) Reassignments(ctx context.Context, company uuid.UUID, raw string) (*ReassignmentList, error) {
	q, p, err := prepare(raw, RouteReassignments)
	if err != nil {
		return nil, err
	}
	from, err := after(company, RouteReassignments, q)
	if err != nil {
		return nil, err
	}
	data, err := s.store.Load(ctx, company, Scope{Period: p, Requester: q.Requester})
	if err != nil {
		return nil, err
	}
	rows := []ReassignmentRow{}
	for _, v := range data.Vacancies {
		for _, r := range v.Reassigns {
			if !p.Contains(r.At) || (q.RecruiterID != nil && r.From != *q.RecruiterID && r.To != *q.RecruiterID) {
				continue
			}
			row := ReassignmentRow{ID: r.ID, PerformedAt: r.At.UTC(), Vacancy: VacancyRef{v.ID, v.Title},
				From: data.person(r.From), To: data.person(r.To), Reason: r.Reason, PerformedBy: data.person(r.By),
				OutgoingTramoBusinessDays: s.calendar.BetweenInstants(r.FromStarted, r.At), Snapshot: snapshotSummary(r.Snapshot)}
			// The note exists only for `other` and appears only in detail (§2.9).
			if r.Reason == "other" {
				row.Note = r.Note
			}
			rows = append(rows, row)
		}
	}
	at := func(r ReassignmentRow) Position {
		key := r.PerformedAt.Format(time.RFC3339Nano)
		return Position{Key: &key, ID: r.ID}
	}
	slices.SortFunc(rows, func(a, b ReassignmentRow) int { return compareNewest(at(a), at(b)) })
	rows, next, err := page(company, RouteReassignments, q, rows, from, func(a, b Position) bool { return compareNewest(a, b) < 0 }, at)
	if err != nil {
		return nil, err
	}
	return &ReassignmentList{header: newHeader(p), Items: rows, NextCursor: next}, nil
}

// snapshotSummary keeps the handover state (lifecycle, delivery, placements)
// and drops the per-stage counts and tramo deadline detail.
func snapshotSummary(raw json.RawMessage) json.RawMessage {
	var full map[string]json.RawMessage
	if err := json.Unmarshal(raw, &full); err != nil {
		return json.RawMessage("null")
	}
	out := map[string]json.RawMessage{}
	for _, key := range []string{"lifecycle", "delivery", "placements"} {
		if v, ok := full[key]; ok {
			out[key] = v
		} else {
			out[key] = json.RawMessage("null")
		}
	}
	b, _ := json.Marshal(out)
	return b
}

// Deliveries lists a vacancy's delivered candidates in order and records the
// read (MetricsDetailViewed) in the same transaction.
func (s *Service) Deliveries(ctx context.Context, company, actor, draft uuid.UUID, raw string) (*Detail[DeliveryRow], error) {
	_, p, err := prepare(raw, RouteDetail)
	if err != nil {
		return nil, err
	}
	rows, err := s.store.Deliveries(ctx, company, actor, draft)
	if err != nil {
		return nil, err
	}
	return &Detail[DeliveryRow]{newHeader(p), draft, rows}, nil
}

// Placements lists a vacancy's active and did_not_hold credits and records the
// read (MetricsDetailViewed) in the same transaction.
func (s *Service) Placements(ctx context.Context, company, actor, draft uuid.UUID, raw string) (*Detail[PlacementRow], error) {
	_, p, err := prepare(raw, RouteDetail)
	if err != nil {
		return nil, err
	}
	rows, err := s.store.Placements(ctx, company, actor, draft)
	if err != nil {
		return nil, err
	}
	return &Detail[PlacementRow]{newHeader(p), draft, rows}, nil
}

// Reaches turns a vacancy's qualifying entries into its delivered candidates:
// the first entry of each participation, oldest first.
func Reaches(entries []Entry) []Entry {
	v := Vacancy{Entries: entries}
	return v.reaches()
}
