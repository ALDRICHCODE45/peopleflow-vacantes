package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	"github.com/google/uuid"
)

// notifications-v2 §Unsubscribe: with the mailer on, the configured keys build
// one signer (first key signs, all verify) that is also the renderer's
// email.TokenSigner (E6); with the mailer off there is none.
func TestNewNotificationUnsubscribeSigner(t *testing.T) {
	for _, cfg := range []runtimeconfig.NotificationsEmailConfig{{}, {Mailer: runtimeconfig.MailerOff}} {
		if s, err := newNotificationUnsubscribeSigner(cfg, nil); s != nil || err != nil {
			t.Fatalf("off built %v %v", s, err)
		}
	}
	cfg := runtimeconfig.NotificationsEmailConfig{Mailer: runtimeconfig.MailerLog, UnsubscribeKeys: runtimeconfig.UnsubscribeKeys{
		{ID: "k2", Secret: bytes.Repeat([]byte{2}, 32)}, {ID: "k1", Secret: bytes.Repeat([]byte{1}, 32)},
	}}
	s, err := newNotificationUnsubscribeSigner(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	var signer email.TokenSigner = s
	key := domain.PreferenceKey{User: uuid.New(), Company: uuid.New(), Type: domain.TypePsychometricCompleted}
	tok, err := signer.Sign(key)
	if err != nil || !strings.HasPrefix(tok, "k2.") {
		t.Fatalf("%q %v", tok, err)
	}
	if got, err := s.Verify(tok); err != nil || got != key {
		t.Fatalf("%+v %v", got, err)
	}
	// A config that bypassed the loader still fails closed.
	cfg.UnsubscribeKeys = runtimeconfig.UnsubscribeKeys{{ID: "k1", Secret: []byte("short")}}
	if s, err := newNotificationUnsubscribeSigner(cfg, nil); err == nil || s != nil {
		t.Fatal("short key accepted")
	}
}
