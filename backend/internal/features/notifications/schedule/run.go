package schedule

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/emaildelivery"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/preferences"
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
	pool   *pgxpool.Pool
	now    func() time.Time
	email  bool
	logger *slog.Logger
}

// NewRunner builds the runner; a nil clock means time.Now. It logs through
// slog.Default() unless WithLogger is used.
func NewRunner(pool *pgxpool.Pool, now func() time.Time) *Runner {
	if now == nil {
		now = time.Now
	}
	return &Runner{pool: pool, now: now, logger: slog.Default()}
}

// WithLogger sets the logger of the run's value-free warnings (the isolated
// email step); nil keeps the current one.
func (r *Runner) WithLogger(logger *slog.Logger) *Runner {
	if logger != nil {
		r.logger = logger
	}
	return r
}

// WithEmailDeliveries turns on the email delivery decision at creation
// (notifications-v2 D8; NOTIFICATIONS_MAILER ≠ off). Off by default.
func (r *Runner) WithEmailDeliveries(enabled bool) *Runner {
	r.email = enabled
	return r
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
	var due []scheduled
	for _, d := range deliveries {
		w, ok := Classify(d.CommitmentDate.Time, today)
		if !ok {
			continue
		}
		date := civil(d.CommitmentDate.Time)
		due = append(due, scheduled{recipient: d.UserID, company: d.CompanyID, job: d.JobID, typ: w.DeliveryType(), reason: domain.RelationTeam,
			date: date, payload: map[string]any{"commitment_date": date.Format(time.DateOnly)}})
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
		due = append(due, scheduled{recipient: a.UserID, company: a.CompanyID, job: a.JobID, typ: w.AssignmentType(), reason: domain.RelationAssignee,
			date: date, payload: payload})
	}
	inApp, err := inAppOverrides(ctx, q, due)
	if err != nil {
		return Result{}, stepErr(stepPreferences, err)
	}
	var res Result
	var created []emaildelivery.Row
	for _, item := range due {
		id, n, err := insert(ctx, q, item, inApp.Effective(item.scope()))
		if err != nil {
			return Result{}, err
		}
		if item.reason == domain.RelationAssignee {
			res.AssignmentCreated += n
		} else {
			res.DeliveryCreated += n
		}
		if n == 1 {
			created = append(created, item.emailRow(id))
		}
	}
	// notifications-v2 D8: the email delivery decision, in the run's tx and
	// only for rows this run inserted (mailer off: none). Every scheduled
	// type is a single group: immediate deliveries. Isolated by a savepoint
	// (L13): an email-side failure rolls back only the email part — the run
	// still commits its rows and resolution — and is logged with step email
	// and its SQLSTATE.
	if r.email {
		isolated, err := emaildelivery.CreateIsolated(ctx, tx, created)
		if err != nil {
			return Result{}, stepErr(stepEmail, err)
		}
		if isolated != nil {
			_, sqlstate := classify(isolated)
			r.logger.Error("notification scheduler email decision rolled back", "step", string(stepEmail), "sqlstate", sqlstate)
		}
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

// scope is the override scope of an item: (recipient, company, type).
func (s scheduled) scope() domain.PreferenceKey {
	return domain.PreferenceKey{User: s.recipient, Company: s.company, Type: s.typ}
}

// emailRow is the delivery decision input of the item inserted as id.
func (s scheduled) emailRow(id uuid.UUID) emaildelivery.Row {
	return emaildelivery.Row{NotificationID: id, Recipient: s.recipient, RecipientKind: domain.RecipientMember, Company: s.company,
		Type: s.typ, GroupKey: groupKey(id), JobID: s.job}
}

// groupKey is the single group of a scheduled row (n:<id>, v1 D11).
func groupKey(id uuid.UUID) string { return "n:" + id.String() }

// inAppOverrides reads, in the run's tx and with one query, the in_app
// override rows of every item the date rule yields (notifications-v2 D6,
// D7); no read when every item is mandatory (always visible).
func inAppOverrides(ctx context.Context, q *db.Queries, due []scheduled) (*domain.Overrides, error) {
	keys := make([]domain.PreferenceKey, len(due))
	for i, item := range due {
		keys[i] = item.scope()
	}
	return preferences.ReadOverrides(ctx, q, domain.ChannelInApp, keys)
}

// insert writes one item with a uuid v7 id, group n:<id> and the given
// in_app; it returns the id and the affected rows: 1 inserted, 0 when the
// (recipient, type, job, date) already fired (its in_app is never rewritten).
func insert(ctx context.Context, q *db.Queries, s scheduled, inApp bool) (uuid.UUID, int, error) {
	id, err := uuid.NewV7()
	if err != nil {
		return uuid.Nil, 0, stepErr(stepInsert, err)
	}
	payload, err := json.Marshal(s.payload)
	if err != nil {
		return uuid.Nil, 0, stepErr(stepInsert, err)
	}
	n, err := q.InsertScheduledNotification(ctx, db.InsertScheduledNotificationParams{
		ID:              id,
		RecipientUserID: s.recipient,
		RecipientReason: string(s.reason),
		CompanyID:       s.company,
		Type:            string(s.typ),
		GroupKey:        groupKey(id),
		JobID:           s.job,
		CommitmentDate:  pgtype.Date{Time: s.date, Valid: true},
		Payload:         payload,
		InApp:           inApp,
	})
	if err != nil {
		return uuid.Nil, 0, stepErr(stepInsert, err)
	}
	return id, int(n), nil
}
