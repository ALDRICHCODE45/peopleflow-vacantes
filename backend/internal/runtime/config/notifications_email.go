package config

import (
	"errors"
	"net"
	"net/mail"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Notification email settings (notifications-v2 §Config keys, D13). E4 loaded
// the mailer kind, which gates delivery creation; E5 adds the keys the
// renderer and the adapters need (sender, frontend origin, one-click URL,
// SMTP host/port). The sender (E6) and unsubscribe (E7) slices add theirs.
// Values are validated and never echoed or logged.

const (
	// EnvNotificationsMailer selects the mailer adapter.
	EnvNotificationsMailer = "NOTIFICATIONS_MAILER"
	// EnvNotificationsEmailFrom is the sender, e.g. `PeopleFlow <no-reply@…>`.
	EnvNotificationsEmailFrom = "NOTIFICATIONS_EMAIL_FROM"
	// EnvAppBaseURL is the frontend origin of deep links, «Mis preferencias»
	// and the unsubscribe landing (§Path map).
	EnvAppBaseURL = "APP_BASE_URL"
	// EnvNotificationsUnsubscribeURL receives the RFC 8058 one-click POST
	// (APP_BASE_URL + /api/notificaciones/baja, Q4); the backend appends ?token=.
	EnvNotificationsUnsubscribeURL = "NOTIFICATIONS_UNSUBSCRIBE_URL"
	// EnvNotificationsSMTPHost / EnvNotificationsSMTPPort address plain SMTP
	// (Mailpit in dev).
	EnvNotificationsSMTPHost = "NOTIFICATIONS_SMTP_HOST"
	EnvNotificationsSMTPPort = "NOTIFICATIONS_SMTP_PORT"
)

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
// The zero value is disabled. With MailerOff every other field is empty.
type NotificationsEmailConfig struct {
	Mailer NotificationsMailer
	// From is the sender in header form (net/mail formatting).
	From string
	// AppBaseURL is the frontend origin, without a trailing slash.
	AppBaseURL string
	// UnsubscribeURL is the absolute one-click URL, without query.
	UnsubscribeURL string
	// SMTPHost and SMTPPort are set only for MailerSMTP.
	SMTPHost string
	SMTPPort int
}

// Enabled reports whether email deliveries are created (mailer ≠ off).
func (c NotificationsEmailConfig) Enabled() bool {
	return c.Mailer == MailerLog || c.Mailer == MailerSMTP
}

var smtpHostPattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`)

// LoadNotificationsEmailConfig validates the notifications email keys with
// static error messages (no environment value is ever quoted). With the
// mailer off the other keys are ignored; otherwise the sender, APP_BASE_URL
// and NOTIFICATIONS_UNSUBSCRIBE_URL are required, plus SMTP host/port for
// smtp, which is refused in production (dev only, Mailpit).
func LoadNotificationsEmailConfig(getenv func(string) string) (NotificationsEmailConfig, error) {
	if getenv == nil {
		return NotificationsEmailConfig{}, errors.New("notifications email configuration lookup required")
	}
	var c NotificationsEmailConfig
	switch m := NotificationsMailer(getenv(EnvNotificationsMailer)); m {
	case "", MailerOff:
		return NotificationsEmailConfig{Mailer: MailerOff}, nil
	case MailerLog, MailerSMTP:
		c.Mailer = m
	case mailerSES:
		return NotificationsEmailConfig{}, errors.New("NOTIFICATIONS_MAILER=ses is reserved until the SES adapter ships")
	default:
		return NotificationsEmailConfig{}, errors.New("NOTIFICATIONS_MAILER must be off, log or smtp")
	}
	production := strings.EqualFold(getenv("APP_ENV"), "production")

	from, err := parseSender(getenv(EnvNotificationsEmailFrom))
	if err != nil {
		return NotificationsEmailConfig{}, err
	}
	c.From = from

	base, err := parseHTTPURL(getenv(EnvAppBaseURL), production, true)
	if err != nil {
		return NotificationsEmailConfig{}, errors.New(EnvAppBaseURL + " must be an absolute " + err.Error() + " origin without credentials, path, query or fragment")
	}
	c.AppBaseURL = base

	unsubscribe, err := parseHTTPURL(getenv(EnvNotificationsUnsubscribeURL), production, false)
	if err != nil {
		return NotificationsEmailConfig{}, errors.New(EnvNotificationsUnsubscribeURL + " must be an absolute " + err.Error() + " URL without credentials, query or fragment")
	}
	c.UnsubscribeURL = unsubscribe

	if c.Mailer == MailerSMTP {
		if production {
			return NotificationsEmailConfig{}, errors.New("NOTIFICATIONS_MAILER=smtp (" + EnvNotificationsSMTPHost + ") is dev only and forbidden in production")
		}
		host := getenv(EnvNotificationsSMTPHost)
		if !smtpHostPattern.MatchString(host) && net.ParseIP(host) == nil {
			return NotificationsEmailConfig{}, errors.New(EnvNotificationsSMTPHost + " is required and must be a host name or IP address")
		}
		port, err := strconv.Atoi(getenv(EnvNotificationsSMTPPort))
		if err != nil || port < 1 || port > 65535 {
			return NotificationsEmailConfig{}, errors.New(EnvNotificationsSMTPPort + " is required and must be a TCP port number")
		}
		c.SMTPHost, c.SMTPPort = host, port
	}
	return c, nil
}

// parseSender accepts exactly one RFC 5322 address with a domain.
func parseSender(v string) (string, error) {
	invalid := errors.New(EnvNotificationsEmailFrom + " is required and must be one email address (optionally with a display name)")
	if v == "" || strings.ContainsAny(v, "\r\n") {
		return "", invalid
	}
	addr, err := mail.ParseAddress(v)
	if err != nil {
		return "", invalid
	}
	at := strings.LastIndexByte(addr.Address, '@')
	if at <= 0 || at == len(addr.Address)-1 {
		return "", invalid
	}
	return addr.String(), nil
}

// parseHTTPURL validates an absolute http(s) URL (https only in production),
// without credentials, query or fragment; originOnly also refuses a path. The
// returned URL has no trailing slash. The error text is the scheme rule only.
func parseHTTPURL(v string, production, originOnly bool) (string, error) {
	scheme := errors.New("http(s)")
	if production {
		scheme = errors.New("https")
	}
	u, err := url.Parse(v)
	if v == "" || err != nil || u.Host == "" || u.Hostname() == "" || u.User != nil || u.Opaque != "" ||
		u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.ContainsAny(v, "#?") {
		return "", scheme
	}
	switch {
	case u.Scheme == "https":
	case u.Scheme == "http" && !production:
	default:
		return "", scheme
	}
	if originOnly && u.Path != "" && u.Path != "/" {
		return "", scheme
	}
	return strings.TrimRight(u.String(), "/"), nil
}
