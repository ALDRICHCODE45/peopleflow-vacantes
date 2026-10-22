//go:build integration

package main

import (
	"context"
	"fmt"
	"mime"
	"net/url"
	"strings"
	"testing"

	cvstorage "github.com/aldrichcode45/peopleflow-vacantes/internal/features/candidates/infrastructure/storage"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

type candidateCVFixture struct {
	*candidateEditFixture
	local                     *cvstorage.Local
	pid                       uuid.UUID
	kind, pathCV, originalKey string
}

func newCandidateCVFixture(t *testing.T, kind string) *candidateCVFixture {
	t.Helper()
	local, err := cvstorage.NewLocal(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = local.Close() })
	var f *candidateEditFixture
	if kind == "manual" {
		f = newCandidateEditFixture(t, local)
	} else {
		f = newOrganicEditFixture(t, local)
	}
	out := &candidateCVFixture{candidateEditFixture: f, local: local, kind: kind}
	// Register before setup writes too, so partial fixture construction is safe.
	t.Cleanup(func() {
		// Deleting participations releases both original and corrected CV references.
		f.cleanupParticipations(t)
		if kind == "organic" {
			f.exec(t, `DELETE FROM candidate_cv_library WHERE candidate_id=$1`, f.id)
		}
		f.exec(t, `DELETE FROM company_candidate_cvs WHERE company_id=$1 AND (company_candidate_id=$2 OR company_candidate_id IS NULL)`, f.company.companyID, f.id)
	})
	ctx := context.Background()
	key, err := local.Put(ctx, []byte("%PDF-original"))
	if err != nil {
		t.Fatal(err)
	}
	out.originalKey = key
	if kind == "manual" {
		vacancy := publicationFlowReady(t, f.h, f.owner)
		publicFlowPublish(t, f.h, vacancy, f.owner)
		out.pid = uuid.New()
		cv := uuid.New()
		cfg := pipelineconfig.Defaults(uuid.MustParse(vacancy))
		f.exec(t, `INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name) VALUES($1,$2,$3,$4,13,'application/pdf','original.pdf')`, cv, f.company.companyID, f.id, key)
		f.exec(t, `INSERT INTO process_participations(id,process_id,company_candidate_id,company_candidate_cv_id,stage_id,source,added_by,profile_snapshot,questions_snapshot,answers_snapshot) VALUES($1,$2,$3,$4,$5,'manual',$6,$7::jsonb,'[]','[]')`, out.pid, vacancy, f.id, cv, cfg.Stages[0].ID, f.owner.userID, organicEditSnapshot)
	} else {
		var cv uuid.UUID
		if err = f.h.pool.QueryRow(ctx, `SELECT p.id,p.cv_version_id FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE p.candidate_id=$1 AND vp.company_id=$2 ORDER BY p.created_at DESC LIMIT 1`, f.id, f.company.companyID).Scan(&out.pid, &cv); err != nil {
			t.Fatal(err)
		}
		f.exec(t, `UPDATE candidate_cv_versions SET storage_key=$2,size=13 WHERE id=$1`, cv, key)
		f.exec(t, `INSERT INTO candidate_cv_library(id,candidate_id,version_id,name,removed_at) VALUES($1,$2,$3,'original.pdf',now())`, uuid.New(), f.id, cv)
	}
	out.pathCV = f.path + "/participations/" + out.pid.String() + "/cv"
	return out
}
func (f *candidateCVFixture) upload(t *testing.T, name, data, tag string) draftFlowResponse {
	t.Helper()
	body, typ := orgCVMultipart(t, name, []byte(data), "")
	return f.h.do(t, "POST", f.pathCV, body, f.recruiter.token, map[string]string{"If-Match": tag, "Content-Type": typ})
}
func (f *candidateCVFixture) owned(t *testing.T) string {
	t.Helper()
	var raw []byte
	err := f.h.pool.QueryRow(t.Context(), `SELECT jsonb_build_object(
 'participations',(SELECT jsonb_agg(to_jsonb(p)-'corrected_company_cv_id' ORDER BY p.id) FROM process_participations p WHERE p.candidate_id=$1 OR p.company_candidate_id=$1),
 'library',(SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM candidate_cv_library l WHERE l.candidate_id=$1),
 'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM candidate_cv_versions v WHERE v.candidate_id=$1),
 'original_company_cvs',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM company_candidate_cvs c WHERE c.id IN (SELECT company_candidate_cv_id FROM process_participations WHERE candidate_id=$1 OR company_candidate_id=$1)))`, f.id).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
func cvParticipation(t *testing.T, r draftFlowResponse, pid uuid.UUID) map[string]any {
	t.Helper()
	for _, p := range draftFlowObject(t, r.body)["participations"].([]any) {
		if p.(map[string]any)["id"] == pid.String() {
			return p.(map[string]any)
		}
	}
	t.Fatal("participation missing")
	return nil
}
func TestOrgCandidateCVRejections(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			initial := f.detail(t)
			tag := initial.header.Get("ETag")
			owned := f.owned(t)
			for _, tc := range []struct {
				name, file, data, tag string
				status                int
				code                  string
			}{
				{"required precondition", "cv.pdf", "%PDF-x", "", 428, "precondition_required"},
				{"stale precondition", "cv.pdf", "%PDF-x", `"stale"`, 412, "precondition_failed"},
				{"wildcard precondition", "cv.pdf", "%PDF-x", "*", 412, "precondition_failed"},
				{"unsupported", "cv.txt", "%PDF-x", tag, 415, "cv_unsupported_type"},
				{"sniff mismatch", "cv.docx", "%PDF-x", tag, 400, "cv_content_mismatch"},
				{"too large", "cv.pdf", strings.Repeat("x", 5242881), tag, 413, "cv_too_large"},
				{"missing CV", "", "", tag, 400, "validation_error"},
			} {
				t.Run(tc.name, func(t *testing.T) {
					r := f.upload(t, tc.file, tc.data, tc.tag)
					draftFlowAssertError(t, r, tc.status, tc.code)
					draftFlowAssertNoStore(t, r)
					if got := f.detail(t); string(got.body) != string(initial.body) || f.owned(t) != owned {
						t.Fatal("rejection changed data")
					}
					if draftFlowCount(t, f.h.pool, `SELECT count(*) FROM company_candidate_history WHERE candidate_id=$1`, f.id) != 0 || draftFlowAuditCount(t, f.h.pool, f.id, "CompanyCandidateCVCorrected") != 0 {
						t.Fatal("rejection left history/audit")
					}
				})
			}
			if kind == "organic" {
				var foreignPID uuid.UUID
				if err := f.h.pool.QueryRow(t.Context(), `SELECT p.id FROM process_participations p JOIN vacancy_processes vp ON vp.id=p.process_id WHERE p.candidate_id=$1 AND vp.company_id<>$2 LIMIT 1`, f.id, f.company.companyID).Scan(&foreignPID); err != nil {
					t.Fatal(err)
				}
				body, typ := orgCVMultipart(t, "cv.pdf", []byte("%PDF-x"), "")
				path := f.path + "/participations/" + foreignPID.String() + "/cv"
				for _, method := range []string{"POST", "GET"} {
					r := f.h.do(t, method, path, body, f.recruiter.token, map[string]string{"If-Match": tag, "Content-Type": typ})
					draftFlowAssertError(t, r, 404, "not_found")
					draftFlowAssertNoStore(t, r)
				}
				r := f.h.do(t, "GET", path+"/original", "", f.recruiter.token, nil)
				draftFlowAssertError(t, r, 404, "not_found")
			}
			// A corrected DOCX and original PDF have independent bytes and MIME headers.
			docx := orgCVDocx(t)
			r := f.upload(t, "corrected.docx", string(docx), tag)
			if r.status != 200 {
				t.Fatal(r.status, string(r.body))
			}
			r = f.h.do(t, "GET", f.pathCV, "", f.recruiter.token, nil)
			draftFlowAssertNoStore(t, r)
			if r.status != 200 || string(r.body) != string(docx) || r.header.Get("Content-Type") != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || r.header.Get("Content-Disposition") != "attachment; filename=corrected.docx" || r.header.Get("Content-Length") != fmt.Sprint(len(docx)) || r.header.Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal(r.status, r.header)
			}
			if kind == "organic" {
				// A missing original metadata reference must not fall back to the correction.
				f.exec(t, `DELETE FROM candidate_cv_library WHERE candidate_id=$1`, f.id)
				original := f.h.do(t, "GET", f.pathCV+"/original", "", f.recruiter.token, nil)
				draftFlowAssertError(t, original, 404, "not_found")
				current := f.h.do(t, "GET", f.pathCV, "", f.recruiter.token, nil)
				if current.status != 200 || string(current.body) != string(docx) {
					t.Fatal(current.status)
				}
			}
		})
	}
}

func TestOrgCandidateCVFlow(t *testing.T) {
	for _, kind := range []string{"manual", "organic"} {
		t.Run(kind, func(t *testing.T) {
			f := newCandidateCVFixture(t, kind)
			initial := f.detail(t)
			tag := initial.header.Get("ETag")
			before := f.owned(t)
			p := cvParticipation(t, initial, f.pid)
			orgCandidateKeys(t, p["cv"], "file_name", "uploaded_at", "source")
			if p["cv"].(map[string]any)["source"] != "candidate" || p["original_cv"] != nil {
				t.Fatal(p)
			}
			checkFile := func(path, data, name string) {
				t.Helper()
				r := f.h.do(t, "GET", path, "", f.recruiter.token, nil)
				draftFlowAssertNoStore(t, r)
				if r.status != 200 || string(r.body) != data || r.header.Get("Content-Type") != "application/pdf" || r.header.Get("Content-Length") != fmt.Sprint(len(data)) || r.header.Get("Content-Disposition") != mime.FormatMediaType("attachment", map[string]string{"filename": name}) || r.header.Get("X-Content-Type-Options") != "nosniff" {
					t.Fatal(r.status, r.header, string(r.body))
				}
			}
			checkFile(f.pathCV, "%PDF-original", "original.pdf")
			checkFile(f.pathCV+"/original", "%PDF-original", "original.pdf")
			for i := 1; i <= 2; i++ {
				name, data := fmt.Sprintf("corrected-%d.pdf", i), fmt.Sprintf("%%PDF-corrected-%d", i)
				r := f.upload(t, name, data, tag)
				draftFlowAssertNoStore(t, r)
				if r.status != 200 || r.header.Get("ETag") == tag {
					t.Fatal(r.status, string(r.body))
				}
				tag = r.header.Get("ETag")
				p = cvParticipation(t, r, f.pid)
				current := orgCandidateKeys(t, p["cv"], "file_name", "uploaded_at", "source")
				original := orgCandidateKeys(t, p["original_cv"], "file_name", "uploaded_at")
				if current["source"] != "company" || current["file_name"] != name || original["file_name"] != "original.pdf" {
					t.Fatal(p)
				}
				editJSONEqual(t, cvParticipation(t, f.detail(t), f.pid), p)
				checkFile(f.pathCV, data, name)
				checkFile(f.pathCV+"/original", "%PDF-original", "original.pdf")
				if got := f.owned(t); got != before {
					t.Fatal("original rows/library/snapshots changed", before, got)
				}
			}
			// CV and profile edits use the exact same version source.
			stale := f.patch(t, `{"set":{"professional_title":"Stale"}}`, initial.header.Get("ETag"))
			draftFlowAssertError(t, stale, 412, "precondition_failed")
			edit := f.patch(t, `{"set":{"professional_title":"After CV"}}`, tag)
			if edit.status != 200 {
				t.Fatal(edit.status, string(edit.body))
			}
			history := f.history(t, "?limit=1")
			if history["items"].([]any)[0].(map[string]any)["kind"] != "edit" {
				t.Fatal(history)
			}
			for i := 2; i >= 1; i-- {
				cursor, ok := history["next_cursor"].(string)
				if !ok {
					t.Fatal(history)
				}
				history = f.history(t, "?limit=1&cursor="+url.QueryEscape(cursor))
				entry := orgCandidateKeys(t, history["items"].([]any)[0], "id", "at", "actor", "kind", "participation_id", "file_name")
				if entry["kind"] != "cv_corrected" || entry["participation_id"] != f.pid.String() || entry["file_name"] != fmt.Sprintf("corrected-%d.pdf", i) || entry["actor"].(map[string]any)["id"] != f.recruiter.userID.String() {
					t.Fatal(entry)
				}
			}
			if history["next_cursor"] != nil {
				t.Fatal(history)
			}
			var count int
			var metadata string
			if err := f.h.pool.QueryRow(t.Context(), `SELECT count(*),min(metadata::text) FROM audit_events WHERE entity_id=$1 AND event_type='CompanyCandidateCVCorrected'`, f.id).Scan(&count, &metadata); err != nil || count != 2 || strings.Contains(metadata, "corrected-") || strings.Contains(metadata, "original.pdf") {
				t.Fatal(count, metadata, err)
			}
			// Foreign company, wrong identity and wrong participation never open storage.
			body, typ := orgCVMultipart(t, "cv.pdf", []byte("%PDF-rejected"), "")
			for _, path := range []string{strings.Replace(f.pathCV, f.pid.String(), uuid.NewString(), 1), strings.Replace(f.pathCV, f.id.String(), uuid.NewString(), 1)} {
				for _, method := range []string{"POST", "GET"} {
					r := f.h.do(t, method, path, body, f.recruiter.token, map[string]string{"If-Match": tag, "Content-Type": typ})
					draftFlowAssertError(t, r, 404, "not_found")
				}
			}
			for _, method := range []string{"POST", "GET"} {
				r := f.h.do(t, method, f.pathCV, body, f.foreign.token, map[string]string{"If-Match": tag, "Content-Type": typ})
				draftFlowAssertError(t, r, 404, "not_found")
			}
		})
	}
}
