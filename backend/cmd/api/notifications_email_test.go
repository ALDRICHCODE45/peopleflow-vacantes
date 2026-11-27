package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
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

// e6Env is a complete environment for a non-off mailer (§Config keys).
func e6Env(mailer string) map[string]string {
	env := map[string]string{
		"NOTIFICATIONS_MAILER":           mailer,
		"NOTIFICATIONS_EMAIL_FROM":       "PeopleFlow <no-reply@peopleflow.test>",
		"APP_BASE_URL":                   "http://localhost:3000",
		"NOTIFICATIONS_UNSUBSCRIBE_URL":  "http://localhost:3000/api/notificaciones/baja",
		"NOTIFICATIONS_UNSUBSCRIBE_KEYS": "k1:" + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32)),
	}
	if mailer == "smtp" {
		env["NOTIFICATIONS_SMTP_HOST"], env["NOTIFICATIONS_SMTP_PORT"] = "localhost", "1025"
	}
	return env
}

// composeSender runs the startup chain of main.go for the notifications
// email: config loader → unsubscribe signer → sender composition.
func composeSender(env map[string]string) (senderRunner, error) {
	cfg, err := runtimeconfig.LoadNotificationsEmailConfig(func(k string) string { return env[k] })
	if err != nil {
		return nil, err
	}
	signer, err := newNotificationUnsubscribeSigner(cfg, nil)
	if err != nil {
		return nil, err
	}
	return newNotificationSender(nil, cfg, signer, slog.Default())
}

// L13 (2) / E6: startup refuses a non-off mailer without any of its required
// keys (sender, origin, one-click URL, unsubscribe keys; SMTP host/port for
// smtp; an invalid throttle), builds a sender for log and smtp with every key,
// and builds none with the mailer off — keys present or not.
func TestNotificationSenderStartupComposition(t *testing.T) {
	for _, mailer := range []string{"log", "smtp"} {
		if s, err := composeSender(e6Env(mailer)); err != nil || s == nil {
			t.Fatalf("%s: sender %v err %v", mailer, s, err)
		}
		required := []string{"NOTIFICATIONS_EMAIL_FROM", "APP_BASE_URL", "NOTIFICATIONS_UNSUBSCRIBE_URL", "NOTIFICATIONS_UNSUBSCRIBE_KEYS"}
		if mailer == "smtp" {
			required = append(required, "NOTIFICATIONS_SMTP_HOST", "NOTIFICATIONS_SMTP_PORT")
		}
		for _, key := range required {
			env := e6Env(mailer)
			delete(env, key)
			if s, err := composeSender(env); err == nil || s != nil || !strings.Contains(err.Error(), key) {
				t.Fatalf("%s without %s: sender %v err %v", mailer, key, s, err)
			}
		}
		env := e6Env(mailer)
		env["NOTIFICATIONS_EMAIL_MAX_PER_SECOND"] = "0"
		if s, err := composeSender(env); err == nil || s != nil {
			t.Fatalf("%s with an invalid throttle: %v %v", mailer, s, err)
		}
	}
	for _, env := range []map[string]string{{}, {"NOTIFICATIONS_MAILER": "off"}, func() map[string]string { e := e6Env("off"); return e }()} {
		if s, err := composeSender(env); err != nil || s != nil {
			t.Fatalf("mailer off %v: sender %v err %v", env["NOTIFICATIONS_MAILER"], s, err)
		}
	}
}

// A config that bypassed the loader still fails closed: no signer, or
// settings the renderer refuses, is a startup error, never a silent sender.
func TestNewNotificationSenderFailsClosed(t *testing.T) {
	full, err := runtimeconfig.LoadNotificationsEmailConfig(func(k string) string { return e6Env("log")[k] })
	if err != nil {
		t.Fatal(err)
	}
	if s, err := newNotificationSender(nil, full, nil, slog.Default()); err == nil || s != nil {
		t.Fatalf("nil signer: %v %v", s, err)
	}
	signer, err := newNotificationUnsubscribeSigner(full, nil)
	if err != nil {
		t.Fatal(err)
	}
	broken := full
	broken.AppBaseURL = ""
	if s, err := newNotificationSender(nil, broken, signer, slog.Default()); err == nil || s != nil {
		t.Fatalf("invalid settings: %v %v", s, err)
	}
	if s, err := newNotificationSender(nil, runtimeconfig.NotificationsEmailConfig{Mailer: "ses"}, signer, slog.Default()); err == nil || s != nil {
		t.Fatalf("unknown mailer: %v %v", s, err)
	}
}

// The sender runs in the background with the API process; shutdown stops it
// and stop waits for it, before the pool closes.
func TestStartNotificationSender_RunsInTheBackgroundAndStopWaitsForIt(t *testing.T) {
	runner := &recordingRunner{started: make(chan struct{}), stopped: make(chan struct{})}
	stop := startNotificationSender(context.Background(), runner)
	select {
	case <-runner.started:
	case <-time.After(5 * time.Second):
		t.Fatal("the sender never started")
	}
	stop()
	select {
	case <-runner.stopped:
	default:
		t.Fatal("stop returned before the sender did")
	}
	stop() // idempotent
}

// S11: the renderer gets the configured postal address
// (NOTIFICATIONS_EMAIL_POSTAL_ADDRESS); the config default is the email
// package's placeholder, so an unset key renders the design's text.
func TestNotificationRendererSettingsCarryThePostalAddress(t *testing.T) {
	if runtimeconfig.DefaultNotificationsEmailPostalAddress != email.DefaultPostalAddress {
		t.Fatalf("config default %q != email default %q", runtimeconfig.DefaultNotificationsEmailPostalAddress, email.DefaultPostalAddress)
	}
	env := e6Env("log")
	env["NOTIFICATIONS_EMAIL_POSTAL_ADDRESS"] = "Av. Paseo de la Reforma 222, CDMX"
	cfg, err := runtimeconfig.LoadNotificationsEmailConfig(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	s := notificationRendererSettings(cfg)
	if s.PostalAddress != "Av. Paseo de la Reforma 222, CDMX" || s.From != cfg.From || s.AppBaseURL != cfg.AppBaseURL || s.UnsubscribeURL != cfg.UnsubscribeURL {
		t.Fatalf("settings %+v", s)
	}
	if sender, err := composeSender(env); err != nil || sender == nil {
		t.Fatalf("sender with a postal address: %v %v", sender, err)
	}
}
