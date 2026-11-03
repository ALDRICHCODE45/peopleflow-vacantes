//go:build integration

package main

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"testing"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Controlled fixtures until the team mutation endpoints land: keep the
// responsible intact and create/end a collaborator's continuous stay atomically.
func teamAccessCollaborator(t *testing.T, h *draftFlowHarness, draft string, company, user, owner uuid.UUID) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	id := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,started_by,start_cause) VALUES($1,$2,$3,$4,now(),$5,'added')`, id, draft, company, user, owner); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO vacancy_assignment_functions(id,assignment_id,draft_id,function,started_at,start_cause) VALUES($1,$2,$3,'collaborator',now(),'added')`, uuid.New(), id, draft); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return id
}

func teamAccessEndCollaborator(t *testing.T, h *draftFlowHarness, assignment, owner uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`UPDATE vacancy_assignment_functions SET ended_at=now(),end_cause='tramo_ended' WHERE assignment_id=$1 AND ended_at IS NULL`, []any{assignment}},
		{`UPDATE vacancy_assignments SET ended_at=now(),end_cause='removed',ended_by=$2 WHERE id=$1 AND ended_at IS NULL`, []any{assignment, owner}},
	} {
		tag, err := tx.Exec(ctx, q.sql, q.args...)
		if err != nil || tag.RowsAffected() != 1 {
			t.Fatalf("end collaborator: %v, rows=%d", err, tag.RowsAffected())
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestTeamAccessCollaboratorAndEndedSurfaces(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	responsibleID, responsibleSub := company.addUser(t, "recruiter")
	responsible := h.actor(t, responsibleID, responsibleSub)
	collaboratorID, collaboratorSub := company.addUser(t, "recruiter")
	collaborator := h.actor(t, collaboratorID, collaboratorSub)
	id := publicationFlowReady(t, h, responsible)
	publicFlowPublish(t, h, id, responsible)
	assignment := teamAccessCollaborator(t, h, id, company.companyID, collaboratorID, ownerID)
	base := draftFlowV2Path + "/" + id
	surfaces := []string{"", "/team", "/team/history", "/pipeline", "/pipeline/delivery", "/board", "/psychometric-profile", "/psychometric-invitations"}
	for _, suffix := range surfaces {
		if r := h.do(t, "GET", base+suffix, "", collaborator.token, nil); r.status != 200 {
			t.Fatalf("active collaborator %s: %d %s", suffix, r.status, r.body)
		}
	}
	teamAccessEndCollaborator(t, h, assignment, ownerID)
	for _, suffix := range surfaces {
		draftFlowAssertCatalogError(t, h.do(t, "GET", base+suffix, "", collaborator.token, nil), 404, "team_access_ended")
		// The owner never held a tramo, while the responsible still has theirs.
		for _, actor := range []draftFlowActor{owner, responsible} {
			if r := h.do(t, "GET", base+suffix, "", actor.token, nil); r.status != 200 {
				t.Fatalf("owner/responsible %s: %d %s", suffix, r.status, r.body)
			}
		}
	}
}

func TestTeamAccessEndedAndNeverTramoWritesAreAtomic(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	h := f.h
	base, participation := boardCorrectionPaths(t, f)
	id := base[len(draftFlowV2Path)+1:]
	cfg := pipelineconfig.Defaults(uuid.MustParse(id))
	assignment := teamAccessCollaborator(t, h, id, f.company.companyID, f.recruiter.userID, f.owner.userID)
	neverID, neverSub := f.company.addUser(t, "recruiter")
	never := h.actor(t, neverID, neverSub)
	// Construct a valid multipart intake, distinct from the CV fixture candidate.
	// Reuse the fixture's FK-safe cleanup for the new intake identity too.
	intake := &candidateEditFixture{h: h, company: f.company}
	t.Cleanup(func() {
		if draftFlowCount(t, h.pool, `SELECT count(*) FROM company_candidates WHERE company_id=$1 AND email_normalized='team-intake@example.test'`, f.company.companyID) != 0 {
			if err := h.pool.QueryRow(context.Background(), `SELECT id FROM company_candidates WHERE company_id=$1 AND email_normalized='team-intake@example.test'`, f.company.companyID).Scan(&intake.id); err != nil {
				t.Error(err)
				return
			}
			intake.cleanupParticipations(t)
			for _, q := range []string{
				`DELETE FROM company_candidate_cvs WHERE company_candidate_id=$1`,
				`DELETE FROM company_candidate_languages WHERE company_candidate_id=$1`,
				`DELETE FROM company_candidate_educations WHERE company_candidate_id=$1`,
				`DELETE FROM company_candidates WHERE id=$1`,
			} {
				intake.exec(t, q, intake.id)
			}
		}
	})
	var data bytes.Buffer
	writer := multipart.NewWriter(&data)
	field, err := writer.CreateFormField("data")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fmt.Fprintf(field, `{"stage_id":%q,"existing":null,"confirmed_distinct":true,"candidate":{"full_name":"Team Intake","email":"team-intake@example.test","phone":null,"residence":{"country":"US"},"education":[{"level":"bachelor","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null}],"years_of_experience":"1.5","seniority":"junior","languages":[{"code":"es","level":"native"}]}}`, cfg.Stages[0].ID); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("cv", "team-access.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte("%PDF-team-access")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	pipeline := boardCorrectionRead(t, f, base+"/pipeline", f.owner)
	detail := boardCorrectionRead(t, f, participation, f.owner)
	// The collaborator is neither creator nor responsible and can read the CV.
	if r := h.do(t, "GET", participation+"/cv", "", f.recruiter.token, nil); r.status != 200 || string(r.body) != "%PDF-original" {
		t.Fatalf("active CV: %d %s", r.status, r.body)
	}
	teamAccessEndCollaborator(t, h, assignment, f.owner.userID)
	snapshot := func() string {
		t.Helper()
		var raw string
		if err := h.pool.QueryRow(t.Context(), `SELECT jsonb_build_array(
   (SELECT to_jsonb(d) FROM job_drafts d WHERE id=$1),
   (SELECT to_jsonb(c) FROM job_draft_pipeline_configs c WHERE draft_id=$1),
   (SELECT to_jsonb(t) FROM vacancy_teams t WHERE draft_id=$1),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM vacancy_assignments a WHERE draft_id=$1),
   (SELECT jsonb_agg(to_jsonb(f) ORDER BY id) FROM vacancy_assignment_functions f WHERE draft_id=$1),
   (SELECT to_jsonb(p) FROM vacancy_processes p WHERE id=$1),
   (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM process_participations p WHERE process_id=$1),
   (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM participation_stage_history h WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=$1)),
   (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM company_candidates c WHERE company_id=$2),
   (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM company_candidate_cvs c WHERE company_id=$2),
   (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM job_draft_idempotency i WHERE company_id=$2),
   (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_events a WHERE actor_id IN (SELECT user_id FROM company_members WHERE company_id=$2)),
   (SELECT to_jsonb(c) FROM job_draft_delivery_configs c WHERE draft_id=$1),
   (SELECT to_jsonb(c) FROM process_delivery_fulfillments c WHERE process_id=$1),
   (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM process_coverage_milestones c WHERE process_id=$1))::text`, id, f.company.companyID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		return raw
	}
	before := snapshot()
	changedPipeline := pipelineFlowConfig(t, pipeline.body)
	changedPipeline.Stages[1].Name = "Team Interview"
	requests := []struct {
		name, method, path, body string
		headers                  map[string]string
	}{
		{"pipeline PUT", "PUT", base + "/pipeline", pipelineFlowBody(t, changedPipeline), map[string]string{"If-Match": pipeline.header.Get("ETag")}},
		{"board move", "POST", participation + "/moves", fmt.Sprintf(`{"to_stage_id":%q}`, cfg.Stages[1].ID), map[string]string{"If-Match": draftFlowObject(t, detail.body)["etag"].(string)}},
		{"manual intake", "POST", base + "/pipeline/candidates/manual", data.String(), map[string]string{"Content-Type": writer.FormDataContentType(), "Idempotency-Key": uuid.NewString()}},
		{"participation CV", "GET", participation + "/cv", "", nil},
	}
	for _, req := range requests {
		t.Run(req.name, func(t *testing.T) {
			for _, tc := range []struct {
				actor draftFlowActor
				code  string
			}{{f.recruiter, "team_access_ended"}, {never, "not_found"}} {
				draftFlowAssertCatalogError(t, h.do(t, req.method, req.path, req.body, tc.actor.token, req.headers), 404, tc.code)
				if snapshot() != before {
					t.Fatal("rejected access changed stored data, versions, history, audit or counters")
				}
			}
			// Identical valid input is accepted for the owner, not a validation probe.
			r := h.do(t, req.method, req.path, req.body, f.owner.token, req.headers)
			want := 200
			if req.name == "manual intake" {
				want = 201
			}
			if r.status != want {
				t.Fatalf("owner %s: %d %s", req.name, r.status, r.body)
			}
			before = snapshot()
		})
	}
}
