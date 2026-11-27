package main

import (
	"log/slog"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/logmail"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/smtpmail"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
)

// newNotificationMailer composes the Mailer adapter of NOTIFICATIONS_MAILER
// (notifications-v2 D13): nil when off (no sender is started), the value-free
// log adapter, or plain SMTP to Mailpit in dev. The sender loop (E6) uses it;
// ses stays reserved and is refused by the config loader.
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
