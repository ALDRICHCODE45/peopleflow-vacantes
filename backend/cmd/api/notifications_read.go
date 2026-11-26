package main

import (
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/inbox"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newNotificationsHandler composes the member API of notifications-v1 over the
// pool (N4: GET /v2/me/company/notifications and …/unread-count; N5: POST …/read,
// …/unread, …/read-all and GET …/facets).
func newNotificationsHandler(pool *pgxpool.Pool) *inbox.Handler {
	return inbox.NewHandler(inbox.NewStore(pool))
}
