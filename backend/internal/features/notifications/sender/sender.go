// Package sender is the notifications email sender loop (notifications-v2
// D11, D12, §Sender): every instance claims due deliveries one at a time
// (FOR UPDATE SKIP LOCKED, a short autocommit claim that sets a lease),
// re-checks them outside any transaction (D11 skip reasons), renders and
// sends through the Mailer with no transaction open, and finalizes fenced on
// the lease so a stale sender can never overwrite a newer outcome. Transient
// failures retry with backoff up to 8 attempts, permanent ones fail at once;
// sends are paced per instance. Delivery is at-least-once: a crash between
// the provider's acceptance and the finalize resends after the lease expires
// (the stable Message-ID lets clients collapse it). The package name avoids
// worker/outbox (archguard).
package sender

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/db"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// Interval is the sender period (§Sender, §Limits).
	Interval = 5 * time.Second
	// BatchSize bounds the deliveries one instance claims per tick.
	BatchSize = 20
	// Lease is how long a claimed delivery stays with its sender.
	Lease = 2 * time.Minute
	// SendTimeout bounds one Mailer call.
	SendTimeout = 15 * time.Second
	// MaxAttempts is when a transiently failing delivery is given up.
	MaxAttempts = 8
	// RetryBase and RetryCap shape the backoff after the n-th attempt:
	// RetryBase·2^(n-1), at most RetryCap (1 min … 1 h).
	RetryBase = time.Minute
	RetryCap  = time.Hour
	// finalizeTimeout bounds the finalize, which runs even when the tick's
	// context was cancelled (shutdown) so a claimed row never waits for its
	// lease to expire.
	finalizeTimeout = 10 * time.Second
)

// Skip reasons of the D11 re-check (the skip_reason CHECK values).
const (
	SkipRecipientGone = "recipient_gone"
	SkipNoAddress     = "no_address"
	SkipSuppressed    = "suppressed"
	SkipPreferenceOff = "preference_off"
	SkipResolved      = "resolved"
	SkipRead          = "read"
)

// Renderer turns a delivery view into a Message (*email.Renderer).
type Renderer interface {
	Render(v email.View) (email.Message, error)
}

// Sender claims, re-checks, sends and finalizes deliveries. Every instance
// runs one; SKIP LOCKED and the lease keep two instances off the same row.
type Sender struct {
	pool        *pgxpool.Pool
	renderer    Renderer
	mailer      email.Mailer
	throttle    Throttle
	logger      *slog.Logger
	batch       int
	lease       time.Duration
	maxAttempts int
	sendTimeout time.Duration
}

// New builds a sender; a nil throttle means NewBucket(1) (the default rate)
// and a nil logger slog.Default().
func New(pool *pgxpool.Pool, renderer Renderer, mailer email.Mailer, throttle Throttle, logger *slog.Logger) *Sender {
	if throttle == nil {
		throttle = NewBucket(1, nil, nil)
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Sender{pool: pool, renderer: renderer, mailer: mailer, throttle: throttle, logger: logger,
		batch: BatchSize, lease: Lease, maxAttempts: MaxAttempts, sendTimeout: SendTimeout}
}

// claimed is one delivery taken by this sender: its lease fences the finalize.
type claimed struct {
	id, user, job uuid.UUID
	company       uuid.UUID // uuid.Nil = candidate
	typ           domain.Type
	attempt       int32
	lease         pgtype.Timestamptz
}

type outcome int

const (
	outcomeSent outcome = iota
	outcomeSkipped
	outcomeTransient
	outcomePermanent
)

// result is what one attempt decided; cause is a stepError (never logged
// beyond its step and SQLSTATE).
type result struct {
	outcome  outcome
	provider string
	skip     string
	cause    error
}

// Tick processes up to BatchSize due deliveries, oldest first, each claimed,
// attempted and finalized on its own. It returns the number claimed and stops
// early when nothing is due, the claim fails (database unavailable) or ctx
// ends.
func (s *Sender) Tick(ctx context.Context) (int, error) {
	n := 0
	for n < s.batch {
		if ctx.Err() != nil {
			return n, nil
		}
		ok, err := s.processNext(ctx)
		if !ok {
			return n, err
		}
		n++
	}
	return n, nil
}

// processNext claims one due delivery (autocommit: no tx stays open),
// attempts it and finalizes it. false with nil = nothing due.
func (s *Sender) processNext(ctx context.Context) (bool, error) {
	row, err := db.New(s.pool).ClaimNextNotificationEmailDelivery(ctx, s.lease.Milliseconds())
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, stepErr(stepClaim, err)
	}
	c := claimed{id: row.ID, user: row.RecipientUserID, job: row.JobID, typ: domain.Type(row.Type), attempt: row.Attempts, lease: row.LeaseUntil}
	if row.CompanyID.Valid {
		c.company = row.CompanyID.Bytes
	}
	s.finalize(ctx, c, s.attempt(ctx, c))
	return true, nil
}

// attempt re-checks, renders, waits for the throttle and sends — outside any
// transaction. A panic becomes a transient failure (its value is dropped), so
// a poisoned delivery still ends after MaxAttempts.
func (s *Sender) attempt(ctx context.Context, c claimed) (res result) {
	defer func() {
		if recover() != nil {
			res = result{outcome: outcomeTransient, cause: stepErr(stepPanic, errPanic)}
		}
	}()
	view, skip, err := s.prepare(ctx, c)
	if err != nil {
		return result{outcome: outcomeTransient, cause: err}
	}
	if skip != "" {
		return result{outcome: outcomeSkipped, skip: skip}
	}
	msg, err := s.renderer.Render(view)
	if err != nil {
		// A view that cannot render (unknown label code, inconsistent link)
		// never will: fail it now instead of retrying.
		return result{outcome: outcomePermanent, cause: stepErr(stepRender, err)}
	}
	if err := s.throttle.Wait(ctx); err != nil {
		return result{outcome: outcomeTransient, cause: stepErr(stepThrottle, err)}
	}
	sendCtx, cancel := context.WithTimeout(ctx, s.sendTimeout)
	defer cancel()
	provider, err := s.mailer.Send(sendCtx, msg)
	if err != nil {
		if errors.Is(err, email.ErrPermanent) {
			return result{outcome: outcomePermanent, cause: stepErr(stepSend, err)}
		}
		return result{outcome: outcomeTransient, cause: stepErr(stepSend, err)}
	}
	return result{outcome: outcomeSent, provider: provider}
}

// finalize writes the outcome fenced on (id, sending, lease) and always clears
// the lease. A fenced update that matches nothing (the lease expired and
// another sender took over) is logged and ignored. Logs carry delivery id,
// type, attempt, status, step, error class, skip reason and SQLSTATE only.
func (s *Sender) finalize(ctx context.Context, c claimed, res result) {
	fctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), finalizeTimeout)
	defer cancel()
	q := db.New(s.pool)
	attrs := []any{"delivery_id", c.id.String(), "type", string(c.typ), "attempt", c.attempt}
	if res.cause != nil {
		step, sqlstate := classify(res.cause)
		attrs = append(attrs, "step", step, "sqlstate", sqlstate)
	}
	var (
		matched int64
		err     error
		status  string
	)
	switch res.outcome {
	case outcomeSent:
		status = "sent"
		provider := pgtype.Text{String: res.provider, Valid: res.provider != ""}
		matched, err = q.FinishNotificationEmailDeliverySent(fctx, db.FinishNotificationEmailDeliverySentParams{ID: c.id, ProviderMessageID: provider, LeaseUntil: c.lease})
	case outcomeSkipped:
		status = "skipped"
		attrs = append(attrs, "skip_reason", res.skip)
		matched, err = q.FinishNotificationEmailDeliverySkipped(fctx, db.FinishNotificationEmailDeliverySkippedParams{ID: c.id, SkipReason: res.skip, LeaseUntil: c.lease})
	case outcomePermanent:
		status = "failed"
		attrs = append(attrs, "error_class", "permanent")
		matched, err = q.FinishNotificationEmailDeliveryFailed(fctx, db.FinishNotificationEmailDeliveryFailedParams{ID: c.id, LeaseUntil: c.lease})
	default:
		attrs = append(attrs, "error_class", "transient")
		var row db.RetryNotificationEmailDeliveryRow
		row, err = q.RetryNotificationEmailDelivery(fctx, db.RetryNotificationEmailDeliveryParams{ID: c.id, LeaseUntil: c.lease, MaxAttempts: int32(s.maxAttempts),
			RetryBaseMs: RetryBase.Milliseconds(), RetryCapMs: RetryCap.Milliseconds()})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			err = nil
		case err == nil:
			matched, status = 1, row.Status
		}
	}
	if err != nil {
		_, sqlstate := classify(err)
		s.logger.Error("notification email finalize failed", append(attrs, "finalize_step", string(stepFinalize), "finalize_sqlstate", sqlstate)...)
		return
	}
	if matched == 0 {
		s.logger.Warn("notification email finalize ignored", append(stripStep(attrs), "step", string(stepFinalize), "stale", true)...)
		return
	}
	attrs = append(attrs, "status", status)
	switch {
	case res.outcome == outcomePermanent || status == "failed":
		s.logger.Error("notification email failed", attrs...)
	case res.outcome == outcomeTransient:
		s.logger.Warn("notification email attempt failed", attrs...)
	default:
		s.logger.Info("notification email finalized", attrs...)
	}
}

// stripStep drops the attempt's step / SQLSTATE so a stale-finalize line
// names only the finalize step.
func stripStep(attrs []any) []any {
	out := make([]any, 0, len(attrs))
	for i := 0; i+1 < len(attrs); i += 2 {
		if attrs[i] == "step" || attrs[i] == "sqlstate" {
			continue
		}
		out = append(out, attrs[i], attrs[i+1])
	}
	return out
}
