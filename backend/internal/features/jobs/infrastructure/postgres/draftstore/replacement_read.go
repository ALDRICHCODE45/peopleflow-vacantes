package draftstore

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// GET V/replacements (docs/contracts/replacement-processes-v1.md, «GET V/replacements»;
// feature doc L11): the chain of the logical vacancy the draft belongs to, what a start
// from this draft would take, and, when it may start, the candidates it could carry.

// namedCandidate is the {kind, id, full_name} the board shows: the company's view of
// the name (a correction of an organic candidate wins over the account's).
type namedCandidate struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	FullName string `json:"full_name"`
}

type chainCoverage struct {
	Covered  int64  `json:"covered"`
	Required *int32 `json:"required"`
}

type chainItemLifecycle struct {
	Publication string  `json:"publication"`
	Process     string  `json:"process"`
	CloseReason *string `json:"close_reason"`
	ClosedAt    *string `json:"closed_at"`
}

// chainItem is one process of the chain; Sequence is 0 for the original (L11).
type chainItem struct {
	ID                string             `json:"id"`
	Kind              string             `json:"kind"`
	Sequence          int32              `json:"sequence"`
	ReplacementOf     *string            `json:"replacement_of"`
	Title             string             `json:"title"`
	Visibility        string             `json:"visibility"`
	Lifecycle         chainItemLifecycle `json:"lifecycle"`
	StartedAt         string             `json:"started_at"`
	StartedBy         person             `json:"started_by"`
	Coverage          chainCoverage      `json:"coverage"`
	ReplacedCreditIDs []string           `json:"replaced_credit_ids"`
	CanOpen           bool               `json:"can_open"`
}

type creditRecipient struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
}

// startableCreditView is a fallen placement a start may take, with the hired candidate.
type startableCreditView struct {
	CreditID        string            `json:"credit_id"`
	ProcessID       string            `json:"process_id"`
	ParticipationID string            `json:"participation_id"`
	Candidate       namedCandidate    `json:"candidate"`
	HiredAt         string            `json:"hired_at"`
	LeftAt          *string           `json:"left_at"`
	ExitReason      *string           `json:"exit_reason"`
	Recipients      []creditRecipient `json:"recipients"`
}

// startBlock is `start_replacement`: the credits, the readiness and the carry list are
// only filled when the source may start.
type startBlock struct {
	Allowed             bool                  `json:"allowed"`
	Blocker             *string               `json:"blocker"`
	ActiveReplacementID *string               `json:"active_replacement_id"`
	StartableCredits    []startableCreditView `json:"startable_credits"`
	PublishReady        *bool                 `json:"publish_ready"`
	Missing             []string              `json:"missing"`
}

// fallenCreditView is a did_not_hold credit of the chain with what it is now (R4b): startable
// (the source may start and no replacement took it), replaced (by ReplacedByProcessID) or blocked
// (by the start_replacement blocker of the source). Unlike the startable credits it is listed
// whatever the source may do.
type fallenCreditView struct {
	ID                  string         `json:"id"`
	ParticipationID     string         `json:"participation_id"`
	ProcessID           string         `json:"process_id"`
	HiredAt             string         `json:"hired_at"`
	LeftAt              *string        `json:"left_at"`
	ExitReason          *string        `json:"exit_reason"`
	Candidate           namedCandidate `json:"candidate"`
	Status              string         `json:"status"`
	ReplacedByProcessID *string        `json:"replaced_by_process_id,omitempty"`
	Blocker             *string        `json:"blocker,omitempty"`
}

type replacementList struct {
	RootProcessID  string             `json:"root_process_id"`
	Items          []chainItem        `json:"items"`
	Start          startBlock         `json:"start_replacement"`
	Carry          []carryCandidate   `json:"carry_candidates"`
	CarryTruncated bool               `json:"carry_candidates_truncated"`
	Fallen         []fallenCreditView `json:"fallen_credits"`
}

// startFilledCodes are the readiness codes that Start itself fills on the replacement, so
// they never say anything about the source's content.
var startFilledCodes = map[string]bool{
	"request_date_missing": true, "hiring_headcount_missing": true, "delivery_cutoff_missing": true,
	"delivery_target_missing": true, "commitment_date_missing": true, "commitment_date_past": true,
}

func formatTime(at pgtype.Timestamptz) *string {
	if !at.Valid {
		return nil
	}
	v := at.Time.UTC().Format(timestampLayout)
	return &v
}

// ReadReplacements implements replacement.Store. Access is GET V/lifecycle's (owner or an
// active tramo on `id`); it reads one snapshot and writes nothing. A draft that never
// published has no process and so no chain: an empty list rooted at itself.
func (s *Store) ReadReplacements(ctx context.Context, companyID, actorID, id uuid.UUID) (drafts.Result, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return drafts.Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	record, auth, err := s.publicationDraftAs(ctx, tx, companyID, actorID, id, false)
	if err != nil {
		return drafts.Result{}, err
	}
	// The source's own lifecycle view decides the start block, so it can never disagree with GET V/lifecycle.
	view, _, err := readLifecycle(ctx, tx, id)
	if err != nil {
		return drafts.Result{}, err
	}
	out := replacementList{
		RootProcessID: view.RootProcessID, Items: []chainItem{}, Carry: []carryCandidate{},
		Fallen: []fallenCreditView{},
		Start: startBlock{
			Allowed: view.CanStartReplacement, Blocker: view.StartReplacementBlocker, ActiveReplacementID: view.ActiveReplacementID,
			StartableCredits: []startableCreditView{}, Missing: []string{},
		},
	}
	chain, found, err := readReplacementChain(ctx, tx, companyID, id)
	if err != nil {
		return drafts.Result{}, err
	}
	if found {
		if out.Items, err = readChainItems(ctx, tx, companyID, actorID, auth.role == roleOwner, chain.Root); err != nil {
			return drafts.Result{}, err
		}
	}
	if view.CanStartReplacement {
		if out.Start.StartableCredits, err = readStartableCreditViews(ctx, tx, companyID, chain.Root); err != nil {
			return drafts.Result{}, err
		}
		missing, _, err := publicationRequirements(ctx, tx, record, s.clock())
		if err != nil {
			return drafts.Result{}, err
		}
		for _, code := range missing {
			if !startFilledCodes[code] {
				out.Start.Missing = append(out.Start.Missing, code)
			}
		}
		ready := len(out.Start.Missing) == 0
		out.Start.PublishReady = &ready
		if out.Carry, out.CarryTruncated, err = readCarryCandidates(ctx, tx, companyID, chain); err != nil {
			return drafts.Result{}, err
		}
	}
	if found {
		if out.Fallen, err = readFallenCreditViews(ctx, tx, companyID, chain.Root, out.Start); err != nil {
			return drafts.Result{}, err
		}
	}
	body, err := json.Marshal(out)
	if err != nil {
		return drafts.Result{}, fmt.Errorf("encode replacements: %w", err)
	}
	return drafts.Result{Body: body}, nil
}

// readChainItems lists the processes of the chain with their live Placement coverage
// (covered / the process' headcount, the board's definition) and the credits each
// replacement took.
func readChainItems(ctx context.Context, tx pgx.Tx, companyID, actorID uuid.UUID, owner bool, root uuid.UUID) ([]chainItem, error) {
	q := db.New(tx)
	rows, err := q.ListReplacementChainItems(ctx, db.ListReplacementChainItemsParams{IsOwner: owner, ActorID: actorID, CompanyID: companyID, RootProcessID: root})
	if err != nil {
		return nil, fmt.Errorf("list replacement chain items: %w", err)
	}
	taken, err := q.ListChainReplacedCredits(ctx, db.ListChainReplacedCreditsParams{CompanyID: companyID, RootProcessID: root})
	if err != nil {
		return nil, fmt.Errorf("list replaced credits: %w", err)
	}
	replaced := map[uuid.UUID][]string{}
	for _, t := range taken {
		replaced[t.ReplacementProcessID] = append(replaced[t.ReplacementProcessID], t.PlacementCreditID.String())
	}
	items := make([]chainItem, len(rows))
	for i, row := range rows {
		item := chainItem{
			ID: row.ProcessID.String(), Kind: "original", Sequence: row.Sequence, Title: row.Title, Visibility: "public",
			Lifecycle:         chainItemLifecycle{Publication: row.Status, Process: row.ProcessStatus, ClosedAt: formatTime(row.ClosedAt)},
			StartedAt:         row.PublishedAt.Time.UTC().Format(timestampLayout),
			StartedBy:         person{ID: row.StartedByID.String(), Name: row.StartedByName},
			Coverage:          chainCoverage{},
			ReplacedCreditIDs: append([]string{}, replaced[row.ProcessID]...),
			CanOpen:           row.CanOpen,
		}
		if row.Sequence >= 1 {
			item.Kind = "replacement"
			if !row.HasProjection {
				item.Visibility = "private" // only a replacement can be private
			}
			source := row.SourceProcessID.Bytes
			text := uuid.UUID(source).String()
			item.ReplacementOf = &text
		}
		if row.CloseReason != "" {
			reason := row.CloseReason
			item.Lifecycle.CloseReason = &reason
		}
		if row.HiringHeadcount.Valid {
			required := row.HiringHeadcount.Int32
			item.Coverage.Required = &required
		}
		pipeline, _, err := readPipeline(ctx, tx, row.ProcessID)
		if err != nil {
			return nil, err
		}
		var placement string
		for _, stage := range pipeline.Stages {
			if stage.Kind == "placement" {
				placement = stage.ID
			}
		}
		if item.Coverage.Covered, _, err = db.ReadPlacementCoverage(ctx, tx, row.ProcessID, placement); err != nil {
			return nil, err
		}
		items[i] = item
	}
	return items, nil
}

// readStartableCreditViews lists the credits a start from the chain rooted at `root` may
// take, oldest hire first, with the hired candidate and the frozen recipients.
func readStartableCreditViews(ctx context.Context, tx pgx.Tx, companyID, root uuid.UUID) ([]startableCreditView, error) {
	q := db.New(tx)
	rows, err := q.ListStartableCreditDetails(ctx, db.ListStartableCreditDetailsParams{CompanyID: companyID, RootProcessID: root})
	if err != nil {
		return nil, fmt.Errorf("list startable credits: %w", err)
	}
	recipients, err := q.ListStartableCreditRecipients(ctx, db.ListStartableCreditRecipientsParams{CompanyID: companyID, RootProcessID: root})
	if err != nil {
		return nil, fmt.Errorf("list credit recipients: %w", err)
	}
	byCredit := map[uuid.UUID][]creditRecipient{}
	for _, r := range recipients {
		byCredit[r.CreditID] = append(byCredit[r.CreditID], creditRecipient{UserID: r.UserID.String(), Name: r.FullName, Kind: r.Kind})
	}
	credits := make([]startableCreditView, len(rows))
	for i, row := range rows {
		credits[i] = startableCreditView{
			CreditID: row.ID.String(), ProcessID: row.ProcessID.String(), ParticipationID: row.ParticipationID.String(),
			Candidate:  namedCandidate{Kind: row.CandidateKind, ID: row.CandidateID.String(), FullName: row.FullName},
			HiredAt:    row.HiredAt.Time.UTC().Format(timestampLayout),
			LeftAt:     formatTime(row.LeftAt),
			Recipients: append([]creditRecipient{}, byCredit[row.ID]...),
		}
		if row.ExitReason.Valid {
			reason := row.ExitReason.String
			credits[i].ExitReason = &reason
		}
	}
	return credits, nil
}

// readFallenCreditViews lists every did_not_hold credit of the chain rooted at `root`, ordered
// by departure then hire. A credit a replacement took is replaced; else it is startable when
// the source may start and the credit is one of start.StartableCredits; else it is blocked by
// the source's blocker.
func readFallenCreditViews(ctx context.Context, tx pgx.Tx, companyID, root uuid.UUID, start startBlock) ([]fallenCreditView, error) {
	rows, err := db.New(tx).ListFallenCreditDetails(ctx, db.ListFallenCreditDetailsParams{CompanyID: companyID, RootProcessID: root})
	if err != nil {
		return nil, fmt.Errorf("list fallen credits: %w", err)
	}
	startable := map[string]bool{}
	for _, c := range start.StartableCredits {
		startable[c.CreditID] = true
	}
	credits := make([]fallenCreditView, len(rows))
	for i, row := range rows {
		credits[i] = fallenCreditView{
			ID: row.ID.String(), ParticipationID: row.ParticipationID.String(), ProcessID: row.ProcessID.String(),
			HiredAt: row.HiredAt.Time.UTC().Format(timestampLayout), LeftAt: formatTime(row.LeftAt),
			Candidate: namedCandidate{Kind: row.CandidateKind, ID: row.CandidateID.String(), FullName: row.FullName},
		}
		if row.ExitReason.Valid {
			reason := row.ExitReason.String
			credits[i].ExitReason = &reason
		}
		switch {
		case row.ReplacedByProcessID.Valid:
			by := uuid.UUID(row.ReplacedByProcessID.Bytes).String()
			credits[i].Status, credits[i].ReplacedByProcessID = "replaced", &by
		case start.Allowed && startable[credits[i].ID]:
			credits[i].Status = "startable"
		default:
			credits[i].Status, credits[i].Blocker = "blocked", start.Blocker
		}
	}
	return credits, nil
}
