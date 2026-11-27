package main

import (
	"context"
	"errors"
	"log/slog"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/logmail"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/smtpmail"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/sender"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/unsubscribe"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newNotificationMailer composes the Mailer adapter of NOTIFICATIONS_MAILER
// (notifications-v2 D13): nil when off (no sender is started), the value-free
// log adapter, or plain SMTP to Mailpit in dev. ses stays reserved and is
// refused by the config loader.
func newNotificationMailer(cfg runtimeconfig.NotificationsEmailConfig, logger *slog.Logger) email.Mailer {
	switch cfg.Mailer {
	case runtimeconfig.MailerLog:
		return logmail.New(logger)
	case runtimeconfig.MailerSMTP:
		return smtpmail.New(cfg.SMTPHost, cfg.SMTPPort)
	default:
		return nil
	}
}

// senderRunner is the notifications email sender loop: Run blocks until ctx is cancelled.
type senderRunner interface {
	Run(ctx context.Context)
}

// newNotificationSender composes the email sender (notifications-v2 D12,
// §Sender): the mailer adapter, the renderer over the configured sender,
// frontend origin and one-click URL with the unsubscribe signer as its
// TokenSigner, and the per-instance throttle, in a 5-s loop. Mailer off →
// nil (no sender, D13). A non-off mailer that cannot be fully composed — no
// signer, settings the renderer refuses, an unknown mailer — is a startup
// error (L13): never a silently idle queue. The pool is only used once the
// loop runs.
func newNotificationSender(pool *pgxpool.Pool, cfg runtimeconfig.NotificationsEmailConfig, signer *unsubscribe.Signer, logger *slog.Logger) (senderRunner, error) {
	if !cfg.Enabled() {
		if cfg.Mailer != "" && cfg.Mailer != runtimeconfig.MailerOff {
			return nil, errors.New("notifications email sender: unknown mailer")
		}
		return nil, nil
	}
	mailer := newNotificationMailer(cfg, logger)
	if mailer == nil {
		return nil, errors.New("notifications email sender: no mailer adapter")
	}
	if signer == nil {
		return nil, errors.New("notifications email sender: unsubscribe keys required")
	}
	renderer, err := email.NewRenderer(email.Settings{From: cfg.From, AppBaseURL: cfg.AppBaseURL, UnsubscribeURL: cfg.UnsubscribeURL}, signer)
	if err != nil {
		return nil, err
	}
	s := sender.New(pool, renderer, mailer, sender.NewBucket(cfg.MaxPerSecond, nil, nil), logger)
	return sender.NewLoop(s, logger), nil
}

// startNotificationSender runs the sender loop in a goroutine that ends with
// ctx (the signal context of main) or when stop is called; stop waits for
// the goroutine (its in-flight delivery finalizes first), so it must run
// before the pool is closed. Same lifecycle as the fan-out.
func startNotificationSender(ctx context.Context, runner senderRunner) (stop func()) {
	return startNotificationFanOut(ctx, runner)
}
