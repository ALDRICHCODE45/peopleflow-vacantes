//go:build integration

package capture_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pressly/goose/v3"
)

// Migration 00068 (contract §Data model): both tables with their CHECKs and
// dedupe indexes, and a clean Down/Up round trip.
func TestMigration00068Notifications(t *testing.T) {
	pool, sqlDB := disposableDB(t)
	ctx := context.Background()
	if version, err := goose.GetDBVersion(sqlDB); err != nil || version < 68 {
		t.Fatalf("version=%d: %v", version, err)
	}
	f := newFixture(t, pool)
	due := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
	event := uuid.New()
	mustExec(t, pool, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,actor_user_id,job_id,participation_id,subject_user_id,payload)
		VALUES($1,$2,$3,'VacancyResponsibleReassigned',$4,$5,NULL,$4,'{"reason":"workload"}')`, event, uuid.New(), f.company, f.recruiter, f.job)
	var attempts int
	var failed bool
	if err := pool.QueryRow(ctx, `SELECT attempts, failed FROM notification_events WHERE id=$1 AND processed_at IS NULL AND occurred_at IS NOT NULL`, event).Scan(&attempts, &failed); err != nil || attempts != 0 || failed {
		t.Fatal(attempts, failed, err)
	}

	insert := `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,source_event_id,commitment_date)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
	immediate := func(kind, reason string, company any, typ string) []any {
		return []any{uuid.New(), f.recruiter, kind, reason, company, typ, "n:" + uuid.NewString(), f.job, event, nil}
	}
	for _, typ := range []string{"vacancy_reassigned", "vacancy_unassigned", "application_received", "vacancy_assigned", "vacancy_team_added",
		"psychometric_completed", "psychometric_pending"} {
		mustExec(t, pool, insert, immediate("member", "previous_assignee", f.company, typ)...)
	}
	for _, typ := range []string{"candidate_status_changed", "candidate_message_received", "candidate_test_pending"} {
		mustExec(t, pool, insert, immediate("candidate", "candidate", nil, typ)...)
	}
	for _, typ := range []string{"delivery_due_soon", "delivery_overdue", "assignment_deadline_due_soon", "assignment_deadline_overdue"} {
		mustExec(t, pool, insert, uuid.New(), f.recruiter, "member", "team", f.company, typ, "n:"+uuid.NewString(), f.job, nil, due)
	}

	for name, tc := range map[string]struct {
		query string
		args  []any
		code  string
	}{
		"unknown type":              {insert, immediate("member", "team", f.company, "team_added"), "23514"},
		"role reason (stage 3)":     {insert, immediate("member", "role", f.company, "application_received"), "23514"},
		"candidate with company":    {insert, immediate("candidate", "candidate", f.company, "candidate_test_pending"), "23514"},
		"member without company":    {insert, immediate("member", "team", nil, "application_received"), "23514"},
		"scheduled without date":    {insert, []any{uuid.New(), f.recruiter, "member", "team", f.company, "delivery_overdue", "n:x", f.job, nil, nil}, "23514"},
		"immediate without event":   {insert, []any{uuid.New(), f.recruiter, "member", "team", f.company, "application_received", "n:x", f.job, nil, nil}, "23514"},
		"short group key":           {insert, []any{uuid.New(), f.recruiter, "member", "team", f.company, "application_received", "n:", f.job, event, nil}, "23514"},
		"immediate dedupe":          {insert, []any{uuid.New(), f.recruiter, "member", "team", f.company, "vacancy_reassigned", "n:dup", f.job, event, nil}, "23505"},
		"scheduled dedupe":          {insert, []any{uuid.New(), f.recruiter, "member", "team", f.company, "delivery_overdue", "n:dup", f.job, nil, due}, "23505"},
		"audit event captured once": {`INSERT INTO notification_events(id,audit_event_id,company_id,event_type,job_id) SELECT $1::uuid,audit_event_id,company_id,event_type,job_id FROM notification_events WHERE id=$2::uuid`, []any{uuid.New(), event}, "23505"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := pool.Exec(ctx, tc.query, tc.args...); err == nil || !strings.Contains(err.Error(), tc.code) {
				t.Fatalf("want SQLSTATE %s, got %v", tc.code, err)
			}
		})
	}

	if err := goose.DownTo(sqlDB, ".", 67); err != nil {
		t.Fatalf("down to 67: %v", err)
	}
	if tableExists(t, pool, "notifications") || tableExists(t, pool, "notification_events") {
		t.Fatal("down kept a notifications table")
	}
	if err := goose.Up(sqlDB, "."); err != nil {
		t.Fatalf("up again: %v", err)
	}
	if !tableExists(t, pool, "notifications") || !tableExists(t, pool, "notification_events") {
		t.Fatal("re-up did not recreate the tables")
	}
}
