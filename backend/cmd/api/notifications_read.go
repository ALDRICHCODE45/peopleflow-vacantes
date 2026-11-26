package main

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/inbox"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newNotificationsHandler composes the member read API of notifications-v1
// (N4: GET /v2/me/company/notifications and …/unread-count) over the pool.
func newNotificationsHandler(pool *pgxpool.Pool) *inbox.Handler {
	return inbox.NewHandler(inbox.NewStore(pool))
}
