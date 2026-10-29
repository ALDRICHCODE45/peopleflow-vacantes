//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"strings"
	"testing"

	intake "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/v2"
	intakepg "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/infrastructure/postgres/v2"
	auditpg "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/infrastructure/postgres/draftstore"
	"github.com/jackc/pgx/v5"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

func autoConfigure(t *testing.T, f invitationFixture, enabled bool, stages ...string) {
	t.Helper()
	path := f.base + "/psychometric-profile"
	r := f.h.do(t, "GET", path, "", f.actor.token, nil)
	body := profileBody(t)
	body["enabled"] = enabled
	body["auto_send_stage_ids"] = stages
	r = f.h.do(t, "PUT", path, profileEncode(t, body), f.actor.token, map[string]string{"If-Match": r.header.Get("ETag")})
	if r.status != 200 {
		t.Fatalf("configure: %d %s", r.status, r.body)
	}
}
func autoMove(t *testing.T, f invitationFixture, stage string) {
	t.Helper()
	path := f.base + "/participations/" + f.pid
	r := f.h.do(t, "GET", path, "", f.actor.token, nil)
	tag := draftFlowObject(t, r.body)["etag"].(string)
	r = f.h.do(t, "POST", path+"/moves", fmt.Sprintf(`{"to_stage_id":%q}`, stage), f.actor.token, map[string]string{"If-Match": tag})
	if r.status != 200 {
		t.Fatalf("move: %d %s", r.status, r.body)
	}
}
func autoItems(t *testing.T, f invitationFixture) []any {
	t.Helper()
	r := f.h.do(t, "GET", f.base+"/psychometric-invitations", "", f.actor.token, nil)
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	return draftFlowObject(t, r.body)["items"].([]any)
}
func TestPsychometricAutoMove(t *testing.T) {
	f := invitationSetup(t)
	stages := pipelineconfig.Defaults(uuid.MustParse(f.id)).Stages
	initial, target := stages[0].ID, stages[1].ID
	autoConfigure(t, f, true, target)
	autoMove(t, f, target)
	items := autoItems(t, f)
	if len(items) != 1 {
		t.Fatalf("auto invitations=%v", items)
	}
	i := items[0].(map[string]any)
	if i["origin"] != "auto" || i["created_by"] != nil || i["trigger_stage_id"] != target {
		t.Fatal(i)
	}
	var n int
	if err := f.h.pool.QueryRow(t.Context(), `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='PsychometricInvitationCreated' AND actor_type='system' AND actor_id IS NULL`, i["id"]).Scan(&n); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	autoMove(t, f, initial)
	autoMove(t, f, target)
	if got := autoItems(t, f); len(got) != 1 || got[0].(map[string]any)["id"] != i["id"] {
		t.Fatal(got)
	}
	if _, err := f.h.pool.Exec(t.Context(), `UPDATE psychometric_invitations SET expires_at=created_at WHERE id=$1`, i["id"]); err != nil {
		t.Fatal(err)
	}
	autoMove(t, f, initial)
	autoMove(t, f, target)
	replacement := autoItems(t, f)[0].(map[string]any)
	if replacement["id"] == i["id"] {
		t.Fatal("expired slot not superseded")
	}
	if _, err := f.h.pool.Exec(t.Context(), `UPDATE psychometric_invitations SET finished_at=created_at WHERE id=$1`, replacement["id"]); err != nil {
		t.Fatal(err)
	}
	autoMove(t, f, initial)
	autoMove(t, f, target)
	if got := autoItems(t, f); len(got) != 1 || got[0].(map[string]any)["id"] != replacement["id"] {
		t.Fatal(got)
	}
}
func autoAction(t *testing.T, f invitationFixture, action, body string, status int) draftFlowResponse {
	t.Helper()
	path := f.base + "/participations/" + f.pid
	r := f.h.do(t, "GET", path, "", f.actor.token, nil)
	r = f.h.do(t, "POST", path+"/"+action, body, f.actor.token, map[string]string{"If-Match": draftFlowObject(t, r.body)["etag"].(string)})
	if r.status != status {
		t.Fatalf("%s: %d %s", action, r.status, r.body)
	}
	return r
}

func TestPsychometricAutoRecoveryAndDiscard(t *testing.T) {
	f := invitationSetup(t)
	initial := pipelineconfig.Defaults(uuid.MustParse(f.id)).Stages[0].ID
	autoConfigure(t, f, true, initial)
	autoAction(t, f, "discard", `{"reason":{"group":"candidate","key":"unresponsive"},"comment":"Test","candidate_message":"Test"}`, 200)
	if items := autoItems(t, f); len(items) != 0 {
		t.Fatal(items)
	}
	autoAction(t, f, "recover", `{}`, 200)
	if items := autoItems(t, f); len(items) != 1 || items[0].(map[string]any)["trigger_stage_id"] != initial {
		t.Fatal(items)
	}
}

func TestPsychometricAutoFailureRollsBackMove(t *testing.T) {
	f := invitationSetup(t)
	target := pipelineconfig.Defaults(uuid.MustParse(f.id)).Stages[1].ID
	autoConfigure(t, f, true, target)
	path := f.base + "/participations/" + f.pid
	before := f.h.do(t, "GET", path, "", f.actor.token, nil)
	history := f.h.do(t, "GET", path+"/history", "", f.actor.token, nil)
	snap := f.snapshot(t)
	name := "auto_fail_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := f.h.pool.Exec(t.Context(), fmt.Sprintf(`ALTER TABLE audit_events ADD CONSTRAINT %s CHECK (entity_type <> 'psychometric_invitation' OR metadata->>'vacancy_id' <> '%s') NOT VALID`, name, f.id)); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := f.h.pool.Exec(context.Background(), `ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS `+name); err != nil {
			t.Error(err)
		}
	})
	r := autoAction(t, f, "moves", fmt.Sprintf(`{"to_stage_id":%q}`, target), 500)
	if string(r.body) != "{\"error\":\"an internal error occurred\",\"code\":\"internal_error\"}\n" {
		t.Fatal(string(r.body))
	}
	after := f.h.do(t, "GET", path, "", f.actor.token, nil)
	afterHistory := f.h.do(t, "GET", path+"/history", "", f.actor.token, nil)
	if !bytes.Equal(before.body, after.body) || !bytes.Equal(history.body, afterHistory.body) || snap != f.snapshot(t) {
		t.Fatal("hook failure changed stage/history/invitations/audits")
	}
}

func TestPsychometricAutoSubstateAndPipelineNeverTrigger(t *testing.T) {
	f := invitationSetup(t)
	config := pipelineconfig.Defaults(uuid.MustParse(f.id))
	for _, stage := range config.Stages[1:4] {
		autoMove(t, f, stage.ID)
	}
	autoConfigure(t, f, true, config.Stages[3].ID)
	path := f.base + "/pipeline/substates"
	read := f.h.do(t, "GET", path, "", f.actor.token, nil)
	saved := f.h.do(t, "PUT", path, `{"substates":[{"name":"Interview"}]}`, f.actor.token, map[string]string{"If-Match": read.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatal(saved.status, string(saved.body))
	}
	sid := draftFlowObject(t, saved.body)["substates"].([]any)[0].(map[string]any)["id"].(string)
	autoAction(t, f, "substate", fmt.Sprintf(`{"substate_id":%q}`, sid), 200)
	// Reordering stages creates pipeline not-applicable history, not stage entry.
	path = f.base + "/pipeline"
	read = f.h.do(t, "GET", path, "", f.actor.token, nil)
	config.Stages[1], config.Stages[2] = config.Stages[2], config.Stages[1]
	body := strings.Replace(pipelineFlowBody(t, config), `"stages":`, `"confirm_impact":true,"stages":`, 1)
	saved = f.h.do(t, "PUT", path, body, f.actor.token, map[string]string{"If-Match": read.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatal(saved.status, string(saved.body))
	}
	if items := autoItems(t, f); len(items) != 0 {
		t.Fatal(items)
	}
}

func TestPsychometricAutoRetiredStageIgnored(t *testing.T) {
	f := invitationSetup(t)
	path := f.base + "/pipeline"
	read := f.h.do(t, "GET", path, "", f.actor.token, nil)
	config := pipelineFlowConfig(t, read.body)
	body := strings.Replace(pipelineFlowBody(t, config), `"stages":[`, `"stages":[`, 1)
	marker := `{"id":"` + config.Stages[1].ID + `"`
	body = strings.Replace(body, marker, `{"name":"Temporary"},`+marker, 1)
	saved := f.h.do(t, "PUT", path, body, f.actor.token, map[string]string{"If-Match": read.header.Get("ETag")})
	if saved.status != 200 {
		t.Fatal(saved.status, string(saved.body))
	}
	custom := pipelineFlowConfig(t, saved.body).Stages[1].ID
	autoConfigure(t, f, true, custom)
	removed := f.h.do(t, "PUT", path, pipelineFlowBody(t, config), f.actor.token, map[string]string{"If-Match": saved.header.Get("ETag")})
	if removed.status != 200 {
		t.Fatal(removed.status, string(removed.body))
	}
	// Exercise the public hook with an obsolete entry event.
	jobs := draftstore.NewStore(f.h.pool, auditpg.NewAuditEventRepository())
	tx, err := f.h.pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if _, err = tx.Exec(t.Context(), `SELECT id FROM vacancy_processes WHERE id=$1 FOR UPDATE`, f.id); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(t.Context(), `SELECT id FROM process_participations WHERE id=$1 FOR UPDATE`, f.pid); err != nil {
		t.Fatal(err)
	}
	if err = newPsychometricStageEntryHook(jobs).OnStageEntered(t.Context(), tx, uuid.MustParse(f.id), uuid.MustParse(f.pid), uuid.MustParse(custom), "move"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if items := autoItems(t, f); len(items) != 0 {
		t.Fatal(items)
	}
}

type autoFailHook struct{}

func (autoFailHook) OnStageEntered(context.Context, pgx.Tx, uuid.UUID, uuid.UUID, uuid.UUID, string) error {
	return fmt.Errorf("forced hook failure")
}

func TestPsychometricAutoApply(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(fmt.Sprint(configured), func(t *testing.T) {
			f := invitationSetup(t)
			other := invitationSetup(t)
			initial := pipelineconfig.Defaults(uuid.MustParse(f.id)).Stages[0].ID
			target := initial
			if !configured {
				target = pipelineconfig.Defaults(uuid.MustParse(f.id)).Stages[1].ID
			}
			autoConfigure(t, f, true, target)
			var sub string
			var cv, candidate uuid.UUID
			if err := other.h.pool.QueryRow(t.Context(), `SELECT u.cognito_sub,l.id,u.id FROM process_participations p JOIN users u ON u.id=p.candidate_id JOIN candidate_cv_library l ON l.candidate_id=u.id WHERE p.id=$1`, other.pid).Scan(&sub, &cv, &candidate); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				for _, q := range []string{
					`DELETE FROM audit_events WHERE metadata->>'vacancy_id'=$1 AND entity_type='process_participation' AND entity_id IN (SELECT id FROM process_participations WHERE process_id=$1::uuid AND candidate_id=$2)`,
					`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=$1 AND candidate_id=$2)`,
					`DELETE FROM participation_idempotency WHERE process_id=$1 AND candidate_id=$2`,
					`DELETE FROM process_participations WHERE process_id=$1 AND candidate_id=$2`,
				} {
					if _, err := f.h.pool.Exec(context.Background(), q, f.id, candidate); err != nil {
						t.Error(err)
					}
				}
			})
			var fields []byte
			if err := f.h.pool.QueryRow(t.Context(), `SELECT fields FROM job_drafts WHERE id=$1`, f.id).Scan(&fields); err != nil {
				t.Fatal(err)
			}
			form, err := (participationRules{}).Screening(fields)
			if err != nil {
				t.Fatal(err)
			}
			req := intake.Request{CVID: cv, Revision: form.Revision, Answers: []intake.Answer{}}
			jobs := draftstore.NewStore(f.h.pool, auditpg.NewAuditEventRepository())
			store := intakepg.NewStore(f.h.pool, auditpg.NewAuditEventRepository(), participationRules{}, jobs)
			// Forced hook failure leaves no participation, history, or replay record.
			before := f.snapshot(t)
			if _, err = store.WithStageEntryHook(autoFailHook{}).Apply(t.Context(), sub, uuid.MustParse(f.id), uuid.New(), req); err == nil {
				t.Fatal("hook error ignored")
			}
			if f.snapshot(t) != before {
				t.Fatal("failed apply wrote invitations/audit")
			}
			key := uuid.New()
			r, err := store.WithStageEntryHook(newPsychometricStageEntryHook(jobs)).Apply(t.Context(), sub, uuid.MustParse(f.id), key, req)
			if err != nil {
				t.Fatal(err)
			}
			replay, err := store.Apply(t.Context(), sub, uuid.MustParse(f.id), key, req)
			if err != nil || !replay.Replayed || !bytes.Equal(r.Body, replay.Body) {
				t.Fatal("apply replay changed", err)
			}
			want := 0
			if configured {
				want = 1
			}
			if items := autoItems(t, f); len(items) != want {
				t.Fatal(items)
			}
		})
	}
}

func TestPsychometricAutoManualIntake(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(fmt.Sprint(configured), func(t *testing.T) {
			local, err := cvstorage.NewLocal(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = local.Close() })
			h := newDraftFlowHarness(t, local)
			company, uid, sub := draftFlowNewPrincipal(t, h.pool, "active")
			actor := h.actor(t, uid, sub)
			id := publicationFlowReady(t, h, actor)
			publicFlowPublish(t, h, id, actor)
			f := invitationFixture{h: h, actor: actor, id: id, base: draftFlowV2Path + "/" + id}
			t.Cleanup(func() {
				for _, q := range []string{
					`DELETE FROM audit_events WHERE metadata->>'vacancy_id'=$1 AND entity_type IN ('psychometric_invitation','process_participation')`,
					`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=$1)`,
					`DELETE FROM process_participations WHERE process_id=$1`,
				} {
					if _, err := h.pool.Exec(context.Background(), q, id); err != nil {
						t.Error(err)
					}
				}
				for _, q := range []string{
					`DELETE FROM company_candidate_cvs WHERE company_id=$1`,
					`DELETE FROM company_candidate_languages WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1)`,
					`DELETE FROM company_candidate_educations WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1)`,
					`DELETE FROM company_candidates WHERE company_id=$1`,
				} {
					if _, err := h.pool.Exec(context.Background(), q, company.companyID); err != nil {
						t.Error(err)
					}
				}
			})
			stages := pipelineconfig.Defaults(uuid.MustParse(id)).Stages
			target := stages[0].ID
			if !configured {
				target = stages[1].ID
			}
			autoConfigure(t, f, true, target)
			data := fmt.Sprintf(`{"stage_id":%q,"existing":null,"confirmed_distinct":false,"candidate":{"full_name":"Auto Intake","education":[{"level":"bachelor","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null}],"years_of_experience":null,"seniority":null,"languages":[],"email":"auto@example.test","phone":null,"residence":{"country":"MX","state":"14","municipality":"14039"}}}`, stages[0].ID)
			var b bytes.Buffer
			m := multipart.NewWriter(&b)
			p, err := m.CreateFormField("data")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = p.Write([]byte(data))
			p, err = m.CreateFormFile("cv", "resume.pdf")
			if err != nil {
				t.Fatal(err)
			}
			_, _ = p.Write([]byte("%PDF-1 auto intake"))
			_ = m.Close()
			key := uuid.NewString()
			post := func() draftFlowResponse {
				return h.do(t, "POST", f.base+"/pipeline/candidates/manual", b.String(), actor.token, map[string]string{"Idempotency-Key": key, "Content-Type": m.FormDataContentType()})
			}
			r := post()
			if r.status != 201 {
				t.Fatal(r.status, string(r.body))
			}
			replay := post()
			if replay.status != 201 || !bytes.Equal(r.body, replay.body) {
				t.Fatal(replay.status, string(replay.body))
			}
			var item map[string]any
			if err = json.Unmarshal(r.body, &item); err != nil {
				t.Fatal(err)
			}
			want := 0
			if configured {
				want = 1
			}
			if items := autoItems(t, f); len(items) != want {
				t.Fatal(items)
			}
		})
	}
}

func TestPsychometricAutoMoveDisabledOrUnconfigured(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		t.Run(fmt.Sprint(enabled), func(t *testing.T) {
			f := invitationSetup(t)
			stages := pipelineconfig.Defaults(uuid.MustParse(f.id)).Stages
			configured := stages[1].ID
			if enabled {
				configured = stages[0].ID
			}
			autoConfigure(t, f, enabled, configured)
			autoMove(t, f, stages[1].ID)
			if items := autoItems(t, f); len(items) != 0 {
				t.Fatal(items)
			}
		})
	}
}
