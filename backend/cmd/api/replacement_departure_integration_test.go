//go:build integration

package main

import (
	"bytes"
	"context"
	"fmt"
	"mime/multipart"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// Replacement processes R5 (docs/contracts/replacement-processes-v1.md,
// «Departure on a finished process», user decision S7): a finished process stays
// read-only except for moving a Placement hire out with candidate_left or
// moved_by_mistake. Observed through the production router.

type departureFlow struct {
	*candidateCVFixture
	t          *testing.T
	base, path string
	order      []string          // stage ids in progression order
	stage      map[string]string // kind -> stage id (the exit stage is "discarded")
}

func newDepartureFlow(t *testing.T) *departureFlow {
	t.Helper()
	f := newCandidateCVFixture(t, "manual")
	base, path := boardCorrectionPaths(t, f)
	d := &departureFlow{candidateCVFixture: f, t: t, base: base, path: path, stage: map[string]string{}}
	board := draftFlowObject(t, boardCorrectionRead(t, f, base+"/board", f.owner).body)
	for _, raw := range board["stages"].([]any) {
		s := raw.(map[string]any)
		d.order = append(d.order, s["id"].(string))
		d.stage[s["kind"].(string)] = s["id"].(string)
	}
	d.stage["discarded"] = board["exit"].(map[string]any)["id"].(string)
	return d
}

func (d *departureFlow) tag() string {
	d.t.Helper()
	return draftFlowObject(d.t, boardCorrectionRead(d.t, d.candidateCVFixture, d.path, d.owner).body)["etag"].(string)
}

func (d *departureFlow) postTag(op, body, tag string) draftFlowResponse {
	d.t.Helper()
	return d.h.do(d.t, "POST", d.path+"/"+op, body, d.owner.token, map[string]string{"If-Match": tag})
}

func (d *departureFlow) post(op, body string) draftFlowResponse {
	d.t.Helper()
	return d.postTag(op, body, d.tag())
}

// advance moves the participation stage by stage until `kind` (inclusive).
func (d *departureFlow) advance(kind string) {
	d.t.Helper()
	for _, id := range d.order[1:] {
		if r := d.post("moves", `{"to_stage_id":"`+id+`"}`); r.status != 200 {
			d.t.Fatalf("move: %d %s", r.status, r.body)
		}
		if id == d.stage[kind] {
			return
		}
	}
}

func (d *departureFlow) lifecycle() (draftFlowResponse, map[string]any) {
	d.t.Helper()
	got := d.h.do(d.t, "GET", d.base+"/lifecycle", "", d.owner.token, nil)
	if got.status != 200 {
		d.t.Fatalf("lifecycle: %d %s", got.status, got.body)
	}
	return got, draftFlowObject(d.t, got.body)
}

// closeProcess closes the vacancy; process is "continue" or "finish".
func (d *departureFlow) closeProcess(process string) {
	d.t.Helper()
	cur, _ := d.lifecycle()
	r := d.h.do(d.t, "POST", d.base+"/lifecycle/close", `{"process":"`+process+`","reason":"cancelled","reason_note":null}`, d.owner.token,
		map[string]string{"If-Match": cur.header.Get("ETag"), "Idempotency-Key": uuid.NewString()})
	if r.status != 200 {
		d.t.Fatalf("close: %d %s", r.status, r.body)
	}
}

// snapshot holds everything a rejection must leave alone, and (without the
// participation, credit and audit parts) everything the departure must not touch.
func (d *departureFlow) snapshot(withParticipation bool) string {
	d.t.Helper()
	q := `SELECT jsonb_build_array(
 (SELECT to_jsonb(p) FROM vacancy_processes p WHERE id=$1),
 (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]') FROM process_coverage_milestones m WHERE process_id=$1),
 (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY process_id),'[]') FROM process_delivery_fulfillments f WHERE process_id=$1),
 (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM vacancy_lifecycle_events e WHERE process_id=$1))::text`
	if withParticipation {
		q = `SELECT jsonb_build_array(
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM process_participations p WHERE process_id=$1),
 (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY id),'[]') FROM participation_stage_history h WHERE participation_id IN (SELECT id FROM process_participations WHERE process_id=$1)),
 (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM placement_credits c WHERE process_id=$1),
 (SELECT count(*) FROM audit_events WHERE company_id=$2 AND event_type NOT IN ('ParticipationViewed','ParticipationCVDownloaded')),
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]') FROM vacancy_processes p WHERE id=$1),
 (SELECT count(*) FROM process_coverage_milestones WHERE process_id=$1))::text`
	}
	args := []any{d.base[len(draftFlowV2Path)+1:]}
	if withParticipation {
		args = append(args, d.company.companyID)
	}
	var out string
	if err := d.h.pool.QueryRow(context.Background(), q, args...).Scan(&out); err != nil {
		d.t.Fatal(err)
	}
	return out
}

func (d *departureFlow) credit() (id, status string, exit *string) {
	d.t.Helper()
	if err := d.h.pool.QueryRow(context.Background(), `SELECT id::text,status,exit_reason FROM placement_credits WHERE participation_id=$1 ORDER BY hired_at DESC LIMIT 1`, d.pid).Scan(&id, &status, &exit); err != nil {
		d.t.Fatal(err)
	}
	return
}

func (d *departureFlow) board() map[string]any {
	d.t.Helper()
	return draftFlowObject(d.t, boardCorrectionRead(d.t, d.candidateCVFixture, d.base+"/board", d.owner).body)
}

func (d *departureFlow) assertFinished(r draftFlowResponse) {
	d.t.Helper()
	_, want := d.lifecycle()
	root := draftFlowObject(d.t, r.body)
	if r.status != 409 || root["code"] != "process_finished" || !reflect.DeepEqual(root["data"], map[string]any{"lifecycle": want}) || r.header.Get("ETag") != "" {
		d.t.Fatalf("want 409 process_finished, got %d %s", r.status, r.body)
	}
}

const departureDiscardReasonCandidate = `{"group":"candidate","key":"no_longer_interested"}`

func TestDepartureOnClosedAndFinishedProcess(t *testing.T) {
	for _, process := range []string{"open", "continue", "finish"} {
		for _, exit := range []string{"candidate_left", "moved_by_mistake"} {
			for _, reason := range []string{departureDiscardReasonCandidate, `{"group":"recruiter","key":"profile_mismatch"}`} {
				t.Run(process+"/"+exit+"/"+reason, func(t *testing.T) {
					d := newDepartureFlow(t)
					d.advance("placement")
					if process != "open" {
						d.closeProcess(process)
					}
					_, before := d.lifecycle()
					if before["can_start_replacement"] != false || before["startable_credits_count"] != float64(0) {
						t.Fatal("nothing is startable before the departure", before)
					}
					boardBefore := d.board()
					if boardBefore["coverage"].(map[string]any)["covered"] != float64(1) {
						t.Fatal(boardBefore["coverage"])
					}
					fixed := d.snapshot(false)
					auditBefore := draftFlowCount(t, d.h.pool, `SELECT count(*) FROM audit_events WHERE company_id=$1 AND event_type IN ('ParticipationDiscarded','VacancyPlacementCreditChanged')`, d.company.companyID)

					r := d.post("discard", fmt.Sprintf(`{"reason":%s,"placement_exit_reason":%q}`, reason, exit))
					if r.status != 200 {
						t.Fatalf("departure: %d %s", r.status, r.body)
					}
					body := draftFlowObject(t, r.body)
					lc, ok := body["lifecycle"].(map[string]any)
					if !ok {
						t.Fatalf("a placement departure carries the lifecycle view: %s", r.body)
					}
					replAssertKeys(t, lc)
					if body["stage_id"] != d.stage["discarded"] || body["coverage"].(map[string]any)["covered"] != float64(0) {
						t.Fatal("the hire left and coverage dropped", body["stage_id"], body["coverage"])
					}
					if !reflect.DeepEqual(body["delivery"], boardBefore["delivery"]) {
						t.Fatal("delivery summary changed", body["delivery"], boardBefore["delivery"])
					}
					if got := d.board()["coverage"].(map[string]any)["covered"]; got != float64(0) {
						t.Fatal("board coverage", got)
					}

					// Credit, original result, milestones, fulfillment and lifecycle history stay as they were.
					wantStatus := map[string]string{"candidate_left": "did_not_hold", "moved_by_mistake": "voided"}[exit]
					cid, status, stored := d.credit()
					if status != wantStatus || stored == nil || *stored != exit {
						t.Fatal("credit", status, stored)
					}
					if d.snapshot(false) != fixed {
						t.Fatal("the departure touched the process row, milestones, fulfillment or lifecycle history")
					}
					assertCreditAudit(t, d.candidateCVFixture, "VacancyPlacementCreditChanged", map[string]any{"company_id": d.company.companyID.String(), "vacancy_id": d.base[len(draftFlowV2Path)+1:], "credit_id": cid, "from_status": "active", "to_status": wantStatus, "cause": "exit:" + exit})
					if n := draftFlowCount(t, d.h.pool, `SELECT count(*) FROM audit_events WHERE company_id=$1 AND event_type IN ('ParticipationDiscarded','VacancyPlacementCreditChanged')`, d.company.companyID); n != auditBefore+2 {
						t.Fatal("audit events", n, auditBefore)
					}
					if n := draftFlowCount(t, d.h.pool, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND event_type='ParticipationDiscarded' AND metadata->>'departure'='true'`, d.pid); n != 1 {
						t.Fatal("departure audit", n)
					}

					// The response view is the committed view; the GET agrees and the button follows the rules.
					got, after := d.lifecycle()
					if !reflect.DeepEqual(lc, after) {
						t.Fatal("response lifecycle differs from GET", lc, after)
					}
					_ = got
					for _, k := range []string{"publication", "process", "version", "closed_at", "process_finished_at", "close_reason", "closed_covered"} {
						if !reflect.DeepEqual(before[k], after[k]) {
							t.Fatalf("%s changed: %v -> %v", k, before[k], after[k])
						}
					}
					startable := exit == "candidate_left" && process != "open"
					wantBlocker, count := any(nil), float64(0)
					switch {
					case exit == "candidate_left":
						count = 1
						if process == "open" {
							wantBlocker = "source_not_closed"
						}
					default:
						wantBlocker = "no_startable_credits"
						if process == "open" {
							wantBlocker = "source_not_closed"
						}
					}
					if after["can_start_replacement"] != startable || after["start_replacement_blocker"] != wantBlocker || after["startable_credits_count"] != count {
						t.Fatal("start replacement", after)
					}
				})
			}
		}
	}
}

// A finished board is read-only for everything but that one action (S7).
func TestFinishedProcessStaysReadOnlyExceptThePlacementDeparture(t *testing.T) {
	t.Run("not in placement", func(t *testing.T) {
		d := newDepartureFlow(t)
		d.advance("in_process")
		d.closeProcess("finish")
		before := d.snapshot(true)
		stale := `"stale"`
		for name, r := range map[string]draftFlowResponse{
			"discard":       d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`}`),
			"discard stale": d.postTag("discard", `{"reason":`+departureDiscardReasonCandidate+`}`, stale),
			"discard exit":  d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`,"placement_exit_reason":"candidate_left"}`),
			"recover":       d.post("recover", `{}`),
			"move":          d.post("moves", `{"to_stage_id":"`+d.stage["screening"]+`"}`),
			"move forward":  d.post("moves", `{"to_stage_id":"`+d.stage["placement"]+`"}`),
			"substate":      d.post("substate", `{"substate_id":null}`),
		} {
			t.Run(name, func(t *testing.T) { d.assertFinished(r) })
		}
		if d.snapshot(true) != before {
			t.Fatal("rejections wrote data")
		}
	})

	t.Run("discarded earlier", func(t *testing.T) {
		d := newDepartureFlow(t)
		d.advance("screening")
		if r := d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`}`); r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		d.closeProcess("finish")
		before := d.snapshot(true)
		for name, r := range map[string]draftFlowResponse{
			"recover":       d.post("recover", `{}`),
			"discard again": d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`}`),
		} {
			t.Run(name, func(t *testing.T) { d.assertFinished(r) })
		}
		if d.snapshot(true) != before {
			t.Fatal("rejections wrote data")
		}
	})

	t.Run("hired", func(t *testing.T) {
		d := newDepartureFlow(t)
		d.advance("placement")
		d.closeProcess("finish")
		before := d.snapshot(true)
		for name, r := range map[string]draftFlowResponse{
			"move out of placement": d.post("moves", `{"to_stage_id":"`+d.stage["in_process"]+`"}`),
			"substate":              d.post("substate", `{"substate_id":null}`),
			"recover":               d.post("recover", `{"confirm_placement_reentry":true}`),
		} {
			t.Run(name, func(t *testing.T) { d.assertFinished(r) })
		}
		t.Run("manual intake", func(t *testing.T) {
			ctx := context.Background()
			tag, err := d.h.pool.Exec(ctx, `INSERT INTO geo_countries(code,name_es,name_en) VALUES('US','Estados Unidos','United States') ON CONFLICT DO NOTHING`)
			if err != nil {
				t.Fatal(err)
			}
			if tag.RowsAffected() == 1 {
				t.Cleanup(func() { _, _ = d.h.pool.Exec(ctx, `DELETE FROM geo_countries WHERE code='US'`) })
			}
			data := fmt.Sprintf(`{"stage_id":%q,"existing":null,"confirmed_distinct":false,"candidate":{"full_name":"Manual Candidate","education":[{"level":"bachelor","institution":null,"field":null,"status":"completed","start_year":null,"end_year":null}],"years_of_experience":"1.5","seniority":"junior","languages":[{"code":"es","level":"native"}],"email":"departure-%s@example.test","phone":null,"residence":{"country":"US"}}}`, d.stage["new"], uuid.NewString())
			var b bytes.Buffer
			m := multipart.NewWriter(&b)
			p, _ := m.CreateFormField("data")
			_, _ = p.Write([]byte(data))
			p, _ = m.CreateFormFile("cv", "resume.pdf")
			_, _ = p.Write([]byte("%PDF-1 departure"))
			_ = m.Close()
			r := d.h.do(t, "POST", d.base+"/pipeline/candidates/manual", b.String(), d.owner.token, map[string]string{"Idempotency-Key": uuid.NewString(), "Content-Type": m.FormDataContentType()})
			d.assertFinished(r)
		})
		if d.snapshot(true) != before {
			t.Fatal("rejections wrote data")
		}

		// The exit reason is still required, and the ETag is still checked, before the one allowed action writes.
		missing := d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`}`)
		draftFlowAssertCatalogError(t, missing, 409, "placement_exit_reason_required")
		stale := d.postTag("discard", `{"reason":`+departureDiscardReasonCandidate+`,"placement_exit_reason":"candidate_left"}`, `"stale"`)
		if stale.status != 412 && stale.status != 400 {
			t.Fatalf("stale ETag: %d %s", stale.status, stale.body)
		}
		if d.snapshot(true) != before {
			t.Fatal("rejections wrote data")
		}

		// After the departure the participation is a discarded one: nothing else is allowed on it.
		if r := d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`,"placement_exit_reason":"candidate_left"}`); r.status != 200 {
			t.Fatal(r.status, string(r.body))
		}
		afterDeparture := d.snapshot(true)
		for name, r := range map[string]draftFlowResponse{
			"discard again": d.post("discard", `{"reason":`+departureDiscardReasonCandidate+`,"placement_exit_reason":"moved_by_mistake"}`),
			"recover":       d.post("recover", `{"confirm_placement_reentry":true}`),
		} {
			t.Run(name, func(t *testing.T) { d.assertFinished(r) })
		}
		if d.snapshot(true) != afterDeparture {
			t.Fatal("rejections wrote data")
		}
		if _, status, _ := d.credit(); status != "did_not_hold" {
			t.Fatal("credit", status)
		}
	})

	t.Run("unknown participation", func(t *testing.T) {
		d := newDepartureFlow(t)
		d.advance("placement")
		d.closeProcess("finish")
		before := d.snapshot(true)
		unknown := d.base + "/participations/" + uuid.NewString()
		hdr := map[string]string{"If-Match": `"x"`}
		draftFlowAssertCatalogError(t, d.h.do(t, "POST", unknown+"/discard", `{"reason":`+departureDiscardReasonCandidate+`,"placement_exit_reason":"candidate_left"}`, d.owner.token, hdr), 404, "not_found")
		// Only the discard route changed: the other writes keep answering process_finished.
		for _, op := range []string{"recover", "moves", "substate"} {
			d.assertFinished(d.h.do(t, "POST", unknown+"/"+op, `{}`, d.owner.token, hdr))
		}
		if d.snapshot(true) != before {
			t.Fatal("rejections wrote data")
		}
	})
}
