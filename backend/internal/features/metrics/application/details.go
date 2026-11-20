package application

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

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
	// v2 §5.2
	OpenedAt            time.Time `json:"opened_at"`
	LastClose           *CloseRow `json:"last_close"`
	BusinessDaysToClose *int      `json:"business_days_to_close"`
	ClosingTarget       *string   `json:"closing_target"`
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
	q, p, err := prepare(raw, RouteDetail)
	if err != nil {
		return nil, err
	}
	rows, _, err := s.store.Deliveries(ctx, company, actor, draft, q.ProcessKind)
	if err != nil {
		return nil, err
	}
	return &Detail[DeliveryRow]{newHeader(p, s.now()), draft, rows}, nil
}

// Placements lists a vacancy's active and did_not_hold credits and records the
// read (MetricsDetailViewed) in the same transaction.
func (s *Service) Placements(ctx context.Context, company, actor, draft uuid.UUID, raw string) (*Detail[PlacementRow], error) {
	q, p, err := prepare(raw, RouteDetail)
	if err != nil {
		return nil, err
	}
	rows, _, err := s.store.Placements(ctx, company, actor, draft, q.ProcessKind)
	if err != nil {
		return nil, err
	}
	return &Detail[PlacementRow]{newHeader(p, s.now()), draft, rows}, nil
}

// Reaches turns a vacancy's qualifying entries into its delivered candidates:
// the first entry of each participation, oldest first.
func Reaches(entries []Entry) []Entry {
	v := Vacancy{Entries: entries}
	return v.reaches()
}
