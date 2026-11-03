//go:build integration

package main

import (
	"context"
	"errors"
	"fmt"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"sync/atomic"
	"testing"
)

type teamFailAudit struct {
	event   string
	enabled atomic.Bool
}

func (a *teamFailAudit) Append(ctx context.Context, tx pgx.Tx, event audit.AuditEvent) error {
	if a.enabled.Load() && event.EventType == a.event {
		return errors.New("test team audit failure")
	}
	return auditpostgres.NewAuditEventRepository().Append(ctx, tx, event)
}
func TestTeamWritesAuditRollback(t *testing.T) {
	for _, tc := range []struct{ action, event string }{
		{"add", "VacancyTeamMemberAdded"}, {"remove", "VacancyTeamMemberRemoved"}, {"leave", "VacancyTeamMemberLeft"}, {"deadline", "VacancyAssignmentDeadlineChanged"}, {"reassign", "VacancyResponsibleReassigned"}, {"mode", "VacancyTeamModeChanged"},
	} {
		t.Run(tc.action, func(t *testing.T) {
			fault := &teamFailAudit{event: tc.event}
			h := newDraftFlowHarnessWithAudit(t, fault)
			company, ownerID, sub := draftFlowNewPrincipal(t, h.pool, "active")
			owner := h.actor(t, ownerID, sub)
			peer, _ := company.addUser(t, "recruiter")
			next, _ := company.addUser(t, "recruiter")
			id := draftListFlowCreate(t, h, owner, `{"fields":{}}`)
			base := draftFlowV2Path + "/" + id + "/team"
			tag := h.do(t, "GET", base, "", owner.token, nil).header.Get("ETag")
			added := h.do(t, "POST", base+"/members", fmt.Sprintf(`{"user_id":%q}`, peer), owner.token, map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()})
			if added.status != 200 {
				t.Fatal(added.status, string(added.body))
			}
			tag = added.header.Get("ETag")
			method, path, body := "POST", "/members", fmt.Sprintf(`{"user_id":%q}`, next)
			switch tc.action {
			case "remove":
				path += "/" + peer.String() + "/remove"
				body = "{}"
			case "leave":
				shared := h.do(t, "PUT", base+"/mode", `{"mode":"shared"}`, owner.token, map[string]string{"If-Match": tag})
				if shared.status != 200 {
					t.Fatal(shared.status, string(shared.body))
				}
				tag = shared.header.Get("ETag")
				path = "/leave"
				body = "{}"
			case "deadline":
				method = "PATCH"
				path += "/" + peer.String()
				body = `{"recruiter_deadline":"2027-01-05"}`
			case "reassign":
				path = "/reassign-responsible"
				body = fmt.Sprintf(`{"to_user_id":%q,"reason":"other","note":"private note"}`, next)
			case "mode":
				method = "PUT"
				path = "/mode"
				body = `{"mode":"shared"}`
			}
			headers := map[string]string{"If-Match": tag, "Idempotency-Key": uuid.NewString()}
			before := teamWriteState(t, h, id)
			fault.enabled.Store(true)
			failed := h.do(t, method, base+path, body, owner.token, headers)
			draftFlowAssertCatalogError(t, failed, 500, "internal_error")
			if teamWriteState(t, h, id) != before {
				t.Fatal("audit failure did not roll back entire write")
			}
			fault.enabled.Store(false)
			success := h.do(t, method, base+path, body, owner.token, headers)
			if success.status != 200 || success.header.Get("ETag") == tag {
				t.Fatal(success.status, string(success.body))
			}
			if method == "POST" {
				after := teamWriteState(t, h, id)
				replay := h.do(t, method, base+path, body, owner.token, headers)
				if replay.status != 200 || string(replay.body) != string(success.body) || replay.header.Get("ETag") != success.header.Get("ETag") || replay.header.Get("Idempotency-Replayed") != "true" || teamWriteState(t, h, id) != after {
					t.Fatal("nonfrozen replay", replay.status, string(replay.body))
				}
			}
		})
	}
}
