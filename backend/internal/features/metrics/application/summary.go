package application

import (
	"cmp"
	"context"
	"slices"
	"strings"

	"github.com/google/uuid"
)

// Summary is the company view (§3.1).
type Summary struct {
	header
	Vacancies     SummaryVacancies `json:"vacancies"`
	Delivery      SummaryDelivery  `json:"delivery"`
	Placements    SummaryPlacement `json:"placements"`
	Origin        Origin           `json:"origin"`
	ClosedByMonth []ClosedMonth    `json:"closed_by_month"`
	Reassignments SummaryReassigns `json:"reassignments"`
	ByRequester   []RequesterGroup `json:"by_requester"`
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

// Summary computes §3.1 for the vacancies in scope.
func (s *Service) Summary(ctx context.Context, company uuid.UUID, raw string) (*Summary, error) {
	q, p, err := prepare(raw, RouteSummary)
	if err != nil {
		return nil, err
	}
	data, err := s.store.Load(ctx, company, Scope{Period: p, Requester: q.Requester, Recruiter: q.RecruiterID})
	if err != nil {
		return nil, err
	}
	return s.summarize(data, p), nil
}

func (s *Service) summarize(data *Dataset, p Period) *Summary {
	now := s.now()
	out := &Summary{header: newHeader(p), ClosedByMonth: []ClosedMonth{}, ByRequester: []RequesterGroup{}}
	months := p.Months()
	byMonth := make([]ClosedMonth, len(months))
	for i, m := range months {
		byMonth[i].Month = m.Key
	}
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
		// 2.2 / 2.4: every close in the period counts (close → reopen → close).
		closes := v.closesIn(p.Start, p.End)
		for _, c := range closes {
			out.Vacancies.Closed.add(c.Reason)
			if reasonKey(c.Reason) != "filled" {
				continue
			}
			group(v).Filled++
			toClose = append(toClose, s.calendar.BetweenInstants(v.PublishedAt, c.At))
			switch {
			case c.Target == nil:
				out.Vacancies.ClosingTarget.NoTarget++
			case LocalDate(c.At) <= *c.Target:
				out.Vacancies.ClosingTarget.OnTime++
			default:
				out.Vacancies.ClosingTarget.Late++
			}
		}
		// 2.4 vacancy outcome: coverage of the vacancies closed in the period.
		if len(closes) > 0 {
			out.Placements.PositionsCovered += v.activeCredits()
			if v.Headcount != nil {
				out.Placements.PositionsRequired += *v.Headcount
			}
		}
		// 2.6: distinct vacancies per month and reason (D10).
		for i, m := range months {
			seen := map[string]bool{}
			for _, c := range v.closesIn(m.Start, m.End) {
				if k := reasonKey(c.Reason); !seen[k] {
					seen[k] = true
					byMonth[i].add(c.Reason)
				}
			}
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
		// 2.5: participations created in the period.
		out.Origin.Portal += v.Origin["portal"]
		out.Origin.CareersSite += v.Origin["careers_site"]
		out.Origin.Manual += v.Origin["manual"]
		out.Origin.Unknown += v.Origin["unknown"]
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
	out.ClosedByMonth = byMonth
	for _, g := range groups {
		out.ByRequester = append(out.ByRequester, *g)
	}
	slices.SortFunc(out.ByRequester, compareGroups)
	return out
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
