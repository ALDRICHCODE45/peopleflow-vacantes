package application

import (
	"cmp"
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The v2b list kinds (stakeholder-metrics-v2 §5.1-§5.4). Each one builds every
// row of the snapshot that passes the filters except its facet's own, counts
// the facet, applies that last filter, then sorts; pages and exports share it.

// DeliveryListRow is one vacancy of the delivery universe (§5.1).
type DeliveryListRow struct {
	Vacancy                VacancyRef `json:"vacancy"`
	Requester              *Requester `json:"requester"`
	AttributedTo           []Person   `json:"attributed_to"`
	CommitmentDate         *string    `json:"commitment_date"`
	OriginalCommitmentDate *string    `json:"original_commitment_date"`
	Renegotiations         int        `json:"renegotiations"`
	TargetReachedAt        *time.Time `json:"target_reached_at"`
	Result                 string     `json:"result"`
	BusinessDaysLate       *int       `json:"business_days_late"`
	BusinessDaysOverdue    *int       `json:"business_days_overdue"`
	Delivered              int        `json:"delivered"`
	Target                 *int       `json:"target"`
}

type DeliveryFacets struct {
	Result DeliveryStatus `json:"result"`
}

func (d *DeliveryStatus) add(result string) {
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

// lateBucket is the v2 §4.3 bucket of a late delivery.
func lateBucket(days int) string {
	switch {
	case days <= 2:
		return "up_to_2"
	case days <= 5:
		return "from_3_to_5"
	}
	return "over_5"
}

var deliveryColumns = map[string]sortColumn[DeliveryListRow]{
	"commitment_date":       {keyText, func(r DeliveryListRow) *string { return r.CommitmentDate }},
	"business_days_late":    {keyInt, func(r DeliveryListRow) *string { return intKey(r.BusinessDaysLate) }},
	"business_days_overdue": {keyInt, func(r DeliveryListRow) *string { return intKey(r.BusinessDaysOverdue) }},
	"target_reached_at":     {keyTime, func(r DeliveryListRow) *string { return timePtrKey(r.TargetReachedAt) }},
	"delivered":             {keyInt, func(r DeliveryListRow) *string { return intKey(&r.Delivered) }},
	"title":                 {keyText, func(r DeliveryListRow) *string { return textKey(r.Vacancy.Title) }},
}

// ListDeliveries answers GET …/metrics/deliveries (§5.1, not audited).
func (s *Service) ListDeliveries(ctx context.Context, company uuid.UUID, raw string) (*List[DeliveryListRow, DeliveryFacets], error) {
	l, err := prepareList(company, raw, RouteDeliveries, false)
	if err != nil {
		return nil, err
	}
	b, err := s.buildDeliveries(ctx, l)
	if err != nil {
		return nil, err
	}
	return finish(l, b)
}

func (s *Service) buildDeliveries(ctx context.Context, l listing) (*built[DeliveryListRow, DeliveryFacets], error) {
	v, err := s.listView(ctx, l, l.q.RecruiterID)
	if err != nil {
		return nil, err
	}
	q := l.q
	b := &built[DeliveryListRow, DeliveryFacets]{rows: []DeliveryListRow{}, asOf: v.asOf}
	for _, vac := range v.data.Vacancies {
		if !vac.inDeliveryPeriod(l.p) || (q.VacancyID != nil && vac.ID != *q.VacancyID) {
			continue
		}
		result, late := vac.DeliveryResult(v.asOf, s.calendar)
		d := vac.Delivery
		row := DeliveryListRow{Vacancy: VacancyRef{vac.ID, vac.Title}, Requester: vac.Requester, AttributedTo: vac.attributedPeople(result, v.data),
			CommitmentDate: d.Commitment, OriginalCommitmentDate: d.OriginalCommitment, Renegotiations: d.Renegotiations, Result: result,
			BusinessDaysLate: late, Delivered: vac.Delivered(), Target: d.Target}
		if d.TargetReachedAt != nil {
			reached := d.TargetReachedAt.UTC()
			row.TargetReachedAt = &reached
		}
		if result == "overdue" {
			n := s.calendar.Between(civilDate(*d.Commitment), civilOf(v.asOf))
			row.BusinessDaysOverdue = &n
		}
		switch {
		case q.LateBucket != "" && (late == nil || lateBucket(*late) != q.LateBucket),
			q.CommitmentMonth != "" && (d.Commitment == nil || !strings.HasPrefix(*d.Commitment, q.CommitmentMonth+"-")),
			q.AttributedTo != nil && !slices.ContainsFunc(row.AttributedTo, func(p Person) bool { return p.UserID == *q.AttributedTo }):
			continue
		}
		b.facets.Result.add(result)
		if q.Results != nil && !slices.Contains(q.Results, result) {
			continue
		}
		b.rows = append(b.rows, row)
	}
	if b.applied, b.owned, err = s.applied(ctx, l.company, q, v.all); err != nil {
		return nil, err
	}
	sortRows(l, b, deliveryColumns, func(r DeliveryListRow) uuid.UUID { return r.Vacancy.DraftID })
	return b, nil
}

type VacancyFacets struct {
	CloseReason ClosedCounts `json:"close_reason"`
}

var vacancyColumns = map[string]sortColumn[VacancyRow]{
	"opened_at": {keyTime, func(r VacancyRow) *string { return timeKey(r.OpenedAt) }},
	"last_close_date": {keyText, func(r VacancyRow) *string {
		if r.LastClose == nil {
			return nil
		}
		return &r.LastClose.Date
	}},
	"business_days_to_close": {keyInt, func(r VacancyRow) *string { return intKey(r.BusinessDaysToClose) }},
	"title":                  {keyText, func(r VacancyRow) *string { return textKey(r.Title) }},
}

// closeWindow is where the close filters look: the closed_month clipped to
// the period, else the period.
func closeWindow(p Period, month string) (time.Time, time.Time) {
	if month == "" {
		return p.Start, p.End
	}
	for _, m := range p.Months() {
		if m.Key == month {
			return m.Start, m.End
		}
	}
	return p.End, p.End // outside the period: no close falls in it
}

// Vacancies answers GET …/metrics/vacancies (§3.4 extended by v2 §5.2).
func (s *Service) Vacancies(ctx context.Context, company uuid.UUID, raw string) (*List[VacancyRow, VacancyFacets], error) {
	l, err := prepareList(company, raw, RouteVacancies, false)
	if err != nil {
		return nil, err
	}
	b, err := s.buildVacancies(ctx, l)
	if err != nil {
		return nil, err
	}
	return finish(l, b)
}

func (s *Service) buildVacancies(ctx context.Context, l listing) (*built[VacancyRow, VacancyFacets], error) {
	v, err := s.listView(ctx, l, l.q.RecruiterID)
	if err != nil {
		return nil, err
	}
	q, p, data := l.q, l.p, v.data
	from, to := closeWindow(p, q.ClosedMonth)
	b := &built[VacancyRow, VacancyFacets]{rows: []VacancyRow{}, asOf: v.asOf}
	for _, vac := range data.Vacancies {
		if q.VacancyID != nil && vac.ID != *q.VacancyID {
			continue
		}
		assigned := vac.assignedIn(nil, p.Start, p.End)
		last, closed := vac.lastClose(from, to)
		switch q.Scope {
		case "assigned":
			if !assigned {
				continue
			}
		case "closed":
			if !closed {
				continue
			}
		case "closed_assigned":
			if !assigned || !closed {
				continue
			}
		}
		if q.ClosedMonth != "" && !closed {
			continue
		}
		row := VacancyRow{
			DraftID: vac.ID, Title: vac.Title, Requester: vac.Requester, Responsible: data.personPtr(vac.Responsible),
			FirstPublishedAt: vac.PublishedAt.UTC(), OpenedAt: vac.PublishedAt.UTC(), Closes: []CloseRow{},
			Placements: Coverage{Covered: vac.activeCredits(), Required: vac.Headcount},
		}
		reasons := map[string]bool{}
		for _, c := range vac.closesIn(p.Start, p.End) {
			row.Closes = append(row.Closes, CloseRow{LocalDate(c.At), c.Reason})
			reasons[reasonKey(c.Reason)] = true
		}
		if n := len(row.Closes); n > 0 {
			lc := row.Closes[n-1]
			row.LastClose = &lc
		}
		if c, ok := vac.filledClose(p); ok {
			days := s.calendar.BetweenInstants(vac.PublishedAt, c.At)
			row.BusinessDaysToClose = &days
			var judged ClosingTarget
			judged.judge(c)
			target := map[ClosingTarget]string{{OnTime: 1}: "on_time", {Late: 1}: "late", {NoTarget: 1}: "no_target"}[judged]
			row.ClosingTarget = &target
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
		result, late := vac.DeliveryResult(v.asOf, s.calendar)
		if q.DeliveryResult != "" && q.DeliveryResult != result {
			continue
		}
		if q.ClosingTarget != "" && (row.ClosingTarget == nil || *row.ClosingTarget != q.ClosingTarget) {
			continue
		}
		if q.CreditedTo != nil && !slices.ContainsFunc(vac.Credits, func(c Credit) bool {
			return slices.ContainsFunc(c.Recipients, func(r Recipient) bool { return r.UserID == *q.CreditedTo })
		}) {
			continue
		}
		d := vac.Delivery
		row.Delivery = VacancyDelivery{Result: result, Target: d.Target, Delivered: vac.Delivered(), CommitmentDate: d.Commitment,
			OriginalCommitmentDate: d.OriginalCommitment, Renegotiations: d.Renegotiations, BusinessDaysLate: late}
		if d.TargetReachedAt != nil {
			reached := d.TargetReachedAt.UTC()
			row.Delivery.TargetReachedAt = &reached
		}
		for _, r := range vac.Reassigns {
			if p.Contains(r.At) {
				row.Reassignments++
			}
		}
		// The facet counts closed rows by the reason of their last close in
		// the close window, ignoring only close_reason.
		if closed {
			b.facets.CloseReason.add(last.Reason)
		}
		if q.CloseReasons != nil && (!closed || !slices.Contains(q.CloseReasons, reasonKey(last.Reason))) {
			continue
		}
		b.rows = append(b.rows, row)
	}
	if b.applied, b.owned, err = s.applied(ctx, l.company, q, v.all); err != nil {
		return nil, err
	}
	sortRows(l, b, vacancyColumns, func(r VacancyRow) uuid.UUID { return r.DraftID })
	return b, nil
}

// PlacementListRow is one active or did_not_hold credit hired in the period
// (§5.3); it carries the candidate's name, so its reads are audited.
type PlacementListRow struct {
	CreditID   uuid.UUID         `json:"credit_id"`
	Candidate  Candidate         `json:"candidate"`
	Vacancy    VacancyRef        `json:"vacancy"`
	Requester  *Requester        `json:"requester"`
	Recipients []PlacementPerson `json:"recipients"`
	Status     string            `json:"status"`
	HiredAt    time.Time         `json:"hired_at"`
}

type HeldFacet struct {
	True  int `json:"true"`
	False int `json:"false"`
}

type PlacementFacets struct {
	Held HeldFacet `json:"held"`
}

var placementColumns = map[string]sortColumn[PlacementListRow]{
	"hired_at":  {keyTime, func(r PlacementListRow) *string { return timeKey(r.HiredAt) }},
	"title":     {keyText, func(r PlacementListRow) *string { return textKey(r.Vacancy.Title) }},
	"candidate": {keyText, func(r PlacementListRow) *string { return textKey(r.Candidate.FullName) }},
}

// ListPlacements answers GET …/metrics/placements (§5.3). Each successful page
// writes one MetricsDetailViewed row in its own transaction before it is
// served (§6); a failed audit serves nothing.
func (s *Service) ListPlacements(ctx context.Context, company, actor uuid.UUID, raw string) (*List[PlacementListRow, PlacementFacets], error) {
	l, err := prepareList(company, raw, RoutePlacements, false)
	if err != nil {
		return nil, err
	}
	b, err := s.buildPlacements(ctx, l)
	if err != nil {
		return nil, err
	}
	out, err := finish(l, b)
	if err != nil {
		return nil, err
	}
	if err := s.store.RecordDetail(ctx, DetailAudit{Company: company, Actor: actor, Report: "placements", Vacancy: l.q.VacancyID,
		VacancyOwned: b.owned, Filters: auditFilters(l)}); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Service) buildPlacements(ctx context.Context, l listing) (*built[PlacementListRow, PlacementFacets], error) {
	v, err := s.listView(ctx, l, l.q.RecruiterID)
	if err != nil {
		return nil, err
	}
	q := l.q
	b := &built[PlacementListRow, PlacementFacets]{rows: []PlacementListRow{}, asOf: v.asOf}
	for _, vac := range v.data.Vacancies {
		if q.VacancyID != nil && vac.ID != *q.VacancyID {
			continue
		}
		for _, c := range vac.Credits {
			if !l.p.Contains(c.HiredAt) || (q.Recipient != nil && !slices.ContainsFunc(c.Recipients, func(r Recipient) bool { return r.UserID == *q.Recipient })) {
				continue
			}
			held := c.Status == "active"
			if held {
				b.facets.Held.True++
			} else {
				b.facets.Held.False++
			}
			if q.Held != nil && *q.Held != held {
				continue
			}
			recipients := slices.Clone(c.Recipients)
			slices.SortFunc(recipients, func(x, y Recipient) int {
				if c := cmp.Compare(x.Kind, y.Kind); c != 0 {
					return c
				}
				return cmp.Compare(x.UserID.String(), y.UserID.String())
			})
			row := PlacementListRow{CreditID: c.ID, Candidate: c.Candidate, Vacancy: VacancyRef{vac.ID, vac.Title}, Requester: vac.Requester,
				Recipients: make([]PlacementPerson, 0, len(recipients)), Status: c.Status, HiredAt: c.HiredAt.UTC()}
			for _, r := range recipients {
				row.Recipients = append(row.Recipients, PlacementPerson{Person: v.data.person(r.UserID), Kind: r.Kind})
			}
			b.rows = append(b.rows, row)
		}
	}
	if b.applied, b.owned, err = s.applied(ctx, l.company, q, v.all); err != nil {
		return nil, err
	}
	sortRows(l, b, placementColumns, func(r PlacementListRow) uuid.UUID { return r.CreditID })
	return b, nil
}

type ReassignmentFacets struct {
	Reason ByReason `json:"reason"`
}

var reassignmentColumns = map[string]sortColumn[ReassignmentRow]{
	"performed_at": {keyTime, func(r ReassignmentRow) *string { return timeKey(r.PerformedAt) }},
	"reason":       {keyText, func(r ReassignmentRow) *string { return &r.Reason }},
	"title":        {keyText, func(r ReassignmentRow) *string { return textKey(r.Vacancy.Title) }},
}

// Reassignments answers GET …/metrics/reassignments (§3.4 extended by v2
// §5.4). The recruiter filter keeps the rows where that user lost or
// received; direction picks one side.
func (s *Service) Reassignments(ctx context.Context, company uuid.UUID, raw string) (*List[ReassignmentRow, ReassignmentFacets], error) {
	l, err := prepareList(company, raw, RouteReassignments, false)
	if err != nil {
		return nil, err
	}
	b, err := s.buildReassignments(ctx, l)
	if err != nil {
		return nil, err
	}
	return finish(l, b)
}

func (s *Service) buildReassignments(ctx context.Context, l listing) (*built[ReassignmentRow, ReassignmentFacets], error) {
	// The recruiter filter keeps rows, not vacancies (below).
	v, err := s.listView(ctx, l, nil)
	if err != nil {
		return nil, err
	}
	q, data := l.q, v.data
	b := &built[ReassignmentRow, ReassignmentFacets]{rows: []ReassignmentRow{}, asOf: v.asOf}
	for _, vac := range data.Vacancies {
		if q.VacancyID != nil && vac.ID != *q.VacancyID {
			continue
		}
		for _, r := range vac.Reassigns {
			if !l.p.Contains(r.At) {
				continue
			}
			if u := q.RecruiterID; u != nil {
				lost, received := r.From == *u, r.To == *u
				if !(q.Direction == "lost" && lost || q.Direction == "received" && received || q.Direction == "" && (lost || received)) {
					continue
				}
			}
			b.facets.Reason.add(r.Reason)
			if q.Reasons != nil && !slices.Contains(q.Reasons, r.Reason) {
				continue
			}
			row := ReassignmentRow{ID: r.ID, PerformedAt: r.At.UTC(), Vacancy: VacancyRef{vac.ID, vac.Title},
				From: data.person(r.From), To: data.person(r.To), Reason: r.Reason, PerformedBy: data.person(r.By),
				OutgoingTramoBusinessDays: s.calendar.BetweenInstants(r.FromStarted, r.At), Snapshot: snapshotSummary(r.Snapshot)}
			// The note exists only for `other` and appears only in detail (§2.9).
			if r.Reason == "other" {
				row.Note = r.Note
			}
			b.rows = append(b.rows, row)
		}
	}
	if b.applied, b.owned, err = s.applied(ctx, l.company, q, v.all); err != nil {
		return nil, err
	}
	sortRows(l, b, reassignmentColumns, func(r ReassignmentRow) uuid.UUID { return r.ID })
	return b, nil
}
