package invitations_test

import (
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/psychometrics/application/invitations"
)

func TestStatusAt(t *testing.T) {
	at := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name                         string
		now                          time.Time
		consented, finished, revoked *time.Time
		want                         string
	}{
		{"created", at.Add(-time.Nanosecond), nil, nil, nil, "created"},
		{"consented", at.Add(-time.Nanosecond), &at, nil, nil, "in_progress"},
		{"expiry boundary", at, nil, nil, nil, "expired"},
		{"expiry boundary after consent", at, &at, nil, nil, "expired"},
		{"expired", at.Add(time.Nanosecond), nil, nil, nil, "expired"},
		{"finish precedes expiry", at, &at, &at, nil, "finished"},
		{"revocation precedes expiry", at, &at, nil, &at, "revoked"},
		{"revoked finish", at, &at, &at, &at, "revoked"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := invitations.StatusAt(tc.now, at, tc.consented, tc.finished, tc.revoked)
			if got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
			if active := (invitations.Invitation{Status: got}).Active(); active != (got == "created" || got == "in_progress") {
				t.Fatal("active status", got)
			}
		})
	}
}
