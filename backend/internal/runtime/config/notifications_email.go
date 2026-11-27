package config

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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
// SMTP host/port); E7 the unsubscribe token keys; E6 the sender throttle.
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
	// EnvNotificationsUnsubscribeKeys holds the unsubscribe token keys
	// (§Unsubscribe): a comma list of kid:base64key, the first signs and every
	// listed key verifies (rotation: prepend a new key, drop an old one after
	// 365 days). Never logged.
	EnvNotificationsUnsubscribeKeys = "NOTIFICATIONS_UNSUBSCRIBE_KEYS"
	// EnvNotificationsEmailMaxPerSecond is the per-instance sender throttle
	// (emails per second, §Sender); unset = DefaultNotificationsEmailMaxPerSecond.
	EnvNotificationsEmailMaxPerSecond = "NOTIFICATIONS_EMAIL_MAX_PER_SECOND"
)

// DefaultNotificationsEmailMaxPerSecond is the SES sandbox rate (Q5).
const DefaultNotificationsEmailMaxPerSecond = 1

// maxNotificationsEmailPerSecond bounds the throttle key.
const maxNotificationsEmailPerSecond = 1000

// MinUnsubscribeKeyBytes is the minimum decoded length of an unsubscribe key.
const MinUnsubscribeKeyBytes = 32

// UnsubscribeKey is one HMAC key of the unsubscribe tokens. Its fmt, slog and
// JSON renderings show the kid only: the key material is never printed.
type UnsubscribeKey struct {
	ID     string
	Secret []byte
}

func (k UnsubscribeKey) String() string { return k.ID + ":[redacted]" }

// GoString keeps %#v from dumping the key bytes.
func (k UnsubscribeKey) GoString() string { return "UnsubscribeKey{" + k.String() + "}" }

// Format writes the redacted form under every verb and flag: without it,
// verbs that skip String (%d, %o, %b, …) would print the key bytes.
func (k UnsubscribeKey) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(k.String())) }

// LogValue keeps slog from dumping the key bytes.
func (k UnsubscribeKey) LogValue() slog.Value { return slog.StringValue(k.String()) }

// MarshalJSON keeps encoding/json (and slog's JSON handler, which marshals
// nested structs) from dumping the key bytes.
func (k UnsubscribeKey) MarshalJSON() ([]byte, error) { return json.Marshal(k.String()) }

// UnsubscribeKeys renders as its kids only, under every fmt verb and in slog
// (JSON goes through each UnsubscribeKey's MarshalJSON).
type UnsubscribeKeys []UnsubscribeKey

func (ks UnsubscribeKeys) String() string {
	ids := make([]string, len(ks))
	for i, k := range ks {
		ids[i] = k.String()
	}
	return "[" + strings.Join(ids, " ") + "]"
}

func (ks UnsubscribeKeys) GoString() string { return "UnsubscribeKeys" + ks.String() }

func (ks UnsubscribeKeys) Format(f fmt.State, verb rune) { _, _ = f.Write([]byte(ks.String())) }

func (ks UnsubscribeKeys) LogValue() slog.Value { return slog.StringValue(ks.String()) }

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
// The zero value is disabled. With MailerOff every other field is empty
// except UnsubscribeKeys, loaded whenever present (sent links keep working).
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
	// UnsubscribeKeys are the token keys in order (the first signs); required
	// when the mailer is not off, loaded whenever present when it is off.
	UnsubscribeKeys UnsubscribeKeys
	// MaxPerSecond is the per-instance sender throttle (mailer ≠ off only).
	MaxPerSecond int
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
		// Kill switch: nothing is sent, but the links already in inboxes keep
		// working, so present unsubscribe keys are still loaded and validated.
		off := NotificationsEmailConfig{Mailer: MailerOff}
		if raw := getenv(EnvNotificationsUnsubscribeKeys); raw != "" {
			keys, err := parseUnsubscribeKeys(raw)
			if err != nil {
				return NotificationsEmailConfig{}, err
			}
			off.UnsubscribeKeys = keys
		}
		return off, nil
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

	keys, err := parseUnsubscribeKeys(getenv(EnvNotificationsUnsubscribeKeys))
	if err != nil {
		return NotificationsEmailConfig{}, err
	}
	c.UnsubscribeKeys = keys

	c.MaxPerSecond = DefaultNotificationsEmailMaxPerSecond
	if raw := getenv(EnvNotificationsEmailMaxPerSecond); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 || n > maxNotificationsEmailPerSecond || strconv.Itoa(n) != raw {
			return NotificationsEmailConfig{}, errors.New(EnvNotificationsEmailMaxPerSecond + " must be an integer between 1 and 1000")
		}
		c.MaxPerSecond = n
	}

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

var unsubscribeKidPattern = regexp.MustCompile(`^[a-z0-9]{1,16}$`)

// parseUnsubscribeKeys parses kid:base64key entries (standard or URL-safe
// base64, padded or not; spaces around an entry trimmed). Every entry must be
// valid: kid [a-z0-9]{1,16}, distinct, key ≥ 32 bytes. The error never quotes
// any part of the value.
func parseUnsubscribeKeys(v string) (UnsubscribeKeys, error) {
	invalid := errors.New(EnvNotificationsUnsubscribeKeys + " is required and must be a comma list of kid:base64key " +
		"entries (kid [a-z0-9]{1,16}, distinct; each key at least 32 bytes)")
	if strings.TrimSpace(v) == "" {
		return nil, invalid
	}
	var keys UnsubscribeKeys
	seen := map[string]bool{}
	for _, entry := range strings.Split(v, ",") {
		kid, encoded, ok := strings.Cut(strings.TrimSpace(entry), ":")
		if !ok || !unsubscribeKidPattern.MatchString(kid) || seen[kid] {
			return nil, invalid
		}
		key, ok := decodeBase64Key(encoded)
		if !ok || len(key) < MinUnsubscribeKeyBytes {
			return nil, invalid
		}
		seen[kid] = true
		keys = append(keys, UnsubscribeKey{ID: kid, Secret: key})
	}
	return keys, nil
}

func decodeBase64Key(v string) ([]byte, bool) {
	if v == "" {
		return nil, false
	}
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if key, err := enc.Strict().DecodeString(v); err == nil {
			return key, true
		}
	}
	return nil, false
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
