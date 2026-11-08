package application

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Card is one recruiter's ficha (§2.8, §3.2). No score and no rank (D11).
type Card struct {
	Person
	Vacancies            CardVacancies  `json:"vacancies"`
	Delivery             CardDelivery   `json:"delivery"`
	Placements           CardPlacements `json:"placements"`
	Reassignments        CardReassigns  `json:"reassignments"`
	BusinessDaysInTramos int            `json:"business_days_in_tramos"`
}

type CardVacancies struct {
	Assigned        int `json:"assigned"`
	AsResponsible   int `json:"as_responsible"`
	AsCollaborator  int `json:"as_collaborator"`
	AsMember        int `json:"as_member"`
	StartedInPeriod int `json:"started_in_period"`
}

type CardDelivery struct {
	OnTime                     int      `json:"on_time"`
	Late                       int      `json:"late"`
	Overdue                    int      `json:"overdue"`
	MedianBusinessDaysToTarget *float64 `json:"median_business_days_to_target"`
	DeliveredInTramo           int      `json:"delivered_in_tramo"`
}

type CardPlacements struct {
	Direct         int  `json:"direct"`
	Participant    int  `json:"participant"`
	Shared         int  `json:"shared"`
	DidNotHold     int  `json:"did_not_hold"`
	ClosedAssigned int  `json:"closed_assigned"`
	Conversion     Rate `json:"conversion"`
}

type CardReassigns struct {
	Received int `json:"received"`
	Lost     int `json:"lost"`
}

// RecruiterList is §3.2.
type RecruiterList struct {
	header
	Items      []Card  `json:"items"`
	NextCursor *string `json:"next_cursor"`
}

// RecruiterDetail is §3.3: the card fields at the root (M1) plus by_month (P4).
type RecruiterDetail struct {
	header
	Card
	ByMonth []CardMonth `json:"by_month"`
}

type CardMonth struct {
	Month      string        `json:"month"`
	Assigned   int           `json:"assigned"`
	Delivery   MonthDelivery `json:"delivery"`
	Placements int           `json:"placements"`
}

type MonthDelivery struct {
	OnTime  int `json:"on_time"`
	Late    int `json:"late"`
	Overdue int `json:"overdue"`
}

// Recruiters lists one card per user with a tramo overlapping the period,
// alphabetical by name (null names last), then by user id.
func (s *Service) Recruiters(ctx context.Context, company uuid.UUID, raw string) (*RecruiterList, error) {
	q, p, err := prepare(raw, RouteRecruiters)
	if err != nil {
		return nil, err
	}
	from, err := after(company, RouteRecruiters, q)
	if err != nil {
		return nil, err
	}
	// Cards attribute across every vacancy of the requester scope; the
	// recruiter filter picks the card, it does not narrow the vacancies.
	data, err := s.store.Load(ctx, company, Scope{Period: p, Requester: q.Requester})
	if err != nil {
		return nil, err
	}
	var people []Person
	seen := map[uuid.UUID]bool{}
	for _, v := range data.Vacancies {
		for _, t := range v.Tramos {
			if seen[t.UserID] || !Overlaps(t.Start, t.End, p.Start, p.End) || (q.RecruiterID != nil && *q.RecruiterID != t.UserID) {
				continue
			}
			seen[t.UserID] = true
			people = append(people, data.person(t.UserID))
		}
	}
	at := func(person Person) Position {
		var key *string
		if person.Name != nil {
			k := strings.ToLower(*person.Name)
			key = &k
		}
		return Position{Key: key, ID: person.UserID}
	}
	slices.SortFunc(people, func(a, b Person) int { return comparePositions(at(a), at(b)) })
	people, next, err := page(company, RouteRecruiters, q, people, from, func(a, b Position) bool { return comparePositions(a, b) < 0 }, at)
	if err != nil {
		return nil, err
	}
	out := &RecruiterList{header: newHeader(p), Items: make([]Card, 0, len(people)), NextCursor: next}
	for _, person := range people {
		out.Items = append(out.Items, s.card(data, person, p))
	}
	return out, nil
}

// comparePositions orders by key with nulls last, then by id.
func comparePositions(a, b Position) int {
	switch {
	case a.Key == nil && b.Key != nil:
		return 1
	case a.Key != nil && b.Key == nil:
		return -1
	case a.Key != nil && b.Key != nil:
		if c := cmp.Compare(*a.Key, *b.Key); c != 0 {
			return c
		}
	}
	return cmp.Compare(a.ID.String(), b.ID.String())
}

// Recruiter answers §3.3; 404 when the user never had a tramo in this company.
func (s *Service) Recruiter(ctx context.Context, company, user uuid.UUID, raw string) (*RecruiterDetail, error) {
	q, p, err := prepare(raw, RouteRecruiter)
	if err != nil {
		return nil, err
	}
	had, err := s.store.HadTramo(ctx, company, user)
	if err != nil {
		return nil, err
	}
	if !had {
		return nil, ErrNotFound
	}
	data, err := s.store.Load(ctx, company, Scope{Period: p, Requester: q.Requester})
	if err != nil {
		return nil, err
	}
	person, ok := data.People[user]
	if !ok {
		// Tramos only outside the scoped vacancies: name the user anyway.
		people, err := s.store.People(ctx, company, []uuid.UUID{user})
		if err != nil {
			return nil, err
		}
		person = people[user]
		person.UserID = user
	}
	out := &RecruiterDetail{header: newHeader(p), Card: s.card(data, person, p), ByMonth: []CardMonth{}}
	now := s.now()
	for _, m := range p.Months() {
		cm := CardMonth{Month: m.Key}
		for _, v := range data.Vacancies {
			if v.assignedIn(&user, m.Start, m.End) {
				cm.Assigned++
			}
			if result, ok := s.attributedResult(v, user, now); ok && v.Delivery.Commitment != nil && p.ContainsDate(*v.Delivery.Commitment) && strings.HasPrefix(*v.Delivery.Commitment, m.Key) {
				switch result {
				case "on_time":
					cm.Delivery.OnTime++
				case "late":
					cm.Delivery.Late++
				case "overdue":
					cm.Delivery.Overdue++
				}
			}
			for _, c := range v.Credits {
				if !c.HiredAt.Before(m.Start) && c.HiredAt.Before(m.End) && slices.ContainsFunc(c.Recipients, func(r Recipient) bool { return r.UserID == user }) {
					cm.Placements++
				}
			}
		}
		out.ByMonth = append(out.ByMonth, cm)
	}
	return out, nil
}

// attributedResult is the user's delivery result on a vacancy, if the result
// is attributed to them (§2.3 per recruiter).
func (s *Service) attributedResult(v *Vacancy, user uuid.UUID, now time.Time) (string, bool) {
	result, _ := v.DeliveryResult(now, s.calendar)
	at, ok := v.deliveryMoment(result)
	if !ok {
		return "", false
	}
	return result, slices.Contains(v.attributedAt(at), user)
}

func (s *Service) card(data *Dataset, person Person, p Period) Card {
	user := person.UserID
	now := s.now()
	c := Card{Person: person}
	var toTarget []int
	closedWithCredit := 0
	for _, v := range data.Vacancies {
		// 2.1: tramo overlap, functions held in the period, tramos started in it.
		if v.assignedIn(&user, p.Start, p.End) {
			c.Vacancies.Assigned++
			held := map[string]bool{}
			for _, f := range v.Functions {
				if f.UserID == user && Overlaps(f.Start, f.End, p.Start, p.End) {
					held[f.Function] = true
				}
			}
			for function, count := range map[string]*int{"responsible": &c.Vacancies.AsResponsible, "collaborator": &c.Vacancies.AsCollaborator, "member": &c.Vacancies.AsMember} {
				if held[function] {
					*count++
				}
			}
			if slices.ContainsFunc(v.Tramos, func(t Tramo) bool { return t.UserID == user && p.Contains(t.Start) }) {
				c.Vacancies.StartedInPeriod++
			}
			// 2.4 conversion: assigned vacancies closed in the period.
			if len(v.closesIn(p.Start, p.End)) > 0 {
				c.Placements.ClosedAssigned++
				if slices.ContainsFunc(v.Credits, func(cr Credit) bool {
					return slices.ContainsFunc(cr.Recipients, func(r Recipient) bool { return r.UserID == user })
				}) {
					closedWithCredit++
				}
			}
		}
		// 2.3: results in the delivery period attributed at their moment.
		if v.Delivery.Configured && v.inDeliveryPeriod(p) {
			if result, ok := s.attributedResult(v, user, now); ok {
				switch result {
				case "on_time":
					c.Delivery.OnTime++
				case "late":
					c.Delivery.Late++
				case "overdue":
					c.Delivery.Overdue++
				}
				if result == "on_time" || result == "late" {
					toTarget = append(toTarget, s.calendar.BetweenInstants(v.PublishedAt, *v.Delivery.TargetReachedAt))
				}
			}
		}
		// 2.3 volume: candidates this recruiter put into the cutoff during
		// their tramo, in the period. Organic applies count for no recruiter.
		if v.Delivery.Configured {
			moved := map[uuid.UUID]bool{}
			for _, e := range v.Entries {
				if e.ByRecruiter && e.ActorID == user && p.Contains(e.At) && slices.ContainsFunc(v.Tramos, func(t Tramo) bool {
					return t.UserID == user && !e.At.Before(t.Start) && (t.End == nil || e.At.Before(*t.End))
				}) {
					moved[e.ParticipationID] = true
				}
			}
			c.Delivery.DeliveredInTramo += len(moved)
		}
		// 2.4: credits hired in the period by recipient kind; did_not_hold is a
		// subset of the three (P3).
		for _, cr := range v.Credits {
			if !p.Contains(cr.HiredAt) {
				continue
			}
			for _, r := range cr.Recipients {
				if r.UserID != user {
					continue
				}
				switch r.Kind {
				case "direct":
					c.Placements.Direct++
				case "participant":
					c.Placements.Participant++
				case "shared":
					c.Placements.Shared++
				}
				if cr.Status == "did_not_hold" {
					c.Placements.DidNotHold++
				}
			}
		}
		// 2.9: received and lost.
		for _, r := range v.Reassigns {
			if p.Contains(r.At) {
				if r.To == user {
					c.Reassignments.Received++
				}
				if r.From == user {
					c.Reassignments.Lost++
				}
			}
		}
		// Business days in tramos, clipped to the period and to now.
		for _, t := range v.Tramos {
			if t.UserID != user || !Overlaps(t.Start, t.End, p.Start, p.End) {
				continue
			}
			start := civilOf(t.Start)
			if first := civilDate(p.From).AddDate(0, 0, -1); start.Before(first) {
				start = first
			}
			endAt := now
			if t.End != nil {
				endAt = *t.End
			}
			end := civilOf(endAt)
			if last := civilDate(p.To); end.After(last) {
				end = last
			}
			c.BusinessDaysInTramos += s.calendar.Between(start, end)
		}
	}
	c.Delivery.MedianBusinessDaysToTarget = Median(toTarget)
	c.Placements.Conversion = NewRate(closedWithCredit, c.Placements.ClosedAssigned)
	return c
}
