//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	boardstore "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/board"
	auditentities "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/domain/entities"
	audit "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/draftjson"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/jackc/pgx/v5"
)

type failSubstateAudit struct{ calls, failAt int }

func (a *failSubstateAudit) Append(ctx context.Context, tx pgx.Tx, e auditentities.AuditEvent) error {
	a.calls++
	if a.calls == a.failAt {
		return errors.New("injected substate audit failure")
	}
	return audit.NewAuditEventRepository().Append(ctx, tx, e)
}

func TestSubstateReassignmentAnyOrderAndExactlyOneVersion(t *testing.T) {
	m, id := activeSubstateFixture(t)
	ctx := context.Background()
	c, err := m.drafts.GetSubstates(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	other := movementObject(t, c.Body)["substates"].([]any)[1].(map[string]any)["id"].(string)
	original := m.item
	cov, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{other, id, other} {
		previous := m.item
		m.item = setSubstateHTTP(t, m, target)
		if m.item.Version != incrementVersion(t, previous.Version) || m.item.ETag == previous.ETag || m.item.StageID != original.StageID || m.item.Candidate != original.Candidate || m.item.CV != original.CV || m.item.Source != original.Source || !m.item.AppliedAt.Equal(original.AppliedAt) {
			t.Fatal("set altered non-substate identity or wrong version", m.item)
		}
		view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
		if err != nil || !reflect.DeepEqual(view.Coverage, cov.Coverage) || !reflect.DeepEqual(view.Participations[0], m.item) {
			t.Fatal(view, err)
		}
	}
	h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
	if err != nil || len(h.Items) != 7 {
		t.Fatal(h, err)
	}
	for i, expected := range []struct{ from, to *string }{{nil, &other}, {&other, &id}, {&id, &other}} {
		e := h.Items[i+4]
		if e.Kind != "substate" || !reflect.DeepEqual(e.FromSubstateID, expected.from) || !reflect.DeepEqual(e.ToSubstateID, expected.to) || e.Actor.ID != m.recruiter || e.Actor.Kind != "recruiter" || e.At.IsZero() || !e.At.After(h.Items[i+3].At) {
			t.Fatal(e)
		}
	}
}

func TestSubstateAuditFailuresRollbackSetClearAndLeave(t *testing.T) {
	for _, op := range []string{"set", "clear", "move", "discard"} {
		t.Run(op, func(t *testing.T) {
			m, id := activeSubstateFixture(t)
			if op != "set" {
				m.item = setSubstateHTTP(t, m, id)
			}
			a := &failSubstateAudit{failAt: 1}
			if op == "move" || op == "discard" {
				a.failAt = 2
			}
			s := boardstore.NewStore(m.pool, a, movementContext{m.drafts}, m.storage, draftjson.Decode)
			before := catalogSnapshot(t, m)
			ctx := context.Background()
			var out board.Moved
			var err error
			switch op {
			case "set":
				out, err = s.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":"`+id+`"}`))
			case "clear":
				out, err = s.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":null}`))
			case "move":
				raw, _ := json.Marshal(map[string]any{"to_stage_id": pipelineconfig.Defaults(m.vacancy).Stages[4].ID})
				out, err = s.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, raw)
			case "discard":
				out, err = s.Discard(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(discardBody))
			}
			if err == nil || !reflect.DeepEqual(out, board.Moved{}) || a.calls != a.failAt || before != catalogSnapshot(t, m) {
				t.Fatal("audit failure left writes", out, err, a.calls)
			}
		})
	}
}
