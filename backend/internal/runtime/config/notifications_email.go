package config

import "errors"

// Notification email settings (notifications-v2 §Config keys, D13). E4 loads
// only the mailer kind, which gates delivery creation; the sender, templates
// and unsubscribe slices (E5–E7) extend NotificationsEmailConfig with their
// keys. Values are validated and never echoed or logged.

// EnvNotificationsMailer selects the mailer adapter.
const EnvNotificationsMailer = "NOTIFICATIONS_MAILER"

// NotificationsMailer is the NOTIFICATIONS_MAILER value.
type NotificationsMailer string

const (
	// MailerOff (default) creates no deliveries and starts no sender.
	MailerOff NotificationsMailer = "off"
	// MailerLog writes one structured line per email (no address, no body).
	MailerLog NotificationsMailer = "log"
	// MailerSMTP sends plain SMTP (Mailpit in dev).
	MailerSMTP NotificationsMailer = "smtp"
	// mailerSES is reserved: refused until the SES adapter exists (S9).
	mailerSES NotificationsMailer = "ses"
)

// NotificationsEmailConfig is the typed notifications email configuration.
// The zero value is disabled.
type NotificationsEmailConfig struct {
	Mailer NotificationsMailer
}

// Enabled reports whether email deliveries are created (mailer ≠ off).
func (c NotificationsEmailConfig) Enabled() bool {
	return c.Mailer == MailerLog || c.Mailer == MailerSMTP
}

// LoadNotificationsEmailConfig validates the notifications email keys with
// static error messages (no environment value is ever quoted).
func LoadNotificationsEmailConfig(getenv func(string) string) (NotificationsEmailConfig, error) {
	if getenv == nil {
		return NotificationsEmailConfig{}, errors.New("notifications email configuration lookup required")
	}
	switch m := NotificationsMailer(getenv(EnvNotificationsMailer)); m {
	case "":
		return NotificationsEmailConfig{Mailer: MailerOff}, nil
	case MailerOff, MailerLog, MailerSMTP:
		return NotificationsEmailConfig{Mailer: m}, nil
	case mailerSES:
		return NotificationsEmailConfig{}, errors.New("NOTIFICATIONS_MAILER=ses is reserved until the SES adapter ships")
	default:
		return NotificationsEmailConfig{}, errors.New("NOTIFICATIONS_MAILER must be off, log or smtp")
	}
}
