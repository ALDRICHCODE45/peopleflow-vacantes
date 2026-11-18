package application

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Summary is the company view (§3.1) plus the v2 header strip (v2 §4.1).
type Summary struct {
	header
	Vacancies      SummaryVacancies `json:"vacancies"`
	Delivery       SummaryDelivery  `json:"delivery"`
	Placements     SummaryPlacement `json:"placements"`
	Origin         Origin           `json:"origin"`
	ClosedByMonth  []ClosedMonth    `json:"closed_by_month"`
	Reassignments  SummaryReassigns `json:"reassignments"`
	ByRequester    []RequesterGroup `json:"by_requester"`
	PreviousPeriod PeriodRange      `json:"previous_period"`
	Headline       Headline         `json:"headline"`
	OnTimeByMonth  []MonthRate      `json:"on_time_by_month"`
}

// PeriodRange is a period without its time zone (the previous period).
type PeriodRange struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// Delta is a headline figure for the period and its previous period (N1).
type Delta[T any] struct {
	Current  T `json:"current"`
	Previous T `json:"previous"`
}

type Headline struct {
	OnTimeRate                Delta[Rate]     `json:"on_time_rate"`
	Assigned                  Delta[int]      `json:"assigned"`
	MedianBusinessDaysToClose Delta[*float64] `json:"median_business_days_to_close"`
	Placements                Delta[int]      `json:"placements"`
	Reassignments             Delta[int]      `json:"reassignments"`
}

// MonthRate is one point of the on-time series (N2).
type MonthRate struct {
	Month string `json:"month"`
	Rate  Rate   `json:"rate"`
}

type ClosedCounts struct {
	Filled    int `json:"filled"`
	Cancelled int `json:"cancelled"`
	Other     int `json:"other"`
	NoReason  int `json:"no_reason"`
}

func (c *ClosedCounts) add(reason *string) {
	switch reasonKey(reason) {
	case "filled":
		c.Filled++
	case "cancelled":
		c.Cancelled++
	case "other":
		c.Other++
	default:
		c.NoReason++
	}
}

type SummaryVacancies struct {
	Assigned                  int           `json:"assigned"`
	Closed                    ClosedCounts  `json:"closed"`
	MedianBusinessDaysToClose *float64      `json:"median_business_days_to_close"`
	ClosingTarget             ClosingTarget `json:"closing_target"`
}

type ClosingTarget struct {
	OnTime   int `json:"on_time"`
	Late     int `json:"late"`
	NoTarget int `json:"no_target"`
}

type SummaryDelivery struct {
	OnTime                     int      `json:"on_time"`
	Late                       int      `json:"late"`
	Overdue                    int      `json:"overdue"`
	Pending                    int      `json:"pending"`
	NotConfigured              int      `json:"not_configured"`
	Configured                 int      `json:"configured"`
	Total                      int      `json:"total"`
	OnTimeRate                 Rate     `json:"on_time_rate"`
	ConfiguredRate             Rate     `json:"configured_rate"`
	MedianBusinessDaysToTarget *float64 `json:"median_business_days_to_target"`
	Delivered                  int      `json:"delivered"`
}

type SummaryPlacement struct {
	Credits           int `json:"credits"`
	DidNotHold        int `json:"did_not_hold"`
	PositionsCovered  int `json:"positions_covered"`
	PositionsRequired int `json:"positions_required"`
}

type Origin struct {
	Portal      int `json:"portal"`
	CareersSite int `json:"careers_site"`
	Manual      int `json:"manual"`
	Unknown     int `json:"unknown"`
}

type ClosedMonth struct {
	Month string `json:"month"`
	ClosedCounts
}

type ByReason struct {
	Workload           int `json:"workload"`
	RecruiterDeparture int `json:"recruiter_departure"`
	Performance        int `json:"performance"`
	ClientRequest      int `json:"client_request"`
	Other              int `json:"other"`
}

type SummaryReassigns struct {
	Total    int      `json:"total"`
	ByReason ByReason `json:"by_reason"`
}

type RequesterGroup struct {
	Requester *Requester `json:"requester"`
	Vacancies int        `json:"vacancies"`
	Filled    int        `json:"filled"`
}

// Summary computes §3.1 and the v2 strip for the vacancies in scope; the
// previous period loads in parallel with the same filters.
func (s *Service) Summary(ctx context.Context, company uuid.UUID, raw string) (*Summary, error) {
	q, p, err := prepare(raw, RouteSummary)
	if err != nil {
		return nil, err
	}
	cur, prev, err := s.views(ctx, company, p, q)
	if err != nil {
		return nil, err
	}
	out := s.summarize(cur.data, p, cur.asOf)
	pp := p.Previous()
	before := s.summarize(prev.data, pp, prev.asOf)
	out.PreviousPeriod = PeriodRange{pp.From, pp.To}
	out.Headline = Headline{
		OnTimeRate:                Delta[Rate]{out.Delivery.OnTimeRate, before.Delivery.OnTimeRate},
		Assigned:                  Delta[int]{out.Vacancies.Assigned, before.Vacancies.Assigned},
		MedianBusinessDaysToClose: Delta[*float64]{out.Vacancies.MedianBusinessDaysToClose, before.Vacancies.MedianBusinessDaysToClose},
		Placements:                Delta[int]{out.Placements.Credits, before.Placements.Credits},
		Reassignments:             Delta[int]{out.Reassignments.Total, before.Reassignments.Total},
	}
	out.OnTimeByMonth = s.onTimeByMonth(cur.data, p, cur.asOf)
	return out, nil
}

// lastClose is the vacancy's last close in [from, to), if any (v2 V1: a
// vacancy counts once, by the reason of its last close).
func (v *Vacancy) lastClose(from, to time.Time) (Close, bool) {
	closes := v.closesIn(from, to)
	if len(closes) == 0 {
		return Close{}, false
	}
	return closes[len(closes)-1], true
}

// filledClose is the first filled close in the period of a vacancy whose last
// close in the period is filled: the close time to close and the closing
// target are judged at (v2 V1).
func (v *Vacancy) filledClose(p Period) (Close, bool) {
	if last, ok := v.lastClose(p.Start, p.End); !ok || reasonKey(last.Reason) != "filled" {
		return Close{}, false
	}
	for _, c := range v.closesIn(p.Start, p.End) {
		if reasonKey(c.Reason) == "filled" {
			return c, true
		}
	}
	return Close{}, false
}

// judge counts a filled close against the closing target in effect.
func (t *ClosingTarget) judge(c Close) {
	switch {
	case c.Target == nil:
		t.NoTarget++
	case LocalDate(c.At) <= *c.Target:
		t.OnTime++
	default:
		t.Late++
	}
}

func (s *Service) summarize(data *Dataset, p Period, now time.Time) *Summary {
	out := &Summary{header: newHeader(p, now), ClosedByMonth: []ClosedMonth{}, ByRequester: []RequesterGroup{}, OnTimeByMonth: []MonthRate{}}
	groups := map[string]*RequesterGroup{}
	group := func(v *Vacancy) *RequesterGroup {
		key := ""
		if r := v.Requester; r != nil {
			key = r.Kind
			if r.ID != nil {
				key += ":" + r.ID.String()
			}
		}
		if groups[key] == nil {
			groups[key] = &RequesterGroup{Requester: v.Requester}
		}
		return groups[key]
	}
	var toClose, toTarget []int
	for _, v := range data.Vacancies {
		// 2.1 / 2.7: assigned in the period.
		if v.assignedIn(nil, p.Start, p.End) {
			out.Vacancies.Assigned++
			group(v).Vacancies++
		}
		// 2.2 / 2.4 (v2 V1): distinct vacancies by their last close in the
		// period; filled ones measured at their first filled close.
		if last, ok := v.lastClose(p.Start, p.End); ok {
			out.Vacancies.Closed.add(last.Reason)
			// 2.4 vacancy outcome: coverage of the vacancies closed in the period.
			out.Placements.PositionsCovered += v.activeCredits()
			if v.Headcount != nil {
				out.Placements.PositionsRequired += *v.Headcount
			}
		}
		if c, ok := v.filledClose(p); ok {
			group(v).Filled++
			toClose = append(toClose, s.calendar.BetweenInstants(v.PublishedAt, c.At))
			out.Vacancies.ClosingTarget.judge(c)
		}
		// 2.3: enters by commitment date (D12) or by assignment (P1).
		if v.inDeliveryPeriod(p) {
			result, _ := v.DeliveryResult(now, s.calendar)
			d := &out.Delivery
			switch result {
			case "on_time":
				d.OnTime++
			case "late":
				d.Late++
			case "overdue":
				d.Overdue++
			case "pending":
				d.Pending++
			default:
				d.NotConfigured++
			}
			if result == "on_time" || result == "late" {
				toTarget = append(toTarget, s.calendar.BetweenInstants(v.PublishedAt, *v.Delivery.TargetReachedAt))
			}
			d.Delivered += v.Delivered()
		}
		// 2.4: credits hired in the period; did_not_hold shown apart.
		for _, c := range v.Credits {
			if p.Contains(c.HiredAt) {
				out.Placements.Credits++
				if c.Status == "did_not_hold" {
					out.Placements.DidNotHold++
				}
			}
		}
		out.Origin.add(v.Origin)
		// 2.9: reassignments performed in the period.
		for _, r := range v.Reassigns {
			if p.Contains(r.At) {
				out.Reassignments.Total++
				out.Reassignments.ByReason.add(r.Reason)
			}
		}
	}
	d := &out.Delivery
	d.Configured = d.OnTime + d.Late + d.Overdue + d.Pending
	d.Total = d.Configured + d.NotConfigured
	d.OnTimeRate = NewRate(d.OnTime, d.OnTime+d.Late+d.Overdue)
	d.ConfiguredRate = NewRate(d.Configured, d.Total)
	d.MedianBusinessDaysToTarget = Median(toTarget)
	out.Vacancies.MedianBusinessDaysToClose = Median(toClose)
	// 2.6: distinct vacancies per month by their last close that month.
	for _, m := range closedByMonth(data, p) {
		out.ClosedByMonth = append(out.ClosedByMonth, ClosedMonth{m.Month, m.ClosedCounts})
	}
	for _, g := range groups {
		out.ByRequester = append(out.ByRequester, *g)
	}
	slices.SortFunc(out.ByRequester, compareGroups)
	return out
}

// 2.5: participations created in the period, by channel.
func (o *Origin) add(byChannel map[string]int) {
	o.Portal += byChannel["portal"]
	o.CareersSite += byChannel["careers_site"]
	o.Manual += byChannel["manual"]
	o.Unknown += byChannel["unknown"]
}

func (b *ByReason) add(reason string) {
	switch reason {
	case "workload":
		b.Workload++
	case "recruiter_departure":
		b.RecruiterDeparture++
	case "performance":
		b.Performance++
	case "client_request":
		b.ClientRequest++
	default:
		b.Other++
	}
}

// compareGroups orders named requesters by name, then «sin especificar» by
// kind, then «sin solicitante» last.
func compareGroups(a, b RequesterGroup) int {
	rank := func(g RequesterGroup) int {
		switch {
		case g.Requester == nil:
			return 2
		case g.Requester.ID == nil:
			return 1
		}
		return 0
	}
	if c := cmp.Compare(rank(a), rank(b)); c != 0 {
		return c
	}
	if a.Requester == nil {
		return 0
	}
	name := func(g RequesterGroup) string {
		if g.Requester.Name == nil {
			return ""
		}
		return strings.ToLower(*g.Requester.Name)
	}
	if c := cmp.Compare(name(a), name(b)); c != 0 {
		return c
	}
	if c := cmp.Compare(a.Requester.Kind, b.Requester.Kind); c != 0 {
		return c
	}
	if a.Requester.ID == nil || b.Requester.ID == nil {
		return 0
	}
	return cmp.Compare(a.Requester.ID.String(), b.Requester.ID.String())
}
