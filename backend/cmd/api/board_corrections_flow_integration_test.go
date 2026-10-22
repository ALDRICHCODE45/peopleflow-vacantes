//go:build integration

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"mime"
	"mime/multipart"
	"testing"

	app "github.com/aldrichcode45/peopleflow-vacantes/internal/features/applications/application/board"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

const boardCorrectionSet = `{"set":{"full_name":"Corrected Candidate","email":"corrected@example.test","phone":"+523322222222","professional_title":"Corrected title","current_company":"Corrected company","location":{"country":"MX","state":"14","municipality":"14039","postal_code":null},"years_of_experience":"4.5","seniority":"senior","skills":["Rust"],"languages":[{"code":"es","level":"native"}],"education":[{"level":"master","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null},{"level":"phd","institution":null,"field":null,"status":"in_progress","start_year":null,"end_year":null},{"level":"phd","institution":null,"field":null,"status":"paused","start_year":null,"end_year":null}],"linkedin_url":"https://example.test/in/corrected","portfolio_url":"https://example.test/corrected"}}`

func boardCorrectionPaths(t *testing.T, f *candidateCVFixture) (string, string) {
	t.Helper()
	var vacancy string
	if err := f.h.pool.QueryRow(t.Context(), `SELECT process_id::text FROM process_participations WHERE id=$1`, f.pid).Scan(&vacancy); err != nil {
		t.Fatal(err)
	}
	base := draftFlowV2Path + "/" + vacancy
	return base, base + "/participations/" + f.pid.String()
}
func boardCorrectionRead(t *testing.T, f *candidateCVFixture, path string, actor draftFlowActor) draftFlowResponse {
	t.Helper()
	r := f.h.do(t, "GET", path, "", actor.token, nil)
	draftFlowAssertNoStore(t, r)
	if r.status != 200 {
		t.Fatalf("GET %s: %d %s", path, r.status, r.body)
	}
	return r
}
func boardCorrectionItem(t *testing.T, r draftFlowResponse, pid uuid.UUID) map[string]any {
	t.Helper()
	return cvParticipation(t, r, pid)
}
func boardCorrectionWire(t *testing.T, item map[string]any, detail bool) {
	t.Helper()
	keys := []string{"id", "stage_id", "version", "etag", "candidate", "added_by", "applied_at", "source", "cv", "moved_at", "discard", "substate_id", "profile", "screening_answers", "corrected_fields"}
	if detail {
		keys = append(keys, "screening", "comment", "candidate_message", "contact", "original", "original_cv")
	}
	orgCandidateKeys(t, item, keys...)
	orgCandidateKeys(t, item["candidate"], "id", "full_name", "kind")
	orgCandidateKeys(t, item["profile"], "location", "skills", "years_of_experience", "seniority", "education", "languages")
	orgCandidateKeys(t, item["cv"], "id", "name", "source")
}
func boardCorrectionFile(t *testing.T, f *candidateCVFixture, path, data, name, typ string) {
	t.Helper()
	r := boardCorrectionRead(t, f, path, f.owner)
	if string(r.body) != data || r.header.Get("Content-Type") != typ || r.header.Get("Content-Disposition") != mime.FormatMediaType("attachment", map[string]string{"filename": name}) || r.header.Get("Content-Length") != fmt.Sprint(len(data)) || r.header.Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("CV bytes/headers changed", r.header, string(r.body))
	}
}

func TestBoardCorrectionsFlow(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			base, path := boardCorrectionPaths(t, f)
			before := boardCorrectionRead(t, f, base+"/board", f.owner)
			beforeDetail := boardCorrectionRead(t, f, path, f.owner)
			initialItem := boardCorrectionItem(t, before, f.pid)
			boardCorrectionWire(t, initialItem, false)
			boardCorrectionWire(t, draftFlowObject(t, beforeDetail.body), true)
			if draftFlowObject(t, beforeDetail.body)["original"] != nil || draftFlowObject(t, beforeDetail.body)["original_cv"] != nil {
				t.Fatal("uncorrected detail must have null originals")
			}
			editJSONEqual(t, initialItem["corrected_fields"], []any{})
			if initialItem["cv"].(map[string]any)["source"] != "candidate" {
				t.Fatal(initialItem)
			}
			// Like E3, original downloads work even before a correction.
			boardCorrectionFile(t, f, path+"/cv", "%PDF-original", "original.pdf.pdf", "application/pdf")
			boardCorrectionFile(t, f, path+"/cv/original", "%PDF-original", "original.pdf.pdf", "application/pdf")
			// The ordinary recruiter can edit the pool, but board reads stay owner/principal scoped.
			for _, suffix := range []string{"", "/cv", "/cv/original"} {
				for _, actor := range []draftFlowActor{f.recruiter, f.foreign} {
					r := f.h.do(t, "GET", path+suffix, "", actor.token, nil)
					draftFlowAssertError(t, r, 404, "not_found")
					draftFlowAssertNoStore(t, r)
				}
			}
			var foreignBase, foreignPath string
			var foreignBefore, foreignDetailBefore draftFlowResponse
			if kind == "organic" {
				var vacancy, pid string
				if err := f.h.pool.QueryRow(t.Context(), `SELECT p.process_id::text,p.id::text FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE p.candidate_id=$1 AND vp.company_id<>$2`, f.id, f.company.companyID).Scan(&vacancy, &pid); err != nil {
					t.Fatal(err)
				}
				// The seed intentionally has no library item; add metadata for this real board read.
				f.exec(t, `INSERT INTO candidate_cv_library(id,candidate_id,version_id,name) SELECT $1,candidate_id,cv_version_id,'foreign-original' FROM process_participations WHERE id=$2`, uuid.New(), pid)
				foreignBase = draftFlowV2Path + "/" + vacancy
				foreignPath = foreignBase + "/participations/" + pid
				foreignBefore = boardCorrectionRead(t, f, foreignBase+"/board", f.foreign)
				foreignDetailBefore = boardCorrectionRead(t, f, foreignPath, f.foreign)
				// A different company's corrections must leave this company's board byte-identical.
				foreignPool := boardCorrectionRead(t, f, f.path, f.foreign)
				r := f.h.do(t, "PATCH", f.path, `{"set":{"full_name":"Foreign secret","email":"foreign-secret@example.test","skills":["Foreign secret"]}}`, f.foreign.token, map[string]string{"If-Match": foreignPool.header.Get("ETag")})
				if r.status != 200 {
					t.Fatal(r.status, string(r.body))
				}
				if got := boardCorrectionRead(t, f, base+"/board", f.owner); !bytes.Equal(got.body, before.body) {
					t.Fatal("foreign correction changed uncorrected board")
				}
				if got := boardCorrectionRead(t, f, path, f.owner); !bytes.Equal(got.body, beforeDetail.body) {
					t.Fatal("foreign correction changed uncorrected detail")
				}
				foreignBefore = boardCorrectionRead(t, f, foreignBase+"/board", f.foreign)
				foreignDetailBefore = boardCorrectionRead(t, f, foreignPath, f.foreign)
			}
			owned := f.owned(t)
			initialPool := f.detail(t)
			updated := f.patch(t, boardCorrectionSet, initialPool.header.Get("ETag"))
			if updated.status != 200 {
				t.Fatal(updated.status, string(updated.body))
			}
			if f.owned(t) != owned {
				t.Fatal("profile correction wrote snapshots/CV/participations")
			}
			pool := draftFlowObject(t, updated.body)
			got := boardCorrectionRead(t, f, base+"/board", f.owner)
			item := boardCorrectionItem(t, got, f.pid)
			detail := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			boardCorrectionWire(t, item, false)
			boardCorrectionWire(t, detail, true)
			for _, view := range []map[string]any{item, detail} {
				if view["candidate"].(map[string]any)["full_name"] != "Corrected Candidate" {
					t.Fatal(view)
				}
				editJSONEqual(t, view["profile"], pool["profile"])
				editJSONEqual(t, view["corrected_fields"], pool["corrected_fields"])
			}
			editJSONEqual(t, detail["contact"], pool["contact"])
			if kind == "organic" {
				editJSONEqual(t, detail["original"], pool["original"])
				// Original contact/profile must not alias effective pointers.
				if detail["original"].(map[string]any)["contact"].(map[string]any)["email"] != f.email {
					t.Fatal(detail["original"])
				}
			} else if detail["original"] != nil {
				t.Fatal("manual original must remain null")
			}
			// Company-filter dimensions all come from the effective six-key profile.
			profile := item["profile"].(map[string]any)
			if profile["years_of_experience"] != "4.5" || profile["seniority"] != "senior" {
				t.Fatal(profile)
			}
			education := profile["education"].(map[string]any)
			if education["highest_completed"] != "master" || education["in_progress"] != "phd" {
				t.Fatal(education)
			}
			location := profile["location"].(map[string]any)
			if location["label"] != "Guadalajara, Jalisco" || location["postal_code"] != nil {
				t.Fatal(location)
			}
			// Explicit null corrections clear instead of falling back to frozen values.
			cleared := f.patch(t, `{"set":{"phone":null,"years_of_experience":null,"seniority":null,"skills":null,"languages":null}}`, updated.header.Get("ETag"))
			if cleared.status != 200 {
				t.Fatal(cleared.status, string(cleared.body))
			}
			clearDetail := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			editJSONEqual(t, clearDetail["profile"], draftFlowObject(t, cleared.body)["profile"])
			if clearDetail["contact"].(map[string]any)["phone"] != nil {
				t.Fatal(clearDetail)
			}
			// Restore the full correction for mutations and CV replacement.
			restored := f.patch(t, boardCorrectionSet, cleared.header.Get("ETag"))
			if restored.status != 200 {
				t.Fatal(restored.status, string(restored.body))
			}
			docx := orgCVDocx(t)
			upload := f.upload(t, "corrected.docx", string(docx), restored.header.Get("ETag"))
			if upload.status != 200 {
				t.Fatal(upload.status, string(upload.body))
			}
			detail = draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			item = boardCorrectionItem(t, boardCorrectionRead(t, f, base+"/board", f.owner), f.pid)
			if detail["cv"].(map[string]any)["source"] != "company" || item["cv"].(map[string]any)["name"] != "corrected.docx" {
				t.Fatal(detail, item)
			}
			editJSONEqual(t, detail["original_cv"], cvParticipation(t, upload, f.pid)["original_cv"])
			boardCorrectionFile(t, f, path+"/cv", string(docx), "corrected.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
			boardCorrectionFile(t, f, path+"/cv/original", "%PDF-original", "original.pdf.pdf", "application/pdf")
			boardCorrectionMutations(t, f, base, path)
			boardCorrectionReuse(t, f, kind)
			if foreignBase != "" {
				if got := boardCorrectionRead(t, f, foreignBase+"/board", f.foreign); !bytes.Equal(got.body, foreignBefore.body) {
					t.Fatal("own corrections leaked into other company board")
				}
				if got := boardCorrectionRead(t, f, foreignPath, f.foreign); !bytes.Equal(got.body, foreignDetailBefore.body) {
					t.Fatal("own corrections/CV leaked into other company detail")
				}
				// Original is participation-local: the older empty snapshot is NOT the latest pool snapshot.
				var vacancy, pid string
				if err := f.h.pool.QueryRow(t.Context(), `SELECT p.process_id::text,p.id::text FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE p.candidate_id=$1 AND vp.company_id=$2 ORDER BY p.created_at LIMIT 1`, f.id, f.company.companyID).Scan(&vacancy, &pid); err != nil {
					t.Fatal(err)
				}
				f.exec(t, `INSERT INTO candidate_cv_library(id,candidate_id,version_id,name) SELECT $1,candidate_id,cv_version_id,'older-original' FROM process_participations WHERE id=$2`, uuid.New(), pid)
				older := draftFlowObject(t, boardCorrectionRead(t, f, draftFlowV2Path+"/"+vacancy+"/participations/"+pid, f.owner).body)
				originalProfile := older["original"].(map[string]any)["profile"].(map[string]any)
				if originalProfile["location"] != nil || originalProfile["years_of_experience"] != nil {
					t.Fatal("original uses latest or live profile", originalProfile)
				}
				editJSONEqual(t, older["profile"], draftFlowObject(t, f.detail(t).body)["profile"])
				// A reset returns this participation to its frozen value, never candidate live data.
				reset := f.patch(t, `{"reset":["skills","education","location"]}`, upload.header.Get("ETag"))
				if reset.status != 200 {
					t.Fatal(reset.status, string(reset.body))
				}
				current := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)["profile"].(map[string]any)
				editJSONEqual(t, current["skills"], []any{"frozen"})
				editJSONEqual(t, current["education"], map[string]any{"highest_completed": "bachelor", "in_progress": nil})
			}
			// No original metadata: current correction still downloads; original fails closed.
			if kind == "organic" {
				f.exec(t, `DELETE FROM candidate_cv_library WHERE candidate_id=$1`, f.id)
				r := f.h.do(t, "GET", path+"/cv/original", "", f.owner.token, nil)
				draftFlowAssertError(t, r, 404, "not_found")
				draftFlowAssertNoStore(t, r)
				boardCorrectionFile(t, f, path+"/cv", string(docx), "corrected.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
			}
		})
	}
}

func TestBoardCorrectionsCVOnly(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			base, path := boardCorrectionPaths(t, f)
			initial := f.detail(t)
			uploaded := f.upload(t, "cv-only.pdf", "%PDF-corrected", initial.header.Get("ETag"))
			if uploaded.status != 200 {
				t.Fatal(uploaded.status, string(uploaded.body))
			}
			item := boardCorrectionItem(t, boardCorrectionRead(t, f, base+"/board", f.owner), f.pid)
			detail := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
			editJSONEqual(t, item["corrected_fields"], []any{})
			editJSONEqual(t, detail["corrected_fields"], []any{})
			if detail["original"] != nil || detail["original_cv"] == nil || detail["cv"].(map[string]any)["source"] != "company" {
				t.Fatal(detail)
			}
			boardCorrectionFile(t, f, path+"/cv", "%PDF-corrected", "cv-only.pdf", "application/pdf")
			boardCorrectionFile(t, f, path+"/cv/original", "%PDF-original", "original.pdf.pdf", "application/pdf")
		})
	}
}

func boardCorrectionMutations(t *testing.T, f *candidateCVFixture, base, path string) {
	t.Helper()
	vacancy := uuid.MustParse(base[len(draftFlowV2Path)+1:])
	cfg := pipelineconfig.Defaults(vacancy)
	substate := uuid.NewString()
	// Schema includes version; use the already validated catalog shape.
	f.exec(t, `INSERT INTO job_draft_substate_catalogs(draft_id,catalog,version) VALUES($1,$2,1)`, vacancy, []byte(`{"substates":[{"id":"`+substate+`","name":"Interview"}]}`))
	mutate := func(suffix, body string) {
		t.Helper()
		before := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
		r := f.h.do(t, "POST", path+suffix, body, f.owner.token, map[string]string{"If-Match": before["etag"].(string)})
		draftFlowAssertNoStore(t, r)
		if r.status != 200 {
			t.Fatal(suffix, r.status, string(r.body))
		}
		out := draftFlowObject(t, r.body)
		board := boardCorrectionItem(t, boardCorrectionRead(t, f, base+"/board", f.owner), f.pid)
		for key, value := range out {
			if key != "coverage" && key != "delivery" {
				editJSONEqual(t, value, board[key])
			}
		}
		for _, private := range []string{"profile", "screening_answers", "contact", "original", "original_cv"} {
			if _, ok := out[private]; ok {
				t.Fatal("mutation leaked", private)
			}
		}
		if out["candidate"].(map[string]any)["full_name"] != "Corrected Candidate" || out["cv"].(map[string]any)["source"] != "company" {
			t.Fatal(out)
		}
	}
	for i := 1; i <= 3; i++ {
		mutate("/moves", `{"to_stage_id":"`+cfg.Stages[i].ID+`"}`)
	}
	mutate("/substate", `{"substate_id":"`+substate+`"}`)
	mutate("/discard", `{"reason":{"group":"recruiter","key":"profile_mismatch"},"comment":"Private note"}`)
	mutate("/recover", `{}`)
}

func boardCorrectionReuse(t *testing.T, f *candidateCVFixture, kind string) {
	t.Helper()
	vacancy := publicationFlowReady(t, f.h, f.owner)
	publicFlowPublish(t, f.h, vacancy, f.owner)
	cfg := pipelineconfig.Defaults(uuid.MustParse(vacancy))
	data := fmt.Sprintf(`{"stage_id":%q,"existing":{"kind":%q,"id":%q},"candidate":null,"confirmed_distinct":false}`, cfg.Stages[0].ID, kind, f.id)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField("data")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = field.Write([]byte(data)); err != nil {
		t.Fatal(err)
	}
	file, err := writer.CreateFormFile("cv", "reuse.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write([]byte("%PDF-reuse")); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	base := draftFlowV2Path + "/" + vacancy
	created := f.h.do(t, "POST", base+"/pipeline/candidates/manual", body.String(), f.owner.token, map[string]string{"Idempotency-Key": uuid.NewString(), "Content-Type": writer.FormDataContentType()})
	if created.status != 201 {
		t.Fatal(created.status, string(created.body))
	}
	var result app.ManualCreatedBody
	if err = json.Unmarshal(created.body, &result); err != nil {
		t.Fatal(err)
	}
	response := boardCorrectionRead(t, f, base+"/board", f.owner)
	var board app.Board
	if err = json.Unmarshal(response.body, &board); err != nil {
		t.Fatal(err)
	}
	if len(board.Participations) != 1 {
		t.Fatal(string(response.body))
	}
	expected, err := json.Marshal(app.ManualCreatedBody{Item: board.Participations[0], Coverage: board.Coverage, Delivery: board.Delivery})
	if err != nil || !bytes.Equal(expected, created.body) {
		t.Fatalf("corrected reuse 201 != GET: %s / %s (%v)", created.body, expected, err)
	}
	if result.Candidate.FullName != "Corrected Candidate" || result.Candidate.Kind != kind || result.Source != "manual" || result.CV.Source != "candidate" {
		t.Fatal(string(created.body))
	}
	editJSONEqual(t, draftFlowObject(t, created.body)["profile"], draftFlowObject(t, f.detail(t).body)["profile"])
}
