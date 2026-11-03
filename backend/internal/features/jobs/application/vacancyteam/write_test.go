package vacancyteam

import (
	"errors"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/drafts"
	"github.com/google/uuid"
	"strings"
	"testing"
	"time"
)

func TestDecodeTeamWrites(t *testing.T) {
	user := uuid.NewString()
	for _, tc := range []struct {
		name, action, body string
		want               error
	}{
		{"add", Add, `{"user_id":"` + user + `","recruiter_deadline":null}`, nil},
		{"add with date", Add, `{"user_id":"` + user + `","recruiter_deadline":"2026-11-20"}`, nil},
		{"no member", Add, `{}`, drafts.ErrInvalidRequest},
		{"bad UUID", Add, `{"user_id":"bad"}`, drafts.ErrInvalidRequest},
		{"nil UUID", Add, `{"user_id":"00000000-0000-0000-0000-000000000000"}`, drafts.ErrInvalidRequest},
		{"bad date", Deadline, `{"recruiter_deadline":"2026-02-30"}`, drafts.ErrInvalidRequest},
		{"noncanonical date", Deadline, `{"recruiter_deadline":"2026-1-1"}`, drafts.ErrInvalidRequest},
		{"date type", Deadline, `{"recruiter_deadline":10}`, drafts.ErrInvalidRequest},
		{"missing deadline", Deadline, `{}`, drafts.ErrInvalidRequest},
		{"clear deadline", Deadline, `{"recruiter_deadline":null}`, nil},
		{"empty remove", Remove, `{}`, nil},
		{"empty leave", Leave, `{}`, nil},
		{"unknown property", Leave, `{"note":"secret"}`, drafts.ErrInvalidRequest},
		{"duplicate key", Deadline, `{"recruiter_deadline":null,"recruiter_deadline":null}`, drafts.ErrInvalidRequest},
		{"array", Mode, `[]`, drafts.ErrInvalidRequest},
		{"unknown mode", Mode, `{"mode":"solo"}`, drafts.ErrInvalidRequest},
		{"shared", Mode, `{"mode":"shared"}`, nil},
		{"shared rejects responsible", Mode, `{"mode":"shared","responsible_user_id":"` + user + `"}`, ErrResponsibleNotApplicable},
		{"shared rejects explicit null responsible", Mode, `{"mode":"shared","responsible_user_id":null}`, ErrResponsibleNotApplicable},
		{"responsible", Mode, `{"mode":"with_responsible","responsible_user_id":"` + user + `"}`, nil},
		{"default reassignment", Reassign, `{"to_user_id":"` + user + `","reason":"workload"}`, nil},
		{"unknown reason", Reassign, `{"to_user_id":"` + user + `","reason":"secret"}`, drafts.ErrInvalidRequest},
		{"unknown previous", Reassign, `{"to_user_id":"` + user + `","reason":"workload","previous_responsible":"stay"}`, drafts.ErrInvalidRequest},
		{"other missing note", Reassign, `{"to_user_id":"` + user + `","reason":"other"}`, ErrNoteRequired},
		{"other blank note", Reassign, `{"to_user_id":"` + user + `","reason":"other","note":"  "}`, ErrNoteRequired},
		{"other null note", Reassign, `{"to_user_id":"` + user + `","reason":"other","note":null}`, ErrNoteRequired},
		{"other oversized note", Reassign, `{"to_user_id":"` + user + `","reason":"other","note":"` + strings.Repeat("á", 501) + `"}`, ErrNoteRequired},
		{"other max note", Reassign, `{"to_user_id":"` + user + `","reason":"other","note":"` + strings.Repeat("á", 500) + `"}`, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out, err := DecodeWrite(tc.action, []byte(tc.body))
			if !errors.Is(err, tc.want) {
				t.Fatalf("%+v: %v want %v", out, err, tc.want)
			}
			if err == nil && tc.action == Reassign && out.Previous != "remove" {
				t.Fatal(out)
			}
		})
	}
}
func TestSnapshotTramoBusinessDays(t *testing.T) {
	zone, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		t.Fatal(err)
	}
	start := time.Date(2026, 11, 13, 15, 0, 0, 0, zone)       // Friday, before the November Monday holiday.
	capture := time.Date(2026, 11, 18, 0, 30, 0, 0, time.UTC) // Tuesday locally.
	deadline := "2026-11-20"
	past := "2026-11-12"
	for _, tc := range []struct {
		name                  string
		recruiter, commitment *string
		source                string
		total                 *int
	}{
		{"none", nil, nil, "none", nil},
		{"commitment", nil, &deadline, "commitment", intPtr(4)},
		{"recruiter wins", &past, &deadline, "recruiter", intPtr(0)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := SnapshotTramo(start, capture, tc.recruiter, tc.commitment, zone)
			if s.BusinessDaysElapsed != 1 || s.DeadlineSource != tc.source || !s.StartedAt.Equal(start) {
				t.Fatal(s)
			}
			if tc.total == nil {
				if s.BusinessDaysTotal != nil || s.EffectiveDeadline != nil {
					t.Fatal(s)
				}
			} else if s.BusinessDaysTotal == nil || *s.BusinessDaysTotal != *tc.total {
				t.Fatal(s)
			}
		})
	}
}
func intPtr(n int) *int { return &n }
