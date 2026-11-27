package main

import (
	"log/slog"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/logmail"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/smtpmail"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
)

// notifications-v2 D13: off → no mailer; log → value-free log adapter; smtp →
// plain SMTP to the configured host/port (Mailpit in dev).
func TestNewNotificationMailer(t *testing.T) {
	if m := newNotificationMailer(runtimeconfig.NotificationsEmailConfig{Mailer: runtimeconfig.MailerOff}, slog.Default()); m != nil {
		t.Fatalf("off built %T", m)
	}
	if m := newNotificationMailer(runtimeconfig.NotificationsEmailConfig{}, slog.Default()); m != nil {
		t.Fatalf("zero config built %T", m)
	}
	if _, ok := newNotificationMailer(runtimeconfig.NotificationsEmailConfig{Mailer: runtimeconfig.MailerLog}, slog.Default()).(*logmail.Mailer); !ok {
		t.Fatal("log mailer not built")
	}
	m, ok := newNotificationMailer(runtimeconfig.NotificationsEmailConfig{Mailer: runtimeconfig.MailerSMTP, SMTPHost: "localhost", SMTPPort: 1025}, slog.Default()).(*smtpmail.Mailer)
	if !ok || m.Addr() != "localhost:1025" {
		t.Fatalf("smtp mailer %v", m)
	}
}
