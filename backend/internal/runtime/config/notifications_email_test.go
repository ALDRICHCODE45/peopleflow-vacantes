package config

import (
	"strings"
	"testing"
)

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
			env := map[string]string{"NOTIFICATIONS_MAILER": tc.value}
			got, err := LoadNotificationsEmailConfig(func(key string) string { return env[key] })
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
