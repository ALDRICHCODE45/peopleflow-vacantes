package main

import (
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/unsubscribe"
	runtimeconfig "github.com/aldrichcode45/peopleflow-vacantes/internal/runtime/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newNotificationUnsubscribeSigner builds the HMAC token signer/verifier of
// notifications-v2 §Unsubscribe from NOTIFICATIONS_UNSUBSCRIBE_KEYS (the first
// key signs, every key verifies). It is nil with the mailer off: no email is
// sent, so no token is issued, and the public endpoints refuse every token.
// The same value is the email.TokenSigner of the renderer (E6) and the
// verifier of the public endpoints. now is nil in production (time.Now).
func newNotificationUnsubscribeSigner(cfg runtimeconfig.NotificationsEmailConfig, now func() time.Time) (*unsubscribe.Signer, error) {
	if !cfg.Enabled() {
		return nil, nil
	}
	keys := make([]unsubscribe.Key, len(cfg.UnsubscribeKeys))
	for i, k := range cfg.UnsubscribeKeys {
		keys[i] = unsubscribe.Key{ID: k.ID, Secret: k.Secret}
	}
	return unsubscribe.NewSigner(keys, now)
}

// newNotificationUnsubscribeHandler composes the public GET / POST
// /v2/notifications/unsubscribe over the pool; a nil signer refuses every token.
func newNotificationUnsubscribeHandler(pool *pgxpool.Pool, signer *unsubscribe.Signer) *unsubscribe.Handler {
	return unsubscribe.NewHandler(signer, unsubscribe.NewStore(pool))
}
