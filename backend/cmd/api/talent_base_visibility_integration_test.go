//go:build integration

package main

import (
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Contract: docs/contracts/talent-base-visibility-v1.md. Everything goes through
// the production router; direct SQL only reads audit rows and seeds fixtures.

const talentBasePath = "/v2/me/company/talent-base-visibility"

func tbBody(mode string, ids ...uuid.UUID) string {
	quoted := make([]string, len(ids))
	for i, id := range ids {
		quoted[i] = strconv.Quote(id.String())
	}
	return `{"mode":"` + mode + `","user_ids":[` + strings.Join(quoted, ",") + `]}`
}

func tbGet(t *testing.T, h *draftFlowHarness, actor draftFlowActor) draftFlowResponse {
	t.Helper()
	return h.do(t, "GET", talentBasePath, "", actor.token, nil)
}

func tbPut(t *testing.T, h *draftFlowHarness, actor draftFlowActor, ifMatch, body string) draftFlowResponse {
	t.Helper()
	headers := map[string]string{"Content-Type": "application/json"}
	if ifMatch != "" {
		headers["If-Match"] = ifMatch
	}
	return h.do(t, "PUT", talentBasePath, body, actor.token, headers)
}

// tbSet replaces the setting with the owner's current ETag and requires 200.
func tbSet(t *testing.T, h *draftFlowHarness, owner draftFlowActor, mode string, ids ...uuid.UUID) draftFlowResponse {
	t.Helper()
	current := tbGet(t, h, owner)
	if current.status != 200 {
		t.Fatalf("get %d %s", current.status, current.body)
	}
	r := tbPut(t, h, owner, current.header.Get("ETag"), tbBody(mode, ids...))
	if r.status != 200 {
		t.Fatalf("put %d %s", r.status, r.body)
	}
	return r
}

func tbViewerIDs(t *testing.T, body []byte) []string {
	t.Helper()
	ids := []string{}
	for _, raw := range draftFlowObject(t, body)["viewers"].([]any) {
		ids = append(ids, raw.(map[string]any)["user_id"].(string))
	}
	return ids
}

func tbFieldNames(t *testing.T, body []byte) []string {
	t.Helper()
	fields, ok := draftFlowObject(t, body)["fields"].([]any)
	if !ok {
		t.Fatalf("fields is not an array: %s", body)
	}
	out := []string{}
	for _, raw := range fields {
		entry := orgCandidateKeys(t, raw, "field", "code")
		out = append(out, entry["field"].(string))
	}
	return out
}

// tbAudit returns the metadata of every TalentBaseVisibilityChanged event of the company, oldest first.
func tbAudit(t *testing.T, h *draftFlowHarness, companyID uuid.UUID) []map[string]any {
	t.Helper()
	rows, err := h.pool.Query(context.Background(), `SELECT actor_id,entity_type,metadata FROM audit_events WHERE entity_id=$1 AND event_type='TalentBaseVisibilityChanged' ORDER BY occurred_at,id`, companyID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var actor *uuid.UUID
		var entity string
		var raw []byte
		if err := rows.Scan(&actor, &entity, &raw); err != nil {
			t.Fatal(err)
		}
		if actor == nil || entity != "company" {
			t.Fatalf("audit actor=%v entity_type=%q", actor, entity)
		}
		var meta map[string]any
		if err := json.Unmarshal(raw, &meta); err != nil {
			t.Fatal(err)
		}
		meta["_actor"] = actor.String()
		out = append(out, meta)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func tbSetFullName(t *testing.T, h *draftFlowHarness, user uuid.UUID, name string) {
	t.Helper()
	if _, err := h.pool.Exec(context.Background(), `UPDATE users SET full_name=$2 WHERE id=$1`, user, name); err != nil {
		t.Fatal(err)
	}
}

func TestTalentBaseVisibility_DefaultDocumentForNeverSavedCompany(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	for name, actor := range map[string]draftFlowActor{"owner": h.actor(t, ownerID, ownerSub), "recruiter": h.actor(t, recruiterID, recruiterSub)} {
		t.Run(name, func(t *testing.T) {
			r := tbGet(t, h, actor)
			draftFlowAssertNoStore(t, r)
			if r.status != 200 || r.header.Get("ETag") != `"1"` {
				t.Fatalf("%d etag=%q %s", r.status, r.header.Get("ETag"), r.body)
			}
			doc := orgCandidateKeys(t, draftFlowObject(t, r.body), "mode", "viewers", "version", "updated_at", "updated_by")
			if doc["mode"] != "all_recruiters" || doc["version"] != float64(1) || doc["updated_at"] != nil || doc["updated_by"] != nil {
				t.Fatal(string(r.body))
			}
			if viewers, ok := doc["viewers"].([]any); !ok || len(viewers) != 0 {
				t.Fatalf("viewers must be an empty array: %s", r.body)
			}
		})
	}
	anonymous := h.do(t, "GET", talentBasePath, "", "", nil)
	draftFlowAssertError(t, anonymous, 401, "unauthenticated")
	if n := draftFlowCount(t, h.pool, `SELECT count(*) FROM company_talent_base_settings WHERE company_id=$1`, company.companyID); n != 0 {
		t.Fatalf("reading must not create the settings row, got %d", n)
	}
}

func TestTalentBaseVisibility_PutSuccessReplacesViewersAndAudits(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	zedID, _ := company.addUser(t, "recruiter")
	anaID, _ := company.addUser(t, "recruiter")
	anaTwinID, _ := company.addUser(t, "recruiter")
	tbSetFullName(t, h, zedID, "Zed Zamora")
	tbSetFullName(t, h, anaID, "Ana Pérez")
	tbSetFullName(t, h, anaTwinID, "Ana Pérez")
	tbSetFullName(t, h, ownerID, "Owner Uno")

	first := tbSet(t, h, owner, "selected_users", zedID, anaID, anaTwinID)
	draftFlowAssertNoStore(t, first)
	if first.header.Get("ETag") != `"2"` {
		t.Fatalf("etag=%q", first.header.Get("ETag"))
	}
	doc := orgCandidateKeys(t, draftFlowObject(t, first.body), "mode", "viewers", "version", "updated_at", "updated_by")
	if doc["mode"] != "selected_users" || doc["version"] != float64(2) || doc["updated_at"] == nil {
		t.Fatal(string(first.body))
	}
	editJSONEqual(t, doc["updated_by"], map[string]any{"user_id": ownerID.String(), "full_name": "Owner Uno"})
	pair := []string{anaID.String(), anaTwinID.String()}
	sort.Strings(pair)
	editJSONEqual(t, tbViewerIDs(t, first.body), append(pair, zedID.String()))
	viewer := orgCandidateKeys(t, doc["viewers"].([]any)[2], "user_id", "full_name", "email", "role", "added_at")
	if viewer["full_name"] != "Zed Zamora" || viewer["role"] != "recruiter" || !strings.HasSuffix(viewer["email"].(string), "@example.test") || viewer["added_at"] == nil {
		t.Fatal(viewer)
	}
	if again := tbGet(t, h, owner); string(again.body) != string(first.body) || again.header.Get("ETag") != `"2"` {
		t.Fatalf("GET differs from the PUT response: %s vs %s", again.body, first.body)
	}

	// Replace: keep one, drop two, add none.
	second := tbSet(t, h, owner, "selected_users", zedID)
	editJSONEqual(t, tbViewerIDs(t, second.body), []string{zedID.String()})
	// No-op replace still increments the version and is audited with empty arrays.
	third := tbSet(t, h, owner, "selected_users", zedID)
	if third.header.Get("ETag") != `"4"` {
		t.Fatalf("no-op PUT etag=%q", third.header.Get("ETag"))
	}
	// Back to everyone clears the list.
	fourth := tbSet(t, h, owner, "all_recruiters")
	editJSONEqual(t, draftFlowObject(t, fourth.body)["viewers"], []any{})

	sortedPair := func(ids ...string) []any {
		sort.Strings(ids)
		out := make([]any, len(ids))
		for i, id := range ids {
			out[i] = id
		}
		return out
	}
	base := func(version float64, previous, next string, added, removed []any) map[string]any {
		return map[string]any{"company_id": company.companyID.String(), "version": version, "previous_mode": previous, "new_mode": next, "added_user_ids": added, "removed_user_ids": removed, "_actor": ownerID.String()}
	}
	audit := tbAudit(t, h, company.companyID)
	if len(audit) != 4 {
		t.Fatalf("audit rows=%d %v", len(audit), audit)
	}
	for i, want := range []map[string]any{
		base(2, "all_recruiters", "selected_users", sortedPair(zedID.String(), anaID.String(), anaTwinID.String()), []any{}),
		base(3, "selected_users", "selected_users", []any{}, sortedPair(anaID.String(), anaTwinID.String())),
		base(4, "selected_users", "selected_users", []any{}, []any{}),
		base(5, "selected_users", "all_recruiters", []any{}, []any{zedID.String()}),
	} {
		editJSONEqual(t, audit[i], want)
	}
}

func TestTalentBaseVisibility_PutErrorTable(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	recruiterID, recruiterSub := company.addUser(t, "recruiter")
	recruiter := h.actor(t, recruiterID, recruiterSub)
	secondOwnerID, _ := company.addUser(t, "owner")
	_, foreignOwnerID, _ := draftFlowNewPrincipal(t, h.pool, "active")
	// Start from a saved state so "unchanged" has something to compare.
	tbSet(t, h, owner, "selected_users", recruiterID)
	etag := tbGet(t, h, owner).header.Get("ETag")
	id := func(u uuid.UUID) string { return strconv.Quote(u.String()) }

	for _, tc := range []struct {
		name    string
		actor   draftFlowActor
		ifMatch string
		body    string
		status  int
		code    string
		fields  []string
	}{
		{"recruiter calls it", recruiter, etag, tbBody("all_recruiters"), 403, "forbidden", nil},
		{"missing If-Match", owner, "", tbBody("all_recruiters"), 428, "precondition_required", nil},
		{"malformed If-Match", owner, "abc", tbBody("all_recruiters"), 400, "invalid_request", nil},
		{"unquoted If-Match", owner, "2", tbBody("all_recruiters"), 400, "invalid_request", nil},
		{"unknown key", owner, etag, `{"mode":"all_recruiters","user_ids":[],"extra":1}`, 400, "invalid_request", nil},
		{"not JSON", owner, etag, `{`, 400, "invalid_request", nil},
		{"mode missing", owner, etag, `{"user_ids":[]}`, 400, "validation_error", []string{"mode"}},
		{"mode unknown", owner, etag, `{"mode":"everyone","user_ids":[]}`, 400, "validation_error", []string{"mode"}},
		{"mode not a string", owner, etag, `{"mode":1,"user_ids":[]}`, 400, "validation_error", []string{"mode"}},
		{"user_ids missing", owner, etag, `{"mode":"selected_users"}`, 400, "validation_error", []string{"user_ids"}},
		{"user_ids not an array", owner, etag, `{"mode":"selected_users","user_ids":"x"}`, 400, "validation_error", []string{"user_ids"}},
		{"user_ids null", owner, etag, `{"mode":"selected_users","user_ids":null}`, 400, "validation_error", []string{"user_ids"}},
		{"user_ids not uuids", owner, etag, `{"mode":"selected_users","user_ids":["nope"]}`, 400, "validation_error", []string{"user_ids"}},
		{"duplicate id", owner, etag, `{"mode":"selected_users","user_ids":[` + id(recruiterID) + `,` + id(recruiterID) + `]}`, 400, "validation_error", []string{"user_ids[1]"}},
		{"ids with all_recruiters", owner, etag, tbBody("all_recruiters", recruiterID), 422, "talent_base_users_not_applicable", []string{"user_ids"}},
		{"unknown user", owner, etag, tbBody("selected_users", recruiterID, uuid.New()), 422, "talent_base_viewer_not_member", []string{"user_ids[1]"}},
		{"member of another company", owner, etag, tbBody("selected_users", foreignOwnerID), 422, "talent_base_viewer_not_member", []string{"user_ids[0]"}},
		{"owner in the list", owner, etag, tbBody("selected_users", recruiterID, secondOwnerID), 422, "talent_base_viewer_is_owner", []string{"user_ids[1]"}},
		{"caller owner in the list", owner, etag, tbBody("selected_users", ownerID), 422, "talent_base_viewer_is_owner", []string{"user_ids[0]"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			beforeDoc := tbGet(t, h, owner)
			beforeAudit := len(tbAudit(t, h, company.companyID))
			r := tbPut(t, h, tc.actor, tc.ifMatch, tc.body)
			draftFlowAssertError(t, r, tc.status, tc.code)
			if tc.fields != nil {
				editJSONEqual(t, tbFieldNames(t, r.body), tc.fields)
			}
			if after := tbGet(t, h, owner); string(after.body) != string(beforeDoc.body) || after.header.Get("ETag") != beforeDoc.header.Get("ETag") {
				t.Fatalf("rejected PUT changed the setting: %s -> %s", beforeDoc.body, after.body)
			}
			if got := len(tbAudit(t, h, company.companyID)); got != beforeAudit {
				t.Fatalf("rejected PUT wrote audit rows: %d -> %d", beforeAudit, got)
			}
		})
	}

	t.Run("stale If-Match returns the current document", func(t *testing.T) {
		current := tbGet(t, h, owner)
		r := tbPut(t, h, owner, `"1"`, tbBody("all_recruiters"))
		draftFlowAssertError(t, r, 412, "talent_base_visibility_version_conflict")
		if r.header.Get("ETag") != current.header.Get("ETag") {
			t.Fatalf("etag=%q want %q", r.header.Get("ETag"), current.header.Get("ETag"))
		}
		got := draftFlowObject(t, r.body)
		for key, want := range draftFlowObject(t, current.body) {
			if !reflect.DeepEqual(got[key], want) {
				t.Fatalf("conflict body %s = %v, want %v", key, got[key], want)
			}
		}
		if got["error"] != "talent base visibility changed" {
			t.Fatal(string(r.body))
		}
		if after := tbGet(t, h, owner); string(after.body) != string(current.body) {
			t.Fatal("stale PUT changed the setting")
		}
	})
}

func TestTalentBaseVisibility_CapabilityFlagOnMyCompany(t *testing.T) {
	h := newDraftFlowHarness(t)
	company, ownerID, ownerSub := draftFlowNewPrincipal(t, h.pool, "active")
	owner := h.actor(t, ownerID, ownerSub)
	listedID, listedSub := company.addUser(t, "recruiter")
	otherID, otherSub := company.addUser(t, "recruiter")
	listed, other := h.actor(t, listedID, listedSub), h.actor(t, otherID, otherSub)
	// The shared fixture RFC is 32 characters; GET /me/company rehydrates a valid company.
	if _, err := h.pool.Exec(context.Background(), `UPDATE companies SET rfc=upper(right(replace(id::text,'-',''),12)) WHERE id=$1`, company.companyID); err != nil {
		t.Fatal(err)
	}

	can := func(actor draftFlowActor) bool {
		t.Helper()
		r := h.do(t, "GET", "/me/company", "", actor.token, nil)
		if r.status != 200 {
			t.Fatalf("%d %s", r.status, r.body)
		}
		body := draftFlowObject(t, r.body)
		flag := orgCandidateKeys(t, body["can"], "view_talent_base")["view_talent_base"]
		value, ok := flag.(bool)
		if !ok {
			t.Fatalf("view_talent_base is not a boolean: %s", r.body)
		}
		return value
	}
	if !can(owner) || !can(listed) || !can(other) {
		t.Fatal("everyone sees the talent base by default")
	}
	tbSet(t, h, owner, "selected_users", listedID)
	if !can(owner) || !can(listed) || can(other) {
		t.Fatalf("selected_users: owner=%v listed=%v unlisted=%v", can(owner), can(listed), can(other))
	}
	tbSet(t, h, owner, "selected_users")
	if !can(owner) || can(listed) || can(other) {
		t.Fatal("empty selection: only the owner sees the talent base")
	}
	tbSet(t, h, owner, "all_recruiters")
	if !can(owner) || !can(listed) || !can(other) {
		t.Fatal("back to all_recruiters restores access")
	}
}
