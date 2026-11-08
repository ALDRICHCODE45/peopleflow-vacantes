package application

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The board sections of stakeholder-metrics-v2 §4: each one its own route
// with the common filters, all computed from the same snapshot.

// Closures is §4.2 (Cierres y entregas).
type Closures struct {
	header
	ClosedByMonth  []ClosuresMonth `json:"closed_by_month"`
	DeliveryStatus DeliveryStatus  `json:"delivery_status"`
}

// ClosuresMonth counts distinct vacancies closed in the month; the reasons
// split them by their last close that month, so they add up to Closed.
type ClosuresMonth struct {
	Month  string `json:"month"`
	Closed int    `json:"closed"`
	ClosedCounts
}

type DeliveryStatus struct {
	OnTime        int `json:"on_time"`
	Late          int `json:"late"`
	Overdue       int `json:"overdue"`
	Pending       int `json:"pending"`
	NotConfigured int `json:"not_configured"`
}

// Compliance is §4.3 (Cumplimiento).
type Compliance struct {
	header
	LateBuckets   LateBuckets `json:"late_buckets"`
	OnTimeByMonth []MonthRate `json:"on_time_by_month"`
}

// LateBuckets split late deliveries by business_days_late: 0–2, 3–5, > 5.
type LateBuckets struct {
	UpTo2    int `json:"up_to_2"`
	From3To5 int `json:"from_3_to_5"`
	Over5    int `json:"over_5"`
}

// Delays is §4.5 (Retrasos).
type Delays struct {
	header
	ClosingTarget         ClosingTarget `json:"closing_target"`
	Overdue               Overdue       `json:"overdue"`
	ReassignmentsByReason ByReason      `json:"reassignments_by_reason"`
}

type Overdue struct {
	Total int          `json:"total"`
	Top   []OverdueRow `json:"top"`
}

// OverdueRow is one overdue delivery (N4).
type OverdueRow struct {
	Vacancy             VacancyRef `json:"vacancy"`
	CommitmentDate      string     `json:"commitment_date"`
	BusinessDaysOverdue int        `json:"business_days_overdue"`
	Delivered           int        `json:"delivered"`
	Target              int        `json:"target"`
}

// OverdueTop bounds overdue.top.
const OverdueTop = 4

// OriginSection is §4.6 origin.
type OriginSection struct {
	header
	ByChannel Origin `json:"by_channel"`
}

// section parses a section request and returns its filtered snapshot.
func (s *Service) section(ctx context.Context, company uuid.UUID, raw string, route Route) (Period, view, error) {
	q, p, err := prepare(raw, route)
	if err != nil {
		return Period{}, view{}, err
	}
	v, err := s.view(ctx, company, p, q.Requester, q.RecruiterID)
	return p, v, err
}

// Closures answers §4.2.
func (s *Service) Closures(ctx context.Context, company uuid.UUID, raw string) (*Closures, error) {
	p, v, err := s.section(ctx, company, raw, RouteClosures)
	if err != nil {
		return nil, err
	}
	out := &Closures{header: newHeader(p, v.asOf), ClosedByMonth: closedByMonth(v.data, p)}
	for _, vac := range v.data.Vacancies {
		if !vac.inDeliveryPeriod(p) {
			continue
		}
		result, _ := vac.DeliveryResult(v.asOf, s.calendar)
		d := &out.DeliveryStatus
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
	}
	return out, nil
}

// Compliance answers §4.3.
func (s *Service) Compliance(ctx context.Context, company uuid.UUID, raw string) (*Compliance, error) {
	p, v, err := s.section(ctx, company, raw, RouteCompliance)
	if err != nil {
		return nil, err
	}
	out := &Compliance{header: newHeader(p, v.asOf), OnTimeByMonth: s.onTimeByMonth(v.data, p, v.asOf)}
	for _, vac := range v.data.Vacancies {
		if !vac.inDeliveryPeriod(p) {
			continue
		}
		if result, late := vac.DeliveryResult(v.asOf, s.calendar); result == "late" {
			switch {
			case *late <= 2:
				out.LateBuckets.UpTo2++
			case *late <= 5:
				out.LateBuckets.From3To5++
			default:
				out.LateBuckets.Over5++
			}
		}
	}
	return out, nil
}

// Delays answers §4.5.
func (s *Service) Delays(ctx context.Context, company uuid.UUID, raw string) (*Delays, error) {
	p, v, err := s.section(ctx, company, raw, RouteDelays)
	if err != nil {
		return nil, err
	}
	out := &Delays{header: newHeader(p, v.asOf), Overdue: Overdue{Top: []OverdueRow{}}}
	var overdue []OverdueRow
	for _, vac := range v.data.Vacancies {
		if c, ok := vac.filledClose(p); ok {
			out.ClosingTarget.judge(c)
		}
		for _, r := range vac.Reassigns {
			if p.Contains(r.At) {
				out.ReassignmentsByReason.add(r.Reason)
			}
		}
		if !vac.inDeliveryPeriod(p) {
			continue
		}
		if result, _ := vac.DeliveryResult(v.asOf, s.calendar); result == "overdue" {
			row := OverdueRow{Vacancy: VacancyRef{vac.ID, vac.Title}, CommitmentDate: *vac.Delivery.Commitment,
				BusinessDaysOverdue: s.calendar.Between(civilDate(*vac.Delivery.Commitment), civilOf(v.asOf)), Delivered: vac.Delivered()}
			if vac.Delivery.Target != nil {
				row.Target = *vac.Delivery.Target
			}
			overdue = append(overdue, row)
		}
	}
	// Most business days overdue first, ties by title (then id, for a stable
	// order).
	slices.SortFunc(overdue, func(a, b OverdueRow) int {
		if c := cmp.Compare(b.BusinessDaysOverdue, a.BusinessDaysOverdue); c != 0 {
			return c
		}
		if c := cmp.Compare(strings.ToLower(a.Vacancy.Title), strings.ToLower(b.Vacancy.Title)); c != 0 {
			return c
		}
		return cmp.Compare(a.Vacancy.DraftID.String(), b.Vacancy.DraftID.String())
	})
	out.Overdue.Total = len(overdue)
	out.Overdue.Top = append(out.Overdue.Top, overdue[:min(len(overdue), OverdueTop)]...)
	return out, nil
}

// Origin answers §4.6 origin.
func (s *Service) Origin(ctx context.Context, company uuid.UUID, raw string) (*OriginSection, error) {
	p, v, err := s.section(ctx, company, raw, RouteOrigin)
	if err != nil {
		return nil, err
	}
	out := &OriginSection{header: newHeader(p, v.asOf)}
	for _, vac := range v.data.Vacancies {
		out.ByChannel.add(vac.Origin)
	}
	return out, nil
}

// closedByMonth is 2.6 with v2 V1: per month the period touches, distinct
// vacancies with a close that month, split by their last close that month.
func closedByMonth(data *Dataset, p Period) []ClosuresMonth {
	months := p.Months()
	out := make([]ClosuresMonth, len(months))
	for i, m := range months {
		out[i].Month = m.Key
		for _, v := range data.Vacancies {
			if last, ok := v.lastClose(m.Start, m.End); ok {
				out[i].Closed++
				out[i].add(last.Reason)
			}
		}
	}
	return out
}

// onTimeByMonth is N2: dense over the period's months, deliveries counted by
// the month of commitment_date (D12), the 2.3 on-time rate.
func (s *Service) onTimeByMonth(data *Dataset, p Period, now time.Time) []MonthRate {
	months := p.Months()
	onTime := make([]int, len(months))
	judged := make([]int, len(months))
	for _, v := range data.Vacancies {
		d := v.Delivery
		if !d.Configured || d.Commitment == nil || !p.ContainsDate(*d.Commitment) {
			continue
		}
		result, _ := v.DeliveryResult(now, s.calendar)
		if result != "on_time" && result != "late" && result != "overdue" {
			continue
		}
		for i, m := range months {
			if strings.HasPrefix(*d.Commitment, m.Key) {
				judged[i]++
				if result == "on_time" {
					onTime[i]++
				}
			}
		}
	}
	out := make([]MonthRate, len(months))
	for i, m := range months {
		out[i] = MonthRate{m.Key, NewRate(onTime[i], judged[i])}
	}
	return out
}
