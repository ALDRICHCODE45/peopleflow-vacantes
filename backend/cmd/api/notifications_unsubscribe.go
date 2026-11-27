package main

import (
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/unsubscribe"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newNotificationUnsubscribeSigner builds the HMAC token signer/verifier of
// notifications-v2 §Unsubscribe from NOTIFICATIONS_UNSUBSCRIBE_KEYS (the first
// key signs, every key verifies) whenever keys are configured, whatever the
// mailer: the kill switch (mailer off) stops sending but the links already
// sent keep working. Without keys it is nil and the public endpoints refuse
// every token (the loader requires keys when the mailer is not off). The same
// value is the email.TokenSigner of the renderer (E6) and the verifier of the
// public endpoints. now is nil in production (time.Now).
func newNotificationUnsubscribeSigner(cfg runtimeconfig.NotificationsEmailConfig, now func() time.Time) (*unsubscribe.Signer, error) {
	if len(cfg.UnsubscribeKeys) == 0 {
		return nil, nil
	}
	keys := make([]unsubscribe.Key, len(cfg.UnsubscribeKeys))
	for i, k := range cfg.UnsubscribeKeys {
		keys[i] = unsubscribe.Key{ID: k.ID, Secret: k.Secret}
	}
	return unsubscribe.NewSigner(keys, now)
}

// newNotificationUnsubscribeHandler composes the public GET / POST
// /v2/notifications/unsubscribe over the pool with its limiter (invalid tokens
// per client IP, valid tokens per preference key); a nil signer refuses every
// token, a nil limiter means DefaultLimits.
func newNotificationUnsubscribeHandler(pool *pgxpool.Pool, signer *unsubscribe.Signer, limiter *unsubscribe.Limiter) *unsubscribe.Handler {
	return unsubscribe.NewHandler(signer, unsubscribe.NewStore(pool), limiter)
}
