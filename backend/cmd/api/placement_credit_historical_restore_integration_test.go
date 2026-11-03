//go:build integration

package main

import (
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func creditCorrection(t *testing.T, f *candidateCVFixture, path, cid, action, want string) {
	t.Helper()
	r := f.h.do(t, "POST", path+"/placement-credits/"+cid+"/"+action, `{}`, f.owner.token, map[string]string{"Idempotency-Key": uuid.NewString()})
	if r.status != 200 {
		t.Fatalf("%s: %d %s", action, r.status, r.body)
	}
	c := draftFlowObject(t, r.body)
	if c["id"] != cid || c["status"] != want {
		t.Fatalf("%s: want %s, got %s", action, want, r.body)
	}
	assertCreditAtMostOneActive(t, f, path)
}
func creditEpisodeList(t *testing.T, f *candidateCVFixture, path string) []any {
	t.Helper()
	r := f.h.do(t, "GET", path+"/placement-credits", "", f.owner.token, nil)
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	return draftFlowObject(t, r.body)["items"].([]any)
}
func assertCreditAtMostOneActive(t *testing.T, f *candidateCVFixture, path string) {
	t.Helper()
	active := 0
	for _, raw := range creditEpisodeList(t, f, path) {
		if raw.(map[string]any)["status"] == "active" {
			active++
		}
	}
	if active > 1 {
		t.Fatalf("participation has %d active credits", active)
	}
}
func creditEpisodeExit(t *testing.T, f *candidateCVFixture, path, op, target, reason string) {
	t.Helper()
	d := draftFlowObject(t, boardCorrectionRead(t, f, path, f.owner).body)
	body := fmt.Sprintf(`{"to_stage_id":%q,"placement_exit_reason":%q}`, target, reason)
	if op == "discard" {
		body = fmt.Sprintf(`{"reason":{"group":"candidate","key":"unresponsive"},"placement_exit_reason":%q}`, reason)
	}
	r := f.h.do(t, "POST", path+"/"+op, body, f.owner.token, map[string]string{"If-Match": d["etag"].(string)})
	if r.status != 200 {
		t.Fatal(r.status, string(r.body))
	}
	assertCreditAtMostOneActive(t, f, path)
}

func TestPlacementCreditHistoricalRestoreThenExit(t *testing.T) {
	for _, op := range []string{"moves", "discard"} {
		t.Run(op, func(t *testing.T) {
			f := newCandidateCVFixture(t, "manual")
			_, path, cfg := creditMoveToHire(t, f)
			defer assertCreditAtMostOneActive(t, f, path)
			a := creditEpisodeList(t, f, path)[0].(map[string]any)["id"].(string)
			target := cfg.Stages[len(cfg.Stages)-2].ID
			creditEpisodeExit(t, f, path, "moves", target, "candidate_left")
			creditMove(t, f, path, fmt.Sprintf(`{"to_stage_id":%q}`, cfg.Stages[len(cfg.Stages)-1].ID))
			b := creditEpisodeList(t, f, path)[0].(map[string]any)["id"].(string)
			if a == b {
				t.Fatal("re-hire reused a credit")
			}
			creditCorrection(t, f, path, a, "void", "voided")
			creditCorrection(t, f, path, a, "restore", "did_not_hold")
			creditEpisodeExit(t, f, path, op, target, "candidate_left")
			for _, raw := range creditEpisodeList(t, f, path) {
				c := raw.(map[string]any)
				if c["status"] != "did_not_hold" {
					t.Fatal("active credit outside placement", c)
				}
			}
		})
	}
}

func TestPlacementCreditVoidedEpisodeExitThenRestore(t *testing.T) {
	for _, op := range []string{"moves", "discard"} {
		for _, reason := range []string{"candidate_left", "moved_by_mistake"} {
			t.Run(op+"/"+reason, func(t *testing.T) {
				f := newCandidateCVFixture(t, "manual")
				_, path, cfg := creditMoveToHire(t, f)
				defer assertCreditAtMostOneActive(t, f, path)
				cid := creditEpisodeList(t, f, path)[0].(map[string]any)["id"].(string)
				creditCorrection(t, f, path, cid, "void", "voided")
				var before []byte
				if err := f.h.pool.QueryRow(t.Context(), `SELECT jsonb_build_object('at',status_changed_at,'by',status_changed_by) FROM placement_credits WHERE id=$1`, cid).Scan(&before); err != nil {
					t.Fatal(err)
				}
				audits := draftFlowAuditCount(t, f.h.pool, f.pid, "VacancyPlacementCreditChanged")
				creditEpisodeExit(t, f, path, op, cfg.Stages[len(cfg.Stages)-2].ID, reason)
				c := creditEpisodeList(t, f, path)[0].(map[string]any)
				if c["status"] != "voided" || c["exit_reason"] != reason {
					t.Fatal("voided episode lost its departure", c)
				}
				var linked bool
				if err := f.h.pool.QueryRow(t.Context(), `SELECT h.departure AND h.participation_id=c.participation_id AND h.created_at>c.hired_at AND c.exit_reason=$2 AND jsonb_build_object('at',c.status_changed_at,'by',c.status_changed_by)=$3::jsonb FROM placement_credits c JOIN participation_stage_history h ON h.id=c.exit_history_id WHERE c.id=$1`, cid, reason, before).Scan(&linked); err != nil || !linked {
					t.Fatal("missing exit linkage or status timestamp changed", linked, err)
				}
				if draftFlowAuditCount(t, f.h.pool, f.pid, "VacancyPlacementCreditChanged") != audits {
					t.Fatal("unchanged voided status emitted an audit")
				}
				creditCorrection(t, f, path, cid, "restore", "did_not_hold")
			})
		}
	}
}

func TestPlacementCreditVoidRestoreOpenEpisode(t *testing.T) {
	f := newCandidateCVFixture(t, "manual")
	_, path, _ := creditMoveToHire(t, f)
	defer assertCreditAtMostOneActive(t, f, path)
	cid := creditEpisodeList(t, f, path)[0].(map[string]any)["id"].(string)
	creditCorrection(t, f, path, cid, "void", "voided")
	creditCorrection(t, f, path, cid, "restore", "active")
	c := creditEpisodeList(t, f, path)[0].(map[string]any)
	if c["exit_reason"] != nil {
		t.Fatal("open episode gained an exit", c)
	}
}
