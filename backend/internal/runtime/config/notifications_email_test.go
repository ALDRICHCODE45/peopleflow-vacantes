package config

import (
	"strings"
	"testing"
)

// validEmailEnv is the smallest valid non-off environment for a mailer (E5
// keys of §Config keys); smtp adds its host and port.
func validEmailEnv(mailer string) map[string]string {
	env := map[string]string{
		"NOTIFICATIONS_MAILER":          mailer,
		"NOTIFICATIONS_EMAIL_FROM":      "PeopleFlow <no-reply@peopleflow.test>",
		"APP_BASE_URL":                  "http://localhost:3000",
		"NOTIFICATIONS_UNSUBSCRIBE_URL": "http://localhost:3000/api/notificaciones/baja",
	}
	if mailer == "smtp" {
		env["NOTIFICATIONS_SMTP_HOST"] = "localhost"
		env["NOTIFICATIONS_SMTP_PORT"] = "1025"
	}
	return env
}

func loadEmail(env map[string]string) (NotificationsEmailConfig, error) {
	return LoadNotificationsEmailConfig(func(key string) string { return env[key] })
}

// notifications-v2 §Config keys, D13: NOTIFICATIONS_MAILER is off | log |
// smtp (default off); ses is reserved and refused until its adapter ships.
// Errors are static: no environment value is ever echoed.
func TestLoadNotificationsEmailConfig(t *testing.T) {
	tests := []struct {
		name    string
		value   string
		want    NotificationsMailer
		enabled bool
		invalid bool
	}{
		{name: "default off", value: "", want: MailerOff},
		{name: "off", value: "off", want: MailerOff},
		{name: "log", value: "log", want: MailerLog, enabled: true},
		{name: "smtp", value: "smtp", want: MailerSMTP, enabled: true},
		{name: "ses reserved", value: "ses", invalid: true},
		{name: "upper case", value: "LOG", invalid: true},
		{name: "padded", value: " smtp ", invalid: true},
		{name: "unknown secret", value: "secret-provider", invalid: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			env := validEmailEnv(tc.value)
			got, err := loadEmail(env)
			if (err != nil) != tc.invalid {
				t.Fatalf("config=%+v err=%v", got, err)
			}
			if err != nil {
				if strings.Contains(err.Error(), "secret") || (tc.value != "" && strings.Contains(err.Error(), "\""+tc.value+"\"")) {
					t.Fatalf("environment value leaked: %v", err)
				}
				if !strings.Contains(err.Error(), "NOTIFICATIONS_MAILER") {
					t.Fatalf("error does not name the key: %v", err)
				}
				return
			}
			if got.Mailer != tc.want || got.Enabled() != tc.enabled {
				t.Fatalf("got %+v enabled=%v, want %s enabled=%v", got, got.Enabled(), tc.want, tc.enabled)
			}
		})
	}
}

func TestLoadNotificationsEmailConfigRequiresALookup(t *testing.T) {
	if _, err := LoadNotificationsEmailConfig(nil); err == nil {
		t.Fatal("nil lookup accepted")
	}
}

// The zero value is the safe default: no deliveries are created.
func TestNotificationsEmailConfigZeroValueIsDisabled(t *testing.T) {
	if (NotificationsEmailConfig{}).Enabled() {
		t.Fatal("zero config enabled")
	}
}

// E5 keys are parsed into the typed config: the sender in header form, the
// frontend origin without a trailing slash, the one-click URL, SMTP host/port.
func TestLoadNotificationsEmailConfigParsesTheE5Keys(t *testing.T) {
	env := validEmailEnv("smtp")
	env["APP_BASE_URL"] = "https://app.peopleflow.test/"
	env["NOTIFICATIONS_UNSUBSCRIBE_URL"] = "https://app.peopleflow.test/api/notificaciones/baja"
	got, err := loadEmail(env)
	if err != nil {
		t.Fatal(err)
	}
	want := NotificationsEmailConfig{
		Mailer:         MailerSMTP,
		From:           `"PeopleFlow" <no-reply@peopleflow.test>`,
		AppBaseURL:     "https://app.peopleflow.test",
		UnsubscribeURL: "https://app.peopleflow.test/api/notificaciones/baja",
		SMTPHost:       "localhost",
		SMTPPort:       1025,
	}
	if got != want {
		t.Fatalf("got %+v\nwant %+v", got, want)
	}

	logEnv := validEmailEnv("log")
	logEnv["NOTIFICATIONS_SMTP_HOST"] = "ignored.example"
	logEnv["NOTIFICATIONS_SMTP_PORT"] = "not-a-port"
	gotLog, err := loadEmail(logEnv)
	if err != nil {
		t.Fatalf("log mailer must ignore the SMTP keys: %v", err)
	}
	if gotLog.SMTPHost != "" || gotLog.SMTPPort != 0 || gotLog.From == "" {
		t.Fatalf("log config %+v", gotLog)
	}
}

// Mailer off ignores every other key, even invalid ones: nothing is sent.
func TestLoadNotificationsEmailConfigOffIgnoresTheOtherKeys(t *testing.T) {
	got, err := loadEmail(map[string]string{
		"NOTIFICATIONS_MAILER":          "off",
		"NOTIFICATIONS_EMAIL_FROM":      "not an address",
		"APP_BASE_URL":                  "ftp://secret",
		"NOTIFICATIONS_UNSUBSCRIBE_URL": "nope",
		"APP_ENV":                       "production",
	})
	if err != nil || got != (NotificationsEmailConfig{Mailer: MailerOff}) {
		t.Fatalf("got %+v err=%v", got, err)
	}
}

// With mailer ≠ off every E5 key is required and validated; each failure
// names its key and never quotes the value (values carry the word "secret").
func TestLoadNotificationsEmailConfigRejectsInvalidE5Keys(t *testing.T) {
	cases := []struct {
		name, mailer, key, value, appEnv string
	}{
		{"from missing log", "log", "NOTIFICATIONS_EMAIL_FROM", "", ""},
		{"from missing smtp", "smtp", "NOTIFICATIONS_EMAIL_FROM", "", ""},
		{"from not an address", "log", "NOTIFICATIONS_EMAIL_FROM", "secret", ""},
		{"from header injection", "log", "NOTIFICATIONS_EMAIL_FROM", "secret <a@b.test>\r\nBcc: x@y.test", ""},
		{"from list", "log", "NOTIFICATIONS_EMAIL_FROM", "a@secret.test, b@secret.test", ""},
		{"base missing", "log", "APP_BASE_URL", "", ""},
		{"base scheme", "log", "APP_BASE_URL", "ftp://secret.test", ""},
		{"base relative", "log", "APP_BASE_URL", "/secret", ""},
		{"base path", "log", "APP_BASE_URL", "https://secret.test/app", ""},
		{"base query", "log", "APP_BASE_URL", "https://secret.test?x=1", ""},
		{"base fragment", "log", "APP_BASE_URL", "https://secret.test#x", ""},
		{"base credentials", "log", "APP_BASE_URL", "https://secret:secret@app.test", ""},
		{"base http in production", "log", "APP_BASE_URL", "http://secret.test", "production"},
		{"unsubscribe missing", "log", "NOTIFICATIONS_UNSUBSCRIBE_URL", "", ""},
		{"unsubscribe relative", "log", "NOTIFICATIONS_UNSUBSCRIBE_URL", "/api/secret", ""},
		{"unsubscribe scheme", "log", "NOTIFICATIONS_UNSUBSCRIBE_URL", "mailto:secret@x.test", ""},
		{"unsubscribe query", "log", "NOTIFICATIONS_UNSUBSCRIBE_URL", "https://secret.test/api/notificaciones/baja?token=x", ""},
		{"unsubscribe fragment", "log", "NOTIFICATIONS_UNSUBSCRIBE_URL", "https://secret.test/api/notificaciones/baja#x", ""},
		{"unsubscribe credentials", "log", "NOTIFICATIONS_UNSUBSCRIBE_URL", "https://secret:secret@x.test/api", ""},
		{"unsubscribe http in production", "log", "NOTIFICATIONS_UNSUBSCRIBE_URL", "http://secret.test/api/notificaciones/baja", "production"},
		{"smtp host missing", "smtp", "NOTIFICATIONS_SMTP_HOST", "", ""},
		{"smtp host invalid", "smtp", "NOTIFICATIONS_SMTP_HOST", "secret host:25", ""},
		{"smtp port missing", "smtp", "NOTIFICATIONS_SMTP_PORT", "", ""},
		{"smtp port text", "smtp", "NOTIFICATIONS_SMTP_PORT", "secret", ""},
		{"smtp port zero", "smtp", "NOTIFICATIONS_SMTP_PORT", "0", ""},
		{"smtp port too large", "smtp", "NOTIFICATIONS_SMTP_PORT", "65536", ""},
		{"smtp in production", "smtp", "NOTIFICATIONS_SMTP_HOST", "localhost", "production"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := validEmailEnv(tc.mailer)
			env[tc.key] = tc.value
			if tc.appEnv != "" {
				env["APP_ENV"] = tc.appEnv
				// Production otherwise needs https URLs, so only the key under test fails.
				if tc.key != "APP_BASE_URL" {
					env["APP_BASE_URL"] = "https://app.peopleflow.test"
				}
				if tc.key != "NOTIFICATIONS_UNSUBSCRIBE_URL" {
					env["NOTIFICATIONS_UNSUBSCRIBE_URL"] = "https://app.peopleflow.test/api/notificaciones/baja"
				}
			}
			got, err := loadEmail(env)
			if err == nil {
				t.Fatalf("accepted: %+v", got)
			}
			if !strings.Contains(err.Error(), tc.key) {
				t.Fatalf("error does not name %s: %v", tc.key, err)
			}
			if strings.Contains(strings.ToLower(err.Error()), "secret") || (tc.value != "" && strings.Contains(err.Error(), tc.value)) {
				t.Fatalf("environment value leaked: %v", err)
			}
		})
	}
}

// Production accepts https URLs for the log mailer (smtp is dev only).
func TestLoadNotificationsEmailConfigProductionLog(t *testing.T) {
	env := validEmailEnv("log")
	env["APP_ENV"] = "production"
	env["APP_BASE_URL"] = "https://app.peopleflow.test"
	env["NOTIFICATIONS_UNSUBSCRIBE_URL"] = "https://app.peopleflow.test/api/notificaciones/baja"
	if _, err := loadEmail(env); err != nil {
		t.Fatal(err)
	}
}
