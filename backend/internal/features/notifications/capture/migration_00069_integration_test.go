//go:build integration

package capture_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
)

func wantSQLState(t *testing.T, pool *pgxpool.Pool, code, query string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), query, args...); err == nil || !strings.Contains(err.Error(), code) {
		t.Fatalf("want SQLSTATE %s, got %v", code, err)
	}
}

func columnExists(t *testing.T, pool *pgxpool.Pool, table, column string) bool {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2)`, table, column).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	return exists
}

func indexDef(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	var def string
	if err := pool.QueryRow(context.Background(), `SELECT COALESCE((SELECT indexdef FROM pg_indexes WHERE indexname=$1), '')`, name).Scan(&def); err != nil {
		t.Fatal(err)
	}
	return def
}

// Migration 00069 (notifications-v2 §Data model): preferences refuse every
// mandatory type (D2) and mismatched trees, keys are unique with NULL company
// (D1), suppressions are normalized (D18), deliveries keep one open window
// per recipient and group (D10), notifications gain in_app (default true, D6)
// and email_delivery_id, the unread index only covers visible rows, and
// Down/Up round-trips with pre-existing rows defaulting to visible.
func TestMigration00069NotificationsEmail(t *testing.T) {
	pool, sqlDB := disposableDB(t)
	ctx := context.Background()
	if version, err := goose.GetDBVersion(sqlDB); err != nil || version < 69 {
		t.Fatalf("version=%d: %v", version, err)
	}
	f := newFixture(t, pool)

	// Preferences: every non-mandatory type × channel is storable in its tree;
	// every mandatory type is refused in both channels (CHECK, 23514).
	insertPref := `INSERT INTO notification_preferences(user_id,company_id,type,channel,enabled,source) VALUES($1,$2,$3,$4,$5,$6)`
	for _, spec := range domain.Types() {
		user, company := f.recruiter, any(f.company)
		if spec.RecipientKind == domain.RecipientCandidate {
			user, company = f.candidate, nil
		}
		for _, ch := range domain.Channels() {
			if spec.Kind == domain.KindMandatory {
				wantSQLState(t, pool, "23514", insertPref, user, company, string(spec.Type), string(ch), true, "settings")
				continue
			}
			mustExec(t, pool, insertPref, user, company, string(spec.Type), string(ch), false, "settings")
		}
	}
	var stored int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notification_preferences`).Scan(&stored); err != nil || stored != 2*len(domain.OverridableTypes()) {
		t.Fatalf("stored preferences = %d (%v), want %d", stored, err, 2*len(domain.OverridableTypes()))
	}
	var updatedAt time.Time
	if err := pool.QueryRow(ctx, `SELECT updated_at FROM notification_preferences LIMIT 1`).Scan(&updatedAt); err != nil || updatedAt.IsZero() {
		t.Fatalf("updated_at default: %v %v", updatedAt, err)
	}
	for name, tc := range map[string]struct {
		args []any
		code string
	}{
		"candidate key unique with NULL company": {[]any{f.candidate, nil, "candidate_test_pending", "email", true, "unsubscribe"}, "23505"},
		"member key unique":                      {[]any{f.recruiter, f.company, "application_received", "in_app", true, "settings"}, "23505"},
		"member type without company":            {[]any{f.recruiter, nil, "application_received", "email", true, "settings"}, "23514"},
		"candidate type with company":            {[]any{f.candidate, f.company, "candidate_status_changed", "email", true, "settings"}, "23514"},
		"unknown type":                           {[]any{f.recruiter, f.company, "team_added", "email", true, "settings"}, "23514"},
		"unknown channel":                        {[]any{f.recruiter, f.company, "application_received", "sms", true, "settings"}, "23514"},
		"unknown source":                         {[]any{f.recruiter, f.company, "application_received", "email", true, "admin"}, "23514"},
		"mandatory even when off":                {[]any{f.recruiter, f.company, "delivery_overdue", "email", false, "unsubscribe"}, "23514"},
	} {
		t.Run("preferences/"+name, func(t *testing.T) { wantSQLState(t, pool, tc.code, insertPref, tc.args...) })
	}
	// Rows go with their user (ON DELETE CASCADE).
	gone := uuid.New()
	mustExec(t, pool, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Gone','candidate')`, gone, uuid.NewString(), uuid.NewString()+"@example.test")
	mustExec(t, pool, insertPref, gone, nil, "candidate_status_changed", "email", false, "unsubscribe")
	mustExec(t, pool, `DELETE FROM users WHERE id=$1`, gone)
	var left int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM notification_preferences WHERE user_id=$1`, gone).Scan(&left); err != nil || left != 0 {
		t.Fatalf("preferences of a deleted user = %d (%v)", left, err)
	}

	// Suppressions: normalized, non-empty, bounded address; closed reasons.
	insertSup := `INSERT INTO email_suppressions(address,reason) VALUES($1,$2)`
	mustExec(t, pool, insertSup, "bounced@example.test", "bounce")
	for name, args := range map[string][]any{
		"duplicate":      {"bounced@example.test", "manual"},
		"upper case":     {"Bounced@Example.test", "bounce"},
		"padded":         {" x@example.test", "bounce"},
		"empty":          {"", "manual"},
		"too long":       {strings.Repeat("a", 310) + "@example.test", "manual"},
		"unknown reason": {"y@example.test", "spam"},
	} {
		code := "23514"
		if name == "duplicate" {
			code = "23505"
		}
		t.Run("suppressions/"+name, func(t *testing.T) { wantSQLState(t, pool, code, insertSup, args...) })
	}

	// Deliveries: one pending window per (recipient, group); status CHECKs.
	insertDel := `INSERT INTO notification_email_deliveries(id,recipient_user_id,recipient_kind,company_id,type,group_key,job_id,status,skip_reason,send_after,sent_at)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10)`
	group := "applications:" + f.job.String() + ":2026-11-26"
	open := uuid.Must(uuid.NewV7())
	mustExec(t, pool, insertDel, open, f.recruiter, "member", f.company, "application_received", group, f.job, "pending", nil, nil)
	var attempts int
	var status string
	if err := pool.QueryRow(ctx, `SELECT status, attempts FROM notification_email_deliveries WHERE id=$1`, open).Scan(&status, &attempts); err != nil || status != "pending" || attempts != 0 {
		t.Fatalf("delivery defaults: %s %d %v", status, attempts, err)
	}
	mustExec(t, pool, insertDel, uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "sent", nil, time.Now())
	mustExec(t, pool, insertDel, uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "skipped", "read", nil)
	mustExec(t, pool, insertDel, uuid.Must(uuid.NewV7()), f.candidate, "candidate", nil, "candidate_test_pending", "n:"+uuid.NewString(), f.job, "pending", nil, nil)
	for name, tc := range map[string]struct {
		args []any
		code string
	}{
		"second open window":     {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "pending", nil, nil}, "23505"},
		"sent without sent_at":   {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "sent", nil, nil}, "23514"},
		"sent_at while pending":  {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "vacancy_assigned", "n:x1", f.job, "pending", nil, time.Now()}, "23514"},
		"skipped without reason": {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "skipped", nil, nil}, "23514"},
		"reason while failed":    {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "failed", "read", nil}, "23514"},
		"unknown skip reason":    {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "skipped", "bored", nil}, "23514"},
		"unknown status":         {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "queued", nil, nil}, "23514"},
		"candidate with company": {[]any{uuid.Must(uuid.NewV7()), f.candidate, "candidate", f.company, "candidate_test_pending", "n:x2", f.job, "pending", nil, nil}, "23514"},
		"member without company": {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", nil, "vacancy_assigned", "n:x3", f.job, "pending", nil, nil}, "23514"},
		"short group key":        {[]any{uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "vacancy_assigned", "n:", f.job, "pending", nil, nil}, "23514"},
	} {
		t.Run("deliveries/"+name, func(t *testing.T) { wantSQLState(t, pool, tc.code, insertDel, tc.args...) })
	}
	// Leaving the window ('sending') frees the slot for a new pending one.
	mustExec(t, pool, `UPDATE notification_email_deliveries SET status='sending', lease_until=now() WHERE id=$1`, open)
	mustExec(t, pool, insertDel, uuid.Must(uuid.NewV7()), f.recruiter, "member", f.company, "application_received", group, f.job, "pending", nil, nil)

	// Notifications: in_app defaults to true, email_delivery_id links a delivery
	// and is cleared when the delivery goes.
	event := uuid.New()
	mustExec(t, pool, `INSERT INTO notification_events(id,audit_event_id,company_id,event_type,job_id) VALUES($1,$2,$3,'VacancyApplicationSubmitted',$4)`, event, uuid.New(), f.company, f.job)
	visible, hidden := uuid.New(), uuid.New()
	insertNotif := `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,source_event_id,email_delivery_id)
		VALUES($1,$2,'member','team',$3,'application_received',$4,$5,$6,$7)`
	mustExec(t, pool, insertNotif, visible, f.recruiter, f.company, group, f.job, event, open)
	mustExec(t, pool, `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,source_event_id,in_app)
		VALUES($1,$2,'member','team',$3,'psychometric_completed',$4,$5,$6,false)`, hidden, f.recruiter, f.company, "n:"+hidden.String(), f.job, event)
	var inApp bool
	if err := pool.QueryRow(ctx, `SELECT in_app FROM notifications WHERE id=$1`, visible).Scan(&inApp); err != nil || !inApp {
		t.Fatalf("in_app default = %v (%v), want true", inApp, err)
	}
	wantSQLState(t, pool, "23502", `UPDATE notifications SET in_app=NULL WHERE id=$1`, visible)
	wantSQLState(t, pool, "23503", `UPDATE notifications SET email_delivery_id=$2 WHERE id=$1`, visible, uuid.New())
	mustExec(t, pool, `DELETE FROM notification_email_deliveries WHERE id=$1`, open)
	var link *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT email_delivery_id FROM notifications WHERE id=$1`, visible).Scan(&link); err != nil || link != nil {
		t.Fatalf("email_delivery_id after delivery delete = %v (%v), want NULL", link, err)
	}
	if def := indexDef(t, pool, "notifications_recipient_unread"); !strings.Contains(def, "in_app") || !strings.Contains(def, "read_at IS NULL") {
		t.Fatalf("unread index = %q, want the in_app predicate", def)
	}
	for _, idx := range []string{"notification_email_deliveries_open", "notification_email_deliveries_due", "notification_email_deliveries_created", "notifications_email_delivery"} {
		if indexDef(t, pool, idx) == "" {
			t.Errorf("index %s missing", idx)
		}
	}

	// Down: the three tables and two columns go, the stage-1 unread index is back.
	if err := goose.DownTo(sqlDB, ".", 68); err != nil {
		t.Fatalf("down to 68: %v", err)
	}
	for _, table := range []string{"notification_preferences", "email_suppressions", "notification_email_deliveries"} {
		if tableExists(t, pool, table) {
			t.Fatalf("down kept %s", table)
		}
	}
	if columnExists(t, pool, "notifications", "in_app") || columnExists(t, pool, "notifications", "email_delivery_id") {
		t.Fatal("down kept a notifications column")
	}
	if def := indexDef(t, pool, "notifications_recipient_unread"); def == "" || strings.Contains(def, "in_app") {
		t.Fatalf("stage-1 unread index after down = %q", def)
	}
	// A row written at 68 is visible after Up again.
	stage1 := uuid.New()
	mustExec(t, pool, `INSERT INTO notifications(id,recipient_user_id,recipient_kind,recipient_reason,company_id,type,group_key,job_id,source_event_id)
		VALUES($1,$2,'member','team',$3,'vacancy_assigned',$4,$5,$6)`, stage1, f.recruiter, f.company, "n:"+stage1.String(), f.job, event)
	if err := goose.Up(sqlDB, "."); err != nil {
		t.Fatalf("up again: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT in_app FROM notifications WHERE id=$1`, stage1).Scan(&inApp); err != nil || !inApp {
		t.Fatalf("pre-existing row in_app = %v (%v), want true", inApp, err)
	}
	for _, table := range []string{"notification_preferences", "email_suppressions", "notification_email_deliveries"} {
		if !tableExists(t, pool, table) {
			t.Fatalf("re-up did not recreate %s", table)
		}
	}
}
