package fanout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// BatchSize bounds the events one instance claims per tick (D4).
	BatchSize = 100
	// MaxAttempts is when a failing event is given up (§Scheduler).
	MaxAttempts = 10
	// RetryBase and RetryCap shape the backoff after the n-th failed attempt:
	// RetryBase·2^(n-1), at most RetryCap (30 s … 30 min; ~2 h over 10 attempts).
	RetryBase = 30 * time.Second
	RetryCap  = 30 * time.Minute
)

// Processor claims and fans out pending events. Every instance runs one; the
// row lock (FOR UPDATE SKIP LOCKED) keeps two instances off the same event,
// and the dedupe unique keeps a re-processed event from notifying twice.
type Processor struct {
	pool        *pgxpool.Pool
	planner     Planner
	batch       int
	maxAttempts int
	logger      *slog.Logger
}

// NewProcessor builds the stage-1 processor; a nil logger means slog.Default().
func NewProcessor(pool *pgxpool.Pool, planner Planner, logger *slog.Logger) *Processor {
	if logger == nil {
		logger = slog.Default()
	}
	return &Processor{pool: pool, planner: planner, batch: BatchSize, maxAttempts: MaxAttempts, logger: logger}
}

// Tick processes up to BatchSize due events, oldest first. Each event is
// claimed, resolved, inserted and marked processed in its own tx; a failed or
// panicking event is rolled back, its attempt is recorded in a separate tx
// (with backoff), and it is not retried in the same tick, so it never blocks
// later events. It returns the number of events claimed and stops early only
// when the claim itself fails (database unavailable, shutdown).
func (p *Processor) Tick(ctx context.Context) (int, error) {
	tried := []uuid.UUID{}
	for len(tried) < p.batch {
		event, claimed, err := p.processNext(ctx, tried)
		if !claimed {
			return len(tried), err
		}
		tried = append(tried, event.ID)
		if err != nil {
			if ctx.Err() != nil {
				return len(tried), ctx.Err() // shutdown: not an attempt
			}
			p.recordFailure(ctx, event, err)
		}
	}
	return len(tried), nil
}

// processNext claims one event and runs it in the claiming tx. claimed=false
// with err=nil means nothing is due; claimed=false with an error means the
// claim failed; claimed=true with an error is a failed attempt. A panic while
// processing is recovered here (the deferred rollback still runs) and becomes
// a failed attempt; its value is dropped.
func (p *Processor) processNext(ctx context.Context, skip []uuid.UUID) (event Event, claimed bool, err error) {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return Event{}, false, stepErr(stepBegin, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	q := db.New(tx)
	row, err := q.ClaimNextNotificationEvent(ctx, skip)
	if errors.Is(err, pgx.ErrNoRows) {
		return Event{}, false, nil
	}
	if err != nil {
		return Event{}, false, stepErr(stepClaim, err)
	}
	event = Event{ID: row.ID, EventType: row.EventType}
	defer func() {
		if recover() != nil {
			claimed, err = true, stepErr(stepPanic, errPanic)
		}
	}()
	return p.process(ctx, tx, q, row)
}

func (p *Processor) process(ctx context.Context, tx pgx.Tx, q *db.Queries, row db.ClaimNextNotificationEventRow) (Event, bool, error) {
	event, err := toEvent(row)
	if err != nil {
		return event, true, stepErr(stepDecode, err)
	}
	notifications, err := p.planner.Plan(ctx, directory{q}, event)
	if err != nil {
		return event, true, stepErr(stepPlan, err)
	}
	for _, n := range notifications {
		if err := insert(ctx, q, n); err != nil {
			return event, true, stepErr(stepInsert, fmt.Errorf("insert %s notification: %w", n.Type, err))
		}
	}
	if err := q.MarkNotificationEventProcessed(ctx, event.ID); err != nil {
		return event, true, stepErr(stepMark, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return event, true, stepErr(stepCommit, err)
	}
	return event, true, nil
}

// recordFailure counts one attempt in its own tx and schedules the next one
// with backoff; at MaxAttempts the event is failed and processed. Logs carry
// the event type, id, failing step and SQLSTATE only (no payload, no message:
// a constraint error can quote values).
func (p *Processor) recordFailure(ctx context.Context, event Event, cause error) {
	step, sqlstate := classify(cause)
	attrs := []any{"event_type", event.EventType, "notification_event_id", event.ID.String(), "step", step, "sqlstate", sqlstate}
	res, err := db.New(p.pool).RecordNotificationEventFailure(ctx, db.RecordNotificationEventFailureParams{ID: event.ID, MaxAttempts: int32(p.maxAttempts),
		RetryBaseMs: RetryBase.Milliseconds(), RetryCapMs: RetryCap.Milliseconds()})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// Processed meanwhile by another instance.
	case err != nil:
		_, recordState := classify(err)
		p.logger.Error("notification fan-out attempt not recorded", append(attrs, "record_sqlstate", recordState)...)
	case res.Failed:
		p.logger.Error("notification fan-out gave up", append(attrs, "attempts", res.Attempts)...)
	default:
		p.logger.Warn("notification fan-out attempt failed", append(attrs, "attempts", res.Attempts)...)
	}
}

func toEvent(row db.ClaimNextNotificationEventRow) (Event, error) {
	e := Event{ID: row.ID, CompanyID: row.CompanyID, EventType: row.EventType, JobID: row.JobID, OccurredAt: row.OccurredAt.Time,
		ActorUserID: ptrUUID(row.ActorUserID), ParticipationID: ptrUUID(row.ParticipationID), SubjectUserID: ptrUUID(row.SubjectUserID)}
	if err := json.Unmarshal(row.Payload, &e.Payload); err != nil {
		return e, fmt.Errorf("decode event payload: %w", err)
	}
	if e.Payload == nil {
		e.Payload = map[string]any{}
	}
	return e, nil
}

func insert(ctx context.Context, q *db.Queries, n Notification) error {
	payload, err := json.Marshal(n.Payload)
	if err != nil {
		return err
	}
	return q.InsertNotification(ctx, db.InsertNotificationParams{
		ID:              n.ID,
		RecipientUserID: n.RecipientUserID,
		RecipientKind:   string(n.RecipientKind),
		RecipientReason: string(n.Reason),
		CompanyID:       nullable(n.CompanyID),
		Type:            string(n.Type),
		GroupKey:        n.GroupKey,
		JobID:           n.JobID,
		ParticipationID: nullable(n.ParticipationID),
		ActorUserID:     nullable(n.ActorUserID),
		SourceEventID:   n.SourceEventID,
		Payload:         payload,
	})
}

// directory is the Directory over the fan-out tx.
type directory struct{ q *db.Queries }

func (d directory) Team(ctx context.Context, company, job uuid.UUID) ([]uuid.UUID, error) {
	return d.q.ListNotificationTeamRecipients(ctx, db.ListNotificationTeamRecipientsParams{CompanyID: company, JobID: job})
}

func (d directory) ActiveAssignee(ctx context.Context, company, job, user uuid.UUID) (bool, error) {
	return d.q.IsNotificationActiveAssignee(ctx, db.IsNotificationActiveAssigneeParams{CompanyID: company, JobID: job, UserID: user})
}

func (d directory) Member(ctx context.Context, company, user uuid.UUID) (bool, error) {
	return d.q.IsNotificationCompanyMember(ctx, db.IsNotificationCompanyMemberParams{CompanyID: company, UserID: user})
}

func (d directory) Candidate(ctx context.Context, job, participation uuid.UUID) (*uuid.UUID, error) {
	id, err := d.q.GetNotificationParticipationCandidate(ctx, db.GetNotificationParticipationCandidateParams{ParticipationID: participation, JobID: job})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // participation gone or on another job: nobody
	}
	if err != nil {
		return nil, err
	}
	return ptrUUID(id), nil
}

func ptrUUID(id pgtype.UUID) *uuid.UUID {
	if !id.Valid {
		return nil
	}
	u := uuid.UUID(id.Bytes)
	return &u
}

func nullable(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}
