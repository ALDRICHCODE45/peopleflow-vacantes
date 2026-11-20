// Package replacement owns the request and the failures of starting a replacement
// process (docs/contracts/replacement-processes-v1.md, «POST V/replacements»).
// The store does the IO; nothing here touches the database.
package replacement

import (
	"context"
	"sort"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/businesscalendar"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/deliveryconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/lifecycle"
	"github.com/google/uuid"
)

// MaxCredits bounds placement_credit_ids and target_quantity (the delivery and
// headcount columns are 1..999).
const MaxCredits = 999

// MaxCarried bounds carried_candidates per request (contract «Carried candidates»).
const MaxCarried = 200

// Candidate kinds of a carried candidate: a company candidate or an organic user.
const (
	KindManual  = "manual"
	KindOrganic = "organic"
)

// Store starts a replacement from the source process `id`. key/ifMatch follow the
// lifecycle transitions: Idempotency-Key and the source's lifecycle ETag.
type Store interface {
	StartReplacement(ctx context.Context, companyID, actorID, id uuid.UUID, key string, keyPresent bool, ifMatch string, present bool, body []byte) (drafts.Result, error)
}

// CarriedCandidate is one reused candidate: the {kind, id} identity the manual
// intake and the talent pool share, and the stage chosen among the SOURCE
// process' stages (the store maps it to the replacement's).
type CarriedCandidate struct {
	Kind    string
	ID      uuid.UUID
	StageID uuid.UUID
}

// Request is a decoded, validated start body. TargetQuantity is already
// defaulted to the number of credits.
type Request struct {
	CreditIDs      []uuid.UUID
	TargetQuantity int
	CommitmentDate string
	// Responsible is nil when the caller is the responsible.
	Responsible *uuid.UUID
	// Carried is nil when no candidate is reused.
	Carried []CarriedCandidate
}

// Field is one rejected body field (400 validation_error `fields[]`).
type Field struct {
	Field string
	Code  string
}

// Invalid carries every field error of one rejected body, in contract order.
type Invalid struct{ Fields []Field }

func (e *Invalid) Error() string { return "replacement: validation failed" }

// SourceNotClosed is the 409 of a source that is open, paused or never published.
type SourceNotClosed struct {
	Lifecycle lifecycle.View `json:"lifecycle"`
}

func (e *SourceNotClosed) Error() string { return "replacement: source not closed" }

// SourceNotLatest is the 409 of a source that already has a successor (D14).
type SourceNotLatest struct {
	LatestProcessID string         `json:"latest_process_id"`
	RootProcessID   string         `json:"root_process_id"`
	Lifecycle       lifecycle.View `json:"lifecycle"`
}

func (e *SourceNotLatest) Error() string { return "replacement: source not latest" }

// Credit rejection reasons.
const (
	CreditNotInChain      = "not_in_chain"
	CreditNotDidNotHold   = "not_did_not_hold"
	CreditAlreadyReplaced = "already_replaced"
)

// CreditProblem names one requested credit that cannot be replaced.
type CreditProblem struct {
	CreditID string `json:"credit_id"`
	Reason   string `json:"reason"`
}

// CreditsInvalid is the 422 of credits that are not startable, in request order.
type CreditsInvalid struct {
	Credits []CreditProblem `json:"credits"`
}

func (e *CreditsInvalid) Error() string { return "replacement: credits invalid" }

// Carried candidate rejection reasons (contract «Error codes»).
const (
	CandidateNotInChain      = "not_in_chain"
	CandidateCurrentlyPlaced = "currently_placed"
	CandidateDuplicate       = "duplicate"
	StageNotFound            = "stage_not_found"
	StageIsPlacement         = "stage_is_placement"
	StageIsExit              = "stage_is_exit"
)

// CarriedProblem names one carried candidate, by its index in the request, that cannot be reused.
type CarriedProblem struct {
	Index  int    `json:"index"`
	Reason string `json:"reason"`
}

// CarriedCandidatesInvalid is the 422 of candidates that cannot be reused: only
// the problems, in request order. It outranks CarriedStagesInvalid.
type CarriedCandidatesInvalid struct {
	Candidates []CarriedProblem `json:"candidates"`
}

func (e *CarriedCandidatesInvalid) Error() string { return "replacement: carried candidates invalid" }

// CarriedStagesInvalid is the 422 of valid candidates whose chosen stage is not
// allowed: only the problems, in request order.
type CarriedStagesInvalid struct {
	Candidates []CarriedProblem `json:"candidates"`
}

func (e *CarriedStagesInvalid) Error() string { return "replacement: carried stages invalid" }

// Decode reads the start body. Shape errors (not an object, unknown key, wrong
// type, bad ids, duplicates, a missing required key) are drafts.ErrInvalidRequest;
// then range errors are *Invalid; a non-business commitment date is
// deliveryconfig.ErrNonBusinessDate only when nothing else is wrong. `publish: true`
// belongs to slice R3c: it is rejected as invalid_request instead of being silently
// ignored. A carried candidate that is well formed is decoded as is (duplicates
// included): whether the candidate or its stage can be reused is the store's call.
func Decode(body []byte, calendar deliveryconfig.Calendar) (Request, error) {
	value, err := draftjson.Decode(body)
	if err != nil {
		return Request{}, drafts.ErrInvalidRequest
	}
	root, ok := value.(map[string]any)
	if !ok {
		return Request{}, drafts.ErrInvalidRequest
	}
	for key := range root {
		switch key {
		case "placement_credit_ids", "target_quantity", "commitment_date", "responsible", "publish", "carried_candidates":
		default:
			return Request{}, drafts.ErrInvalidRequest
		}
	}
	var req Request
	raw, ok := root["placement_credit_ids"].([]any)
	if !ok || len(raw) == 0 || len(raw) > MaxCredits {
		return Request{}, drafts.ErrInvalidRequest
	}
	seen := map[uuid.UUID]bool{}
	for _, item := range raw {
		text, ok := item.(string)
		id, err := uuid.Parse(text)
		if !ok || err != nil || id.String() != text || seen[id] {
			return Request{}, drafts.ErrInvalidRequest
		}
		seen[id] = true
		req.CreditIDs = append(req.CreditIDs, id)
	}
	req.TargetQuantity = len(req.CreditIDs)
	var target *int64
	if raw := root["target_quantity"]; raw != nil {
		v, ok := raw.(int64)
		if !ok {
			return Request{}, drafts.ErrInvalidRequest
		}
		target = &v
	}
	date, ok := root["commitment_date"].(string)
	var day time.Time
	if ok {
		day, err = time.Parse(time.DateOnly, date)
		ok = err == nil && day.Format(time.DateOnly) == date
	}
	if !ok {
		return Request{}, drafts.ErrInvalidRequest
	}
	req.CommitmentDate = date
	if raw := root["responsible"]; raw != nil {
		object, ok := raw.(map[string]any)
		text, _ := object["user_id"].(string)
		id, err := uuid.Parse(text)
		if !ok || len(object) != 1 || err != nil || id.String() != text {
			return Request{}, drafts.ErrInvalidRequest
		}
		req.Responsible = &id
	}
	if raw := root["publish"]; raw != nil {
		if publish, ok := raw.(bool); !ok || publish {
			return Request{}, drafts.ErrInvalidRequest
		}
	}
	if raw := root["carried_candidates"]; raw != nil {
		list, ok := raw.([]any)
		if !ok {
			return Request{}, drafts.ErrInvalidRequest
		}
		for _, item := range list {
			carried, ok := decodeCarried(item)
			if !ok {
				return Request{}, drafts.ErrInvalidRequest
			}
			req.Carried = append(req.Carried, carried)
		}
	}

	var fields []Field
	if target != nil {
		switch {
		case *target < 1 || *target > MaxCredits:
			fields = append(fields, Field{"target_quantity", "out_of_range"})
		case int(*target) < len(req.CreditIDs):
			fields = append(fields, Field{"target_quantity", "below_credits_count"})
		default:
			req.TargetQuantity = int(*target)
		}
	}
	if date < calendar.MinDate || date > calendar.MaxDate {
		fields = append(fields, Field{"commitment_date", "out_of_range"})
	}
	if len(req.Carried) > MaxCarried {
		fields = append(fields, Field{"carried_candidates", "out_of_range"})
	}
	if len(fields) > 0 {
		return Request{}, &Invalid{Fields: fields}
	}
	if !businesscalendar.IsBusinessDay(day) {
		return Request{}, deliveryconfig.ErrNonBusinessDate
	}
	return req, nil
}

// decodeCarried reads {"candidate": {"kind", "id"}, "stage_id"}: exactly those
// keys, a known kind and canonical lowercase UUIDs.
func decodeCarried(raw any) (CarriedCandidate, bool) {
	item, ok := raw.(map[string]any)
	if !ok || len(item) != 2 {
		return CarriedCandidate{}, false
	}
	candidate, ok := item["candidate"].(map[string]any)
	if !ok || len(candidate) != 2 {
		return CarriedCandidate{}, false
	}
	kind, ok := candidate["kind"].(string)
	if !ok || (kind != KindManual && kind != KindOrganic) {
		return CarriedCandidate{}, false
	}
	id, ok := canonicalUUID(candidate["id"])
	if !ok {
		return CarriedCandidate{}, false
	}
	stage, ok := canonicalUUID(item["stage_id"])
	if !ok {
		return CarriedCandidate{}, false
	}
	return CarriedCandidate{Kind: kind, ID: id, StageID: stage}, true
}

func canonicalUUID(raw any) (uuid.UUID, bool) {
	text, ok := raw.(string)
	if !ok {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(text)
	return id, err == nil && id.String() == text
}

// SortedCreditIDs is the credit list in canonical (sorted) order, for audit metadata.
func (r Request) SortedCreditIDs() []string {
	out := make([]string, len(r.CreditIDs))
	for i, id := range r.CreditIDs {
		out[i] = id.String()
	}
	sort.Strings(out)
	return out
}
