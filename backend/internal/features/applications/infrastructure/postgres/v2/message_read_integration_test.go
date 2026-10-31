//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"io/fs"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/db/migrations"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	apphttp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/http/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/identity/domain/security"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func TestCandidateMessageReadLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("database integration")
	}
	m := setupMovement(t)
	ctx := context.Background()
	item := func() app.Item {
		t.Helper()
		p, e := m.store.List(ctx, m.sub, app.Query{Limit: 20})
		if e != nil || len(p.Items) != 1 {
			t.Fatal(p, e)
		}
		return p.Items[0]
	}
	request := func(sub string, id uuid.UUID, at time.Time, status int, code string) {
		t.Helper()
		before := m.snapshot(t)
		r := chi.NewRouter()
		r.Put("/v2/me/applications/{id}/message-read", apphttp.NewHandler(m.store, draftjson.Decode).MarkMessageRead)
		body, _ := json.Marshal(map[string]string{"updated_at": at.Format(time.RFC3339Nano)})
		req := httptest.NewRequest("PUT", "/v2/me/applications/"+id.String()+"/message-read", strings.NewReader(string(body)))
		req = req.WithContext(security.ContextWithClaims(req.Context(), security.Claims{Subject: sub}))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		want := ""
		if code != "" {
			message := map[string]string{"not_found": "not found", "message_unavailable": "message unavailable", "message_changed": "message changed"}[code]
			want = `{"error":"` + message + `","code":"` + code + `"}` + "\n"
		}
		if w.Code != status || w.Body.String() != want || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("ETag") != "" {
			t.Fatal(w.Code, w.Body.String(), w.Header())
		}
		if status != 204 && before != m.snapshot(t) {
			t.Fatal("rejection changed stored data/counters")
		}
	}
	discard := func(body, tag string) string {
		t.Helper()
		w := movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/discard", tag, body)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		return movementObject(t, w.Body.Bytes())["etag"].(string)
	}
	initial := item()
	if initial.Message != nil || initial.MessageReadAt != nil {
		t.Fatal(initial)
	}
	request(m.sub, m.item.ID, initial.UpdatedAt, 409, "message_unavailable")
	request(m.other, m.item.ID, initial.UpdatedAt, 404, "not_found")
	request(m.sub, uuid.New(), initial.UpdatedAt, 404, "not_found")
	tag := discard(`{"reason":{"group":"candidate","key":"unresponsive"}}`, m.item.ETag)
	request(m.sub, m.item.ID, item().UpdatedAt, 409, "message_unavailable")
	recover := func(tag string) string {
		t.Helper()
		w := movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/recover", tag, `{}`)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
		return movementObject(t, w.Body.Bytes())["etag"].(string)
	}
	tag = recover(tag)
	tag = discard(discardBody, tag)
	unread := item()
	if unread.Message == nil || unread.MessageReadAt != nil {
		t.Fatal(unread)
	}
	request(m.sub, m.item.ID, initial.UpdatedAt, 409, "message_changed")
	request(m.sub, m.item.ID, unread.UpdatedAt, 204, "")
	read := item()
	if read.MessageReadAt == nil || read.MessageReadAt.Before(read.AppliedAt) || read.MessageReadAt.Location() != time.UTC || !read.UpdatedAt.Equal(unread.UpdatedAt) {
		t.Fatal(read)
	}
	before := m.snapshot(t)
	request(m.sub, m.item.ID, unread.UpdatedAt, 204, "")
	if before != m.snapshot(t) || !item().MessageReadAt.Equal(*read.MessageReadAt) {
		t.Fatal("repeat changed first time or other state")
	}
	tag = recover(tag)
	recovered := item()
	if recovered.Message != nil || recovered.MessageReadAt != nil {
		t.Fatal(recovered)
	}
	discard(discardBody, tag)
	if item().MessageReadAt != nil {
		t.Fatal("new discard is not unread")
	}
}

func TestMigration00052DownGuard(t *testing.T) {
	if testing.Short() {
		t.Skip("database integration")
	}
	m := setupMovement(t)
	ctx := context.Background()
	raw, err := fs.ReadFile(migrations.MigrationsFS, "00052_candidate_message_read.sql")
	if err != nil {
		t.Fatal(err)
	}
	down := strings.Split(string(raw), "-- +goose Down")[1]
	down = strings.ReplaceAll(strings.ReplaceAll(down, "-- +goose StatementBegin", ""), "-- +goose StatementEnd", "")
	tx, err := m.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, down); err != nil {
		t.Fatal("empty down", err)
	}
	tx.Rollback(ctx)
	w := movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/discard", m.item.ETag, discardBody)
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if err = m.store.MarkMessageRead(ctx, m.sub, m.item.ID, page.Items[0].UpdatedAt); err != nil {
		t.Fatal(err)
	}
	before := m.snapshot(t)
	tx, err = m.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, down); err == nil || !strings.Contains(err.Error(), "read data exists") {
		t.Fatal("down erased read data", err)
	}
	tx.Rollback(ctx)
	if before != m.snapshot(t) {
		t.Fatal("failed down changed state")
	}
	// Both CHECK invariants reject invalid writes without changing the row.
	for _, sql := range []string{`UPDATE process_participations SET candidate_message_read_at=created_at-interval '1 second' WHERE id=$1`, `UPDATE process_participations SET candidate_message=NULL WHERE id=$1`} {
		if _, err = m.pool.Exec(ctx, sql, m.item.ID); err == nil || before != m.snapshot(t) {
			t.Fatal("invalid read state accepted", err)
		}
	}
}
