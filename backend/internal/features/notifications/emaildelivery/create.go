// Package emaildelivery makes the email delivery decision of newly created
// notifications (notifications-v2 D8–D10, D19, §Email delivery / Creation).
// The fan-out and the scheduler call Create in the tx that inserted the rows,
// with only the rows actually inserted (affected rows = 1), so a re-processed
// event or a scheduler re-run (D21 dedupe) never creates a second delivery.
// It never reads or copies the recipient's address (D19).
package emaildelivery

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/preferences"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Row is one notification inserted by the caller's tx.
type Row struct {
	NotificationID uuid.UUID
	Recipient      uuid.UUID
	RecipientKind  domain.RecipientKind
	Company        uuid.UUID // uuid.Nil = candidate (company_id NULL, D1)
	Type           domain.Type
	GroupKey       string
	JobID          uuid.UUID
}

func (r Row) key() domain.PreferenceKey {
	return domain.PreferenceKey{User: r.Recipient, Company: r.Company, Type: r.Type}
}

// errNotLinked means the link update matched no row: the notification was
// not inserted by this tx or already had a delivery (a caller bug).
var errNotLinked = errors.New("notification not linkable to its email delivery")

// Create decides, for each row in order, whether it is eligible for email
// (D9: effective email preference on — mandatory always — ∧ recipient live
// with a non-empty address ∧ normalized address not suppressed; the mailer
// gate is the caller's) and, if so, creates or joins its delivery and links
// the row: grouped types upsert the open 10-minute window of (recipient,
// group_key), every other type gets one immediate delivery (D10). Reads are
// batched: one override read for the email channel (skipped when every type
// is mandatory) and one deliverability read for the recipients still
// eligible (skipped when none is). An error leaves the tx aborted: run it
// through CreateIsolated so only the email part is rolled back (L13).
func Create(ctx context.Context, q *db.Queries, rows []Row) error {
	if len(rows) == 0 {
		return nil
	}
	prefs, err := emailOverrides(ctx, q, rows)
	if err != nil {
		return fmt.Errorf("email preferences: %w", err)
	}
	wanted := make([]Row, 0, len(rows))
	users := []uuid.UUID{}
	seen := map[uuid.UUID]bool{}
	for _, r := range rows {
		if !prefs.Effective(r.key()) {
			continue
		}
		wanted = append(wanted, r)
		if !seen[r.Recipient] {
			seen[r.Recipient] = true
			users = append(users, r.Recipient)
		}
	}
	if len(wanted) == 0 {
		return nil
	}
	ids, err := q.ListNotificationEmailDeliverableUsers(ctx, users)
	if err != nil {
		return fmt.Errorf("email deliverability: %w", err)
	}
	deliverable := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		deliverable[id] = true
	}
	for _, r := range wanted {
		if !deliverable[r.Recipient] {
			continue
		}
		if err := create(ctx, q, r); err != nil {
			return fmt.Errorf("email delivery for %s: %w", r.Type, err)
		}
	}
	return nil
}

// CreateIsolated runs Create inside a savepoint of the caller's tx
// (notifications-v2 D8 as refined by L13 and L20). A non-transient failure
// (constraint, missing object, a link that cannot be made — retrying would
// fail the same way) is rolled back to the savepoint only, so the caller
// keeps its in-app rows and commits; that batch simply gets no delivery, and
// isolated carries the error for the caller to log with step email and its
// SQLSTATE. A transient failure (see transient) is returned as err without
// isolation: the caller's tx must fail so its own retry absorbs it (the
// fan-out's v1 backoff, the scheduler's next run) and the email decision is
// made again. err also covers a savepoint that could not be opened, released
// or rolled back.
func CreateIsolated(ctx context.Context, tx pgx.Tx, rows []Row) (isolated, err error) {
	if len(rows) == 0 {
		return nil, nil
	}
	sp, err := tx.Begin(ctx) // SAVEPOINT
	if err != nil {
		return nil, err
	}
	if cerr := Create(ctx, db.New(sp), rows); cerr != nil {
		if transient(cerr) {
			return nil, cerr
		}
		if rerr := sp.Rollback(ctx); rerr != nil { // ROLLBACK TO SAVEPOINT
			return cerr, rerr
		}
		return cerr, nil
	}
	return nil, sp.Commit(ctx) // RELEASE SAVEPOINT
}

// transient reports an email-step failure that a retry may cure: SQLSTATE
// 40001 (serialization), 40P01 (deadlock), 55P03 (lock not available),
// 57014 (statement timeout / cancel), any connection-class 08 error, and every
// non-database error except errNotLinked (a cancelled context, a lost
// connection, a network error).
func transient(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "40001", "40P01", "55P03", "57014":
			return true
		}
		return strings.HasPrefix(pgErr.Code, "08")
	}
	return !errors.Is(err, errNotLinked)
}

// create inserts or joins the row's delivery and links the row to it.
func create(ctx context.Context, q *db.Queries, r Row) error {
	id, err := uuid.NewV7()
	if err != nil {
		return err
	}
	company := pgtype.UUID{}
	if r.Company != uuid.Nil {
		company = pgtype.UUID{Bytes: r.Company, Valid: true}
	}
	if domain.Coalesced(r.Type) {
		id, err = q.UpsertCoalescedNotificationEmailDelivery(ctx, db.UpsertCoalescedNotificationEmailDeliveryParams{ID: id, RecipientUserID: r.Recipient,
			RecipientKind: string(r.RecipientKind), CompanyID: company, Type: string(r.Type), GroupKey: r.GroupKey, JobID: r.JobID})
	} else {
		err = q.InsertImmediateNotificationEmailDelivery(ctx, db.InsertImmediateNotificationEmailDeliveryParams{ID: id, RecipientUserID: r.Recipient,
			RecipientKind: string(r.RecipientKind), CompanyID: company, Type: string(r.Type), GroupKey: r.GroupKey, JobID: r.JobID})
	}
	if err != nil {
		return err
	}
	linked, err := q.LinkNotificationEmailDelivery(ctx, db.LinkNotificationEmailDeliveryParams{DeliveryID: id, NotificationID: r.NotificationID})
	if err != nil {
		return err
	}
	if linked != 1 {
		return errNotLinked
	}
	return nil
}

// emailOverrides reads the email override rows of every row's (recipient,
// company, type) with one query; no read when every type is mandatory.
func emailOverrides(ctx context.Context, q *db.Queries, rows []Row) (*domain.Overrides, error) {
	keys := make([]domain.PreferenceKey, len(rows))
	for i, r := range rows {
		keys[i] = r.key()
	}
	return preferences.ReadOverrides(ctx, q, domain.ChannelEmail, keys)
}
