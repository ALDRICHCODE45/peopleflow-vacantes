//go:build integration

package v2

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"

	board "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/substatecatalog"
	"github.com/google/uuid"
)

func activeSubstateFixture(t *testing.T) (movementFixture, string) {
	t.Helper()
	m := setupMovement(t)
	result, err := m.drafts.PutSubstates(context.Background(), m.company, m.recruiter, m.vacancy, substatecatalog.ETag(m.vacancy, 0), true, []byte(`{"substates":[{"name":"Interview"},{"name":"Unused"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	id := movementObject(t, result.Body)["substates"].([]any)[0].(map[string]any)["id"].(string)
	stages := pipelineconfig.Defaults(m.vacancy).Stages
	for i := 1; i <= 3; i++ {
		out, err := m.move(t, m.item, stages[i].ID, false)
		if err != nil {
			t.Fatal(err)
		}
		m.item = out.Item
	}
	return m, id
}
func setSubstateHTTP(t *testing.T, m movementFixture, id any) board.Item {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"substate_id": id})
	rec := movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/substate", m.item.ETag, string(raw))
	if rec.Code != 200 {
		t.Fatal(rec.Code, rec.Body.String())
	}
	obj := movementObject(t, rec.Body.Bytes())
	movementItemKeys(t, obj, "coverage", "delivery")
	movementKeys(t, obj["delivery"], "state", "delivered", "target")
	if obj["substate_id"] != id || rec.Header().Get("ETag") != obj["etag"] {
		t.Fatal(obj, rec.Header())
	}
	var out board.Moved
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.Item
}
func catalogSnapshot(t *testing.T, m movementFixture) string {
	t.Helper()
	var raw string
	if err := m.pool.QueryRow(context.Background(), `SELECT json_build_array((SELECT row_to_json(c) FROM job_draft_substate_catalogs c WHERE draft_id=$1),(SELECT json_agg(a ORDER BY id) FROM audit_events a WHERE entity_id=$1))::text`, m.vacancy).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return m.snapshot(t) + raw
}
func TestSubstateSetClearNoOpWireSnapshotsAndCatalog(t *testing.T) {
	m, id := activeSubstateFixture(t)
	ctx := context.Background()
	before := catalogSnapshot(t, m)
	initial := m.item
	nullItem := setSubstateHTTP(t, m, nil)
	if before != catalogSnapshot(t, m) {
		t.Fatal("clear null no-op wrote effects")
	}
	noOpView, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || len(noOpView.Participations) != 1 {
		t.Fatal("expected one board participation after no-op", err)
	}
	assertBoardMatchesMutationItem(t, noOpView.Participations[0], nullItem, initial)
	m.item = setSubstateHTTP(t, m, id)
	before = catalogSnapshot(t, m)
	old := m.item
	m.item = setSubstateHTTP(t, m, id)
	if !reflect.DeepEqual(old, m.item) || before != catalogSnapshot(t, m) {
		t.Fatal("no-op wrote effects")
	}
	view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil || len(view.Participations) != 1 {
		t.Fatal("expected one board participation", err)
	}
	assertBoardMatchesMutationItem(t, view.Participations[0], m.item, initial)
	raw, _ := json.Marshal(view)
	obj := movementKeys(t, movementObject(t, raw), "stages", "exit", "coverage", "participations", "substates", "delivery", "retired_stages", "screening_filters")
	entries := obj["substates"].([]any)
	if len(entries) != 2 {
		t.Fatal(obj)
	}
	movementKeys(t, entries[0], "id", "name")
	if entries[0].(map[string]any)["id"] != id {
		t.Fatal("catalog order", obj)
	}
	detail := movementRequest(t, m, "GET", m.vacancy, m.item.ID, "", "", "")
	d := movementObject(t, detail.Body.Bytes())
	movementItemKeys(t, d, "screening", "comment", "candidate_message")
	if d["substate_id"] != id {
		t.Fatal(d)
	}
	page, err := m.store.List(ctx, m.sub, app.Query{Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = json.Marshal(page)
	movementKeys(t, movementObject(t, raw)["items"].([]any)[0], "id", "vacancy", "company", "applied_at", "status", "message")
	c, err := m.drafts.GetSubstates(ctx, m.company, m.recruiter, m.vacancy)
	if err != nil {
		t.Fatal(err)
	}
	catalog := movementObject(t, c.Body)["substates"].([]any)
	first := movementKeys(t, catalog[0], "id", "name", "in_use")
	if first["in_use"] != true || catalog[1].(map[string]any)["in_use"] != false {
		t.Fatal(catalog)
	}
	before = catalogSnapshot(t, m)
	_, err = m.drafts.PutSubstates(ctx, m.company, m.recruiter, m.vacancy, c.ETag, true, []byte(`{"substates":[]}`))
	var used *substatecatalog.InUseError
	if !errors.As(err, &used) || !reflect.DeepEqual(used.IDs, []string{id}) || before != catalogSnapshot(t, m) {
		t.Fatal("used removal was not atomic", err)
	}
	// Rename occupied id and remove unused id. Neither operation changes participation ETag.
	c, err = m.drafts.PutSubstates(ctx, m.company, m.recruiter, m.vacancy, c.ETag, true, []byte(`{"substates":[{"id":"`+id+`","name":"Renamed"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	m.item = setSubstateHTTP(t, m, nil)
	_, err = m.drafts.PutSubstates(ctx, m.company, m.recruiter, m.vacancy, c.ETag, true, []byte(`{"substates":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	history := movementRequest(t, m, "GET", m.vacancy, m.item.ID, "/history", "", "")
	hs := movementObject(t, history.Body.Bytes())["items"].([]any)
	if len(hs) != 6 {
		t.Fatal(hs)
	}
	for i, want := range []struct{ fromID, fromName, toID, toName any }{{nil, nil, id, "Interview"}, {id, "Renamed", nil, nil}} {
		e := movementKeys(t, hs[4+i], "kind", "from_substate_id", "from_substate_name", "to_substate_id", "to_substate_name", "actor", "at")
		if e["kind"] != "substate" || e["from_substate_id"] != want.fromID || e["from_substate_name"] != want.fromName || e["to_substate_id"] != want.toID || e["to_substate_name"] != want.toName {
			t.Fatal(e)
		}
	}
	var audits int
	if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationSubstateChanged' AND actor_id=$2`, m.item.ID, m.recruiter).Scan(&audits); err != nil || audits != 2 {
		t.Fatal(audits, err)
	}
}

func TestSubstateClearsBeforeLeaveAndReentryIsNull(t *testing.T) {
	for _, op := range []string{"forward", "backward", "discard"} {
		t.Run(op, func(t *testing.T) {
			m, id := activeSubstateFixture(t)
			m.item = setSubstateHTTP(t, m, id)
			stages := pipelineconfig.Defaults(m.vacancy).Stages
			var out board.Moved
			var err error
			switch op {
			case "discard":
				out, err = m.board.Discard(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(discardBody))
			case "forward":
				out, err = m.move(t, m.item, stages[4].ID, false)
			default:
				out, err = m.move(t, m.item, stages[2].ID, false)
			}
			if err != nil || out.SubstateID != nil || out.Version != incrementVersion(t, m.item.Version) {
				t.Fatal(out, err)
			}
			persisted, e := m.board.Detail(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID)
			if e != nil || !reflect.DeepEqual(persisted.Item, out.Item) {
				t.Fatal(persisted, e)
			}
			m.item = out.Item
			h, err := m.board.History(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID)
			if err != nil {
				t.Fatal(err)
			}
			n := len(h.Items)
			if n != 7 || h.Items[n-2].Kind != "substate" || h.Items[n-2].ToSubstateID != nil || h.Items[n-2].FromSubstateID == nil || *h.Items[n-2].FromSubstateID != id || !h.Items[n-2].At.Before(h.Items[n-1].At) {
				t.Fatal(h)
			}
			wantKind := "move"
			if op == "discard" {
				wantKind = "discard"
			}
			if h.Items[n-1].Kind != wantKind || h.Items[n-2].FromSubstateName == nil || *h.Items[n-2].FromSubstateName != "Interview" || h.Items[n-2].ToSubstateName != nil {
				t.Fatal(h)
			}
			if op == "discard" {
				out, err = m.board.Recover(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{}`))
			} else {
				out, err = m.move(t, m.item, stages[3].ID, true)
			}
			if err != nil || out.SubstateID != nil || out.StageID != stages[3].ID || out.Version != incrementVersion(t, m.item.Version) {
				t.Fatal(out, err)
			}
		})
	}
}

func TestSubstateRejectsWithoutAnyEffects(t *testing.T) {
	m, id := activeSubstateFixture(t)
	other := setupMovement(t)
	for _, tc := range []struct {
		name, body, tag string
		pid             uuid.UUID
		status          int
		code            string
	}{
		{"unknown", `{"substate_id":"` + uuid.NewString() + `"}`, m.item.ETag, m.item.ID, 400, "validation_error"},
		{"missing member", `{}`, m.item.ETag, m.item.ID, 400, "invalid_request"},
		{"duplicate", `{"substate_id":null,"substate_id":null}`, m.item.ETag, m.item.ID, 400, "invalid_request"},
		{"unknown member", `{"substate_id":null,"name":"x"}`, m.item.ETag, m.item.ID, 400, "invalid_request"},
		{"wrong type", `{"substate_id":1}`, m.item.ETag, m.item.ID, 400, "invalid_request"},
		{"bad uuid", `{"substate_id":"bad"}`, m.item.ETag, m.item.ID, 400, "invalid_request"},
		{"missing tag", `{"substate_id":null}`, "", m.item.ID, 428, "precondition_required"},
		{"stale", `{"substate_id":null}`, `"foreign"`, m.item.ID, 412, "version_conflict"},
		{"weak", `{"substate_id":null}`, `W/"foreign"`, m.item.ID, 400, "invalid_request"},
		{"actual foreign", `{"substate_id":null}`, other.item.ETag, other.item.ID, 404, "not_found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := catalogSnapshot(t, m)
			rec := movementRequest(t, m, "POST", m.vacancy, tc.pid, "/substate", tc.tag, tc.body)
			obj := movementKeys(t, movementObject(t, rec.Body.Bytes()), "error", "code")
			if rec.Code != tc.status || obj["code"] != tc.code || rec.Header().Get("ETag") != "" || before != catalogSnapshot(t, m) {
				t.Fatal(rec.Code, obj)
			}
		})
	}
	beforeForeign, otherBefore := catalogSnapshot(t, m), other.snapshot(t)
	foreign := movementRequest(t, m, "POST", other.vacancy, other.item.ID, "/substate", other.item.ETag, `{"substate_id":null}`)
	if foreign.Code != 404 || movementObject(t, foreign.Body.Bytes())["code"] != "not_found" || beforeForeign != catalogSnapshot(t, m) || otherBefore != other.snapshot(t) {
		t.Fatal("foreign vacancy wrote effects", foreign.Code, foreign.Body.String())
	}
	config := pipelineconfig.Defaults(m.vacancy)
	custom := pipelineconfig.Stage{ID: uuid.NewString(), Kind: "custom", Name: "Custom"}
	config.Stages = append(config.Stages[:len(config.Stages)-1], custom, config.Stages[len(config.Stages)-1])
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = m.pool.Exec(context.Background(), `INSERT INTO job_draft_pipeline_configs(draft_id,version,configuration) VALUES($1,1,$2)`, m.vacancy, encoded); err != nil {
		t.Fatal(err)
	}
	stages := config.Stages
	// Every progression kind outside in_process, plus the discarded exit; even clear is rejected.
	for _, stage := range stages {
		if stage.Kind == "in_process" {
			continue
		}
		t.Run(stage.Kind, func(t *testing.T) {
			if _, err := m.pool.Exec(context.Background(), `UPDATE process_participations SET stage_id=$2 WHERE id=$1`, m.item.ID, stage.ID); err != nil {
				t.Fatal(err)
			}
			for _, body := range []string{`{"substate_id":null}`, `{"substate_id":"` + id + `"}`} {
				before := catalogSnapshot(t, m)
				rec := movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/substate", m.item.ETag, body)
				if rec.Code != 409 || movementObject(t, rec.Body.Bytes())["code"] != "substate_requires_in_process" || before != catalogSnapshot(t, m) {
					t.Fatal(rec.Code, rec.Body.String())
				}
			}
		})
	}
	out, err := m.board.Discard(context.Background(), m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"reason":{"group":"candidate","key":"unresponsive"},"confirm_placement_exit":true}`))
	if err != nil {
		t.Fatal(err)
	}
	m.item = out.Item
	before := catalogSnapshot(t, m)
	rec := movementRequest(t, m, "POST", m.vacancy, m.item.ID, "/substate", m.item.ETag, `{"substate_id":null}`)
	if rec.Code != 409 || movementObject(t, rec.Body.Bytes())["code"] != "substate_requires_in_process" || before != catalogSnapshot(t, m) {
		t.Fatal(rec.Code, rec.Body.String())
	}
	draft := uuid.New()
	if _, err = m.pool.Exec(context.Background(), `INSERT INTO job_drafts(id,company_id,created_by,principal_recruiter_id,fields) SELECT $1,company_id,created_by,principal_recruiter_id,fields FROM job_drafts WHERE id=$2`, draft, m.vacancy); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = m.pool.Exec(context.Background(), `DELETE FROM job_drafts WHERE id=$1`, draft) })
	rec = movementRequest(t, m, "POST", draft, m.item.ID, "/substate", m.item.ETag, `{"substate_id":null}`)
	if rec.Code != 409 || movementObject(t, rec.Body.Bytes())["code"] != "vacancy_not_published" {
		t.Fatal(rec.Code, rec.Body.String())
	}
}

func TestSubstateConcurrentSetMoveDiscardOneWinner(t *testing.T) {
	for i := 0; i < 10; i++ {
		m, id := activeSubstateFixture(t)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		start := make(chan struct{})
		results := make(chan error, 3)
		var auditsBefore int
		if err := m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1`, m.item.ID).Scan(&auditsBefore); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		for _, op := range []string{"set", "move", "discard"} {
			wg.Add(1)
			go func(op string) {
				defer wg.Done()
				<-start
				var err error
				switch op {
				case "set":
					_, err = m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":"`+id+`"}`))
				case "move":
					_, err = m.board.Move(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"to_stage_id":"`+pipelineconfig.Defaults(m.vacancy).Stages[4].ID+`"}`))
				case "discard":
					_, err = m.board.Discard(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(discardBody))
				}
				results <- err
			}(op)
		}
		close(start)
		wg.Wait()
		close(results)
		wins, conflicts := 0, 0
		for err := range results {
			if err == nil {
				wins++
			} else if errors.Is(err, board.ErrVersionConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		if wins != 1 || conflicts != 2 {
			t.Fatal(wins, conflicts)
		}
		view, err := m.board.Board(ctx, m.company, m.recruiter, m.vacancy)
		if err != nil || len(view.Participations) != 1 {
			t.Fatal(view, err)
		}
		item := view.Participations[0]
		if item.Version != incrementVersion(t, m.item.Version) || item.ETag != board.ETag(item.ID, 5) {
			t.Fatal("winner version", item)
		}
		h, err := m.board.History(ctx, m.company, m.recruiter, m.vacancy, m.item.ID)
		if err != nil || len(h.Items) != 5 {
			t.Fatal(h, err)
		}
		last := h.Items[4]
		switch last.Kind {
		case "substate":
			if item.SubstateID == nil || *item.SubstateID != id || item.StageID != m.item.StageID || view.Coverage.Covered != 0 {
				t.Fatal(item, view.Coverage)
			}
		case "move":
			if item.SubstateID != nil || item.StageID != pipelineconfig.Defaults(m.vacancy).Stages[4].ID || view.Coverage.Covered != 1 {
				t.Fatal(item, view.Coverage)
			}
		case "discard":
			if item.SubstateID != nil || item.Discard == nil || item.StageID != view.Exit.ID || view.Exit.Count != 1 || view.Coverage.Covered != 0 {
				t.Fatal(item, view.Coverage)
			}
		default:
			t.Fatal(last)
		}
		var auditsAfter int
		if err = m.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1`, item.ID).Scan(&auditsAfter); err != nil || auditsAfter != auditsBefore+1 {
			t.Fatal(auditsAfter, auditsBefore, err)
		}
	}
}
func TestSubstateConcurrentCatalogRemovalNeverDangles(t *testing.T) {
	for i := 0; i < 10; i++ {
		m, id := activeSubstateFixture(t)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		c, err := m.drafts.GetSubstates(ctx, m.company, m.recruiter, m.vacancy)
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		results := make(chan error, 2)
		go func() {
			<-start
			_, e := m.board.SetSubstate(ctx, m.company, m.recruiter, m.vacancy, m.item.ID, m.item.ETag, true, []byte(`{"substate_id":"`+id+`"}`))
			results <- e
		}()
		go func() {
			<-start
			_, e := m.drafts.PutSubstates(ctx, m.company, m.recruiter, m.vacancy, c.ETag, true, []byte(`{"substates":[]}`))
			results <- e
		}()
		close(start)
		a, b := <-results, <-results
		var used *substatecatalog.InUseError
		if (a == nil) == (b == nil) {
			t.Fatal(a, b)
		}
		e := a
		if e == nil {
			e = b
		}
		if !errors.Is(e, board.ErrValidation) && !errors.As(e, &used) {
			t.Fatal(e)
		}
		var dangling bool
		if err = m.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM process_participations p JOIN job_draft_substate_catalogs c ON c.draft_id=p.process_id WHERE p.id=$1 AND p.substate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(convert_from(c.catalog,'UTF8')::jsonb->'substates') s WHERE s->>'id'=p.substate_id::text))`, m.item.ID).Scan(&dangling); err != nil || dangling {
			t.Fatal(dangling, err)
		}
	}
}
