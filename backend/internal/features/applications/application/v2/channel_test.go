package v2

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// stakeholder-metrics-v1 §2.5: optional self-reported origin channel.
func TestDecodeApplyChannel(t *testing.T) {
	base := `{"cv_id":"` + uuid.NewString() + `","questionnaire_revision":"r","answers":[]}`
	with := func(raw string) string { return strings.Replace(base, `{"cv_id"`, `{"channel":`+raw+`,"cv_id"`, 1) }
	for _, tc := range []struct{ name, body, want string }{
		{"missing defaults to portal", base, ChannelPortal},
		{"portal", with(`"portal"`), ChannelPortal},
		{"careers site", with(`"careers_site"`), ChannelCareersSite},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req, err := decodeApply([]byte(tc.body))
			if err != nil || req.Channel != tc.want {
				t.Fatalf("channel=%q err=%v", req.Channel, err)
			}
		})
	}
	for _, raw := range []string{`"manual"`, `"unknown"`, `"Portal"`, `""`, `null`, `1`, `["portal"]`} {
		t.Run("rejects "+raw, func(t *testing.T) {
			if _, err := decodeApply([]byte(with(raw))); !errors.Is(err, ErrInvalidChannel) {
				t.Fatalf("err=%v", err)
			}
		})
	}
	// Structural errors keep precedence over the channel value.
	if _, err := decodeApply([]byte(strings.Replace(with(`"tv"`), `"answers":[]`, `"answers":null`, 1))); !errors.Is(err, ErrInvalidRequest) {
		t.Fatal(err)
	}
	if _, err := decodeApply([]byte(strings.Replace(with(`"portal"`), `"cv_id"`, `"extra":1,"cv_id"`, 1))); !errors.Is(err, ErrInvalidRequest) {
		t.Fatal(err)
	}
}

func TestFingerprintNormalizesMissingChannel(t *testing.T) {
	base := `{"cv_id":"` + uuid.NewString() + `","questionnaire_revision":"r","answers":[]}`
	missing, _ := decodeApply([]byte(base))
	explicit, _ := decodeApply([]byte(strings.Replace(base, `{"cv_id"`, `{"channel":"portal","cv_id"`, 1)))
	site, _ := decodeApply([]byte(strings.Replace(base, `{"cv_id"`, `{"channel":"careers_site","cv_id"`, 1)))
	a, _ := Fingerprint(missing)
	b, _ := Fingerprint(explicit)
	c, _ := Fingerprint(site)
	if !bytes.Equal(a, b) || bytes.Equal(a, c) {
		t.Fatal("channel fingerprint")
	}
}
