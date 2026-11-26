// Package schedule is the notifications scheduler (notifications-v1 D20, D21,
// Q1, Q5, Q7, Q8, §Scheduler): once at start and every 15 minutes, under a
// cross-instance advisory lock, it creates delivery due-soon / overdue items
// for the team of every open process with a commitment date, and recruiter
// deadline items for each assignee, then resolves the items that stopped
// being true.
package schedule

import (
	"time"
	_ "time/tzdata" // America/Mexico_City must resolve in minimal containers

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
)

// TimeZone is the business time zone of the date rule (D20).
const TimeZone = "America/Mexico_City"

var mexicoCity = func() *time.Location {
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		panic(err) // tzdata is embedded
	}
	return loc
}()

// Window is the side of the date rule a deadline falls on.
type Window string

const (
	WindowDueSoon Window = "due_soon"
	WindowOverdue Window = "overdue"
)

// DeliveryType is the vacancy delivery notification type of the window.
func (w Window) DeliveryType() domain.Type {
	if w == WindowOverdue {
		return domain.TypeDeliveryOverdue
	}
	return domain.TypeDeliveryDueSoon
}

// AssignmentType is the recruiter deadline notification type of the window.
func (w Window) AssignmentType() domain.Type {
	if w == WindowOverdue {
		return domain.TypeAssignmentDeadlineOverdue
	}
	return domain.TypeAssignmentDeadlineDueSoon
}

// Today is the calendar date of now in America/Mexico_City, as midnight UTC.
func Today(now time.Time) time.Time {
	y, m, d := now.In(mexicoCity).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// civil is the calendar day of a DATE value as midnight UTC, whatever its location.
func civil(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// Classify applies the §Scheduler date rule: a deadline today or tomorrow is
// due soon (T-24h approximated by the local date), one before today is
// overdue (its day has ended); a later one yields nothing (ok=false).
func Classify(deadline, today time.Time) (Window, bool) {
	deadline, today = civil(deadline), civil(today)
	switch {
	case deadline.Before(today):
		return WindowOverdue, true
	case !deadline.After(today.AddDate(0, 0, 1)):
		return WindowDueSoon, true
	default:
		return "", false
	}
}
