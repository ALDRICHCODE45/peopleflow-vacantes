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

// newCandidateNotificationsHandler composes the candidate API of notifications-v1
// over the pool (N6: the same six routes under /v2/me/notifications, candidate scope).
func newCandidateNotificationsHandler(pool *pgxpool.Pool) *inbox.Handler {
	return inbox.NewCandidateHandler(inbox.NewStore(pool))
}
