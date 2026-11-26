package schedule

import (
	"context"
	"encoding/json"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Result counts what one run did; logs carry these counts only.
type Result struct {
	DeliveryCreated   int
	AssignmentCreated int
	Resolved          int
}

// Runner is one scheduler run over the database. The run is one tx: create
// the items the date rule yields now (dedupe skips those already fired), then
// resolve stale ones, so an overdue item created in this run supersedes its
// due-soon sibling at once.
type Runner struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

// NewRunner builds the runner; a nil clock means time.Now.
func NewRunner(pool *pgxpool.Pool, now func() time.Time) *Runner {
	if now == nil {
		now = time.Now
	}
	return &Runner{pool: pool, now: now}
}

// scheduled is one row to insert.
type scheduled struct {
	recipient, company, job uuid.UUID
	typ                     domain.Type
	reason                  domain.Relation
	date                    time.Time
	payload                 map[string]any
}

// RunOnce evaluates the date rule against today in America/Mexico_City (Q8:
// the first run evaluates every current deadline, no other backfill).
func (r *Runner) RunOnce(ctx context.Context) (Result, error) {
	today := Today(r.now())
	until := pgtype.Date{Time: today.AddDate(0, 0, 1), Valid: true}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Result{}, stepErr(stepBegin, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	q := db.New(tx)

	deliveries, err := q.ListScheduledDeliveryRecipients(ctx, until)
	if err != nil {
		return Result{}, stepErr(stepDelivery, err)
	}
	assignments, err := q.ListScheduledAssignmentDeadlines(ctx, until)
	if err != nil {
		return Result{}, stepErr(stepAssignment, err)
	}
	var res Result
	for _, d := range deliveries {
		w, ok := Classify(d.CommitmentDate.Time, today)
		if !ok {
			continue
		}
		date := civil(d.CommitmentDate.Time)
		n, err := insert(ctx, q, scheduled{recipient: d.UserID, company: d.CompanyID, job: d.JobID, typ: w.DeliveryType(), reason: domain.RelationTeam,
			date: date, payload: map[string]any{"commitment_date": date.Format(time.DateOnly)}})
		if err != nil {
			return Result{}, err
		}
		res.DeliveryCreated += n
	}
	for _, a := range assignments {
		w, ok := Classify(a.RecruiterDeadline.Time, today)
		if !ok {
			continue
		}
		date := civil(a.RecruiterDeadline.Time)
		payload := map[string]any{"assignment_id": a.AssignmentID.String(), "commitment_date": date.Format(time.DateOnly)}
		if a.Function.Valid {
			payload["function"] = a.Function.String
		}
		n, err := insert(ctx, q, scheduled{recipient: a.UserID, company: a.CompanyID, job: a.JobID, typ: w.AssignmentType(), reason: domain.RelationAssignee,
			date: date, payload: payload})
		if err != nil {
			return Result{}, err
		}
		res.AssignmentCreated += n
	}
	resolved, err := q.ResolveStaleScheduledNotifications(ctx)
	if err != nil {
		return Result{}, stepErr(stepResolve, err)
	}
	res.Resolved = int(resolved)
	if err := tx.Commit(ctx); err != nil {
		return Result{}, stepErr(stepCommit, err)
	}
	return res, nil
}

// insert writes one item with a uuid v7 id and group n:<id>; 0 when the
// (recipient, type, job, date) already fired.
func insert(ctx context.Context, q *db.Queries, s scheduled) (int, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return 0, stepErr(stepInsert, err)
	}
	payload, err := json.Marshal(s.payload)
	if err != nil {
		return 0, stepErr(stepInsert, err)
	}
	n, err := q.InsertScheduledNotification(ctx, db.InsertScheduledNotificationParams{
		ID:              id,
		RecipientUserID: s.recipient,
		RecipientReason: string(s.reason),
		CompanyID:       s.company,
		Type:            string(s.typ),
		GroupKey:        "n:" + id.String(),
		JobID:           s.job,
		CommitmentDate:  pgtype.Date{Time: s.date, Valid: true},
		Payload:         payload,
	})
	if err != nil {
		return 0, stepErr(stepInsert, err)
	}
	return int(n), nil
}
