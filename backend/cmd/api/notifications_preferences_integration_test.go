//go:build integration

// Notifications v2 personal preferences (docs/contracts/notifications-v2.md D1–D5, D23,
// §Preferences) through the production router and the real gates: GET returns the
// caller tree's full catalog (types × channels, default / enabled / mandatory_locked,
// email_deliverable); PUT is partial, atomic, idempotent, stores an explicit row per
// entry, refuses locked pairs with 422 notification_preference_locked and writes
// nothing on any error. Same disposable draft_test_mig_* harness as
// notifications_read_integration_test.go.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

const (
	notifPrefsMemberPath    = "/v2/me/company/notifications/preferences"
	notifPrefsCandidatePath = "/v2/me/notifications/preferences"
)

// prefRow is one row of the contract's per-type table (§Preferences): the expected
// catalog is written from the contract, not from the domain table.
type prefRow struct {
	typ, kind    string
	inApp, email bool // defaults
}

var prefMemberTable = []prefRow{
	{"application_received", "operational", true, false},
	{"delivery_due_soon", "operational", true, false},
	{"delivery_overdue", "mandatory", true, true},
	{"assignment_deadline_due_soon", "operational", true, false},
	{"assignment_deadline_overdue", "mandatory", true, true},
	{"vacancy_assigned", "mandatory", true, true},
	{"vacancy_reassigned", "mandatory", true, true},
	{"vacancy_unassigned", "mandatory", true, true},
	{"vacancy_team_added", "mandatory", true, true},
	{"psychometric_completed", "operational", true, false},
	{"psychometric_pending", "operational", true, false},
}

var prefCandidateTable = []prefRow{
	{"candidate_status_changed", "operational", true, true},
	{"candidate_message_received", "operational", true, true},
	{"candidate_test_pending", "operational", true, true},
}

// prefWant renders the expected GET body; enabled overrides "type/channel".
func prefWant(deliverable bool, table []prefRow, enabled map[string]bool) string {
	type state struct {
		Default         bool `json:"default"`
		Enabled         bool `json:"enabled"`
		MandatoryLocked bool `json:"mandatory_locked"`
	}
	type item struct {
		Type     string           `json:"type"`
		Kind     string           `json:"kind"`
		Channels map[string]state `json:"channels"`
	}
	items := make([]item, 0, len(table))
	for _, r := range table {
		locked := r.kind == "mandatory"
		ch := map[string]state{}
		for name, def := range map[string]bool{"in_app": r.inApp, "email": r.email} {
			s := state{Default: def, Enabled: def, MandatoryLocked: locked}
			if v, ok := enabled[r.typ+"/"+name]; ok {
				s.Enabled = v
			}
			ch[name] = s
		}
		items = append(items, item{r.typ, r.kind, ch})
	}
	raw, _ := json.Marshal(map[string]any{"channels": []string{"in_app", "email"}, "email_deliverable": deliverable, "items": items})
	return string(raw)
}

func (w *notifWorld) put(t *testing.T, u notifUser, path, body string) notifResponse {
	t.Helper()
	req, err := http.NewRequest(http.MethodPut, w.server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if u.sub != "" {
		req.Header.Set("Authorization", "Bearer "+w.signer.validToken(t, u.sub))
	}
	resp, err := w.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return notifResponse{status: resp.StatusCode, header: resp.Header.Clone(), body: raw}
}

// wantPrefs asserts a 200 no-store catalog response.
func wantPrefs(t *testing.T, what string, r notifResponse, want string) {
	t.Helper()
	if r.status != http.StatusOK || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("%s: status=%d cache=%q body=%s", what, r.status, r.header.Get("Cache-Control"), r.body)
	}
	notifJSONEqual(t, r.body, want)
}

// storedPref is one notification_preferences row.
type storedPref struct {
	company string // "" = NULL
	typ     string
	channel string
	enabled bool
	source  string
	updated time.Time
}

// prefRows returns the user's stored rows ordered by company, type, channel.
func (w *notifWorld) prefRows(t *testing.T, user uuid.UUID) []storedPref {
	t.Helper()
	rows, err := w.pool.Query(context.Background(), `SELECT COALESCE(company_id::text,''), type, channel, enabled, source, updated_at
		FROM notification_preferences WHERE user_id=$1 ORDER BY 1, 2, 3`, user)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []storedPref
	for rows.Next() {
		var p storedPref
		if err := rows.Scan(&p.company, &p.typ, &p.channel, &p.enabled, &p.source, &p.updated); err != nil {
			t.Fatal(err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func prefSummary(rows []storedPref) string {
	parts := make([]string, len(rows))
	for i, p := range rows {
		company := "NULL"
		if p.company != "" {
			company = "C"
		}
		parts[i] = fmt.Sprintf("%s %s/%s=%v %s", company, p.typ, p.channel, p.enabled, p.source)
	}
	return strings.Join(parts, "; ")
}

func (w *notifWorld) prefCount(t *testing.T) int {
	t.Helper()
	var n int
	if err := w.pool.QueryRow(context.Background(), `SELECT count(*) FROM notification_preferences`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestNotificationsPreferences_MemberCatalogPartialIdempotentPut(t *testing.T) {
	w := newNotifWorld(t)

	r := w.get(t, w.recruiter, notifPrefsMemberPath)
	t.Logf("GET %s → %s", notifPrefsMemberPath, r.body)
	wantPrefs(t, "member defaults", r, prefWant(true, prefMemberTable, nil))

	body := `{"preferences":[{"type":"application_received","channel":"email","enabled":true},{"type":"psychometric_pending","channel":"in_app","enabled":false}]}`
	changed := map[string]bool{"application_received/email": true, "psychometric_pending/in_app": false}
	first := w.put(t, w.recruiter, notifPrefsMemberPath, body)
	wantPrefs(t, "partial put", first, prefWant(true, prefMemberTable, changed))
	rows := w.prefRows(t, w.recruiter.id)
	if got := prefSummary(rows); got != "C application_received/email=true settings; C psychometric_pending/in_app=false settings" {
		t.Fatalf("stored = %s", got)
	}
	if rows[0].company != w.company.String() {
		t.Fatalf("company = %s, want %s", rows[0].company, w.company)
	}
	// Idempotent: the same body again leaves the same state and the same response.
	again := w.put(t, w.recruiter, notifPrefsMemberPath, body)
	wantPrefs(t, "repeated put", again, prefWant(true, prefMemberTable, changed))
	if got := prefSummary(w.prefRows(t, w.recruiter.id)); got != prefSummary(rows) {
		t.Fatalf("after repeat = %s", got)
	}
	// Partial: only the listed pairs change; an entry equal to the default is still
	// stored as an explicit choice (D4); a pair can go back to off.
	r = w.put(t, w.recruiter, notifPrefsMemberPath, `{"preferences":[{"type":"delivery_due_soon","channel":"email","enabled":false},{"type":"application_received","channel":"email","enabled":false}]}`)
	changed = map[string]bool{"application_received/email": false, "psychometric_pending/in_app": false}
	wantPrefs(t, "default-valued put", r, prefWant(true, prefMemberTable, changed))
	rows = w.prefRows(t, w.recruiter.id)
	if got := prefSummary(rows); got != "C application_received/email=false settings; C delivery_due_soon/email=false settings; C psychometric_pending/in_app=false settings" {
		t.Fatalf("stored = %s", got)
	}
	// A previous unsubscribe row becomes a settings choice when the user writes it.
	w.exec(t, `UPDATE notification_preferences SET source='unsubscribe', updated_at=now()-interval '1 day' WHERE user_id=$1 AND type='psychometric_pending'`, w.recruiter.id)
	before := time.Now().Add(-time.Minute)
	w.put(t, w.recruiter, notifPrefsMemberPath, `{"preferences":[{"type":"psychometric_pending","channel":"in_app","enabled":true}]}`)
	for _, p := range w.prefRows(t, w.recruiter.id) {
		if p.typ == "psychometric_pending" && (p.source != "settings" || !p.enabled || p.updated.Before(before)) {
			t.Fatalf("rewritten row = %+v", p)
		}
	}
	// The PUT response is the GET body.
	delete(changed, "psychometric_pending/in_app")
	wantPrefs(t, "get after put", w.get(t, w.recruiter, notifPrefsMemberPath), prefWant(true, prefMemberTable, changed))
	// Not audited (D5).
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}

func TestNotificationsPreferences_CandidateCatalogAndEmailDeliverable(t *testing.T) {
	w := newNotifWorld(t)

	r := w.get(t, w.candidate, notifPrefsCandidatePath)
	t.Logf("GET %s → %s", notifPrefsCandidatePath, r.body)
	wantPrefs(t, "candidate defaults", r, prefWant(true, prefCandidateTable, nil))

	r = w.put(t, w.candidate, notifPrefsCandidatePath, `{"preferences":[{"type":"candidate_test_pending","channel":"email","enabled":false},{"type":"candidate_message_received","channel":"in_app","enabled":true}]}`)
	changed := map[string]bool{"candidate_test_pending/email": false}
	wantPrefs(t, "candidate put", r, prefWant(true, prefCandidateTable, changed))
	if got := prefSummary(w.prefRows(t, w.candidate.id)); got != "NULL candidate_message_received/in_app=true settings; NULL candidate_test_pending/email=false settings" {
		t.Fatalf("stored = %s", got)
	}

	// email_deliverable: false when the normalized account address is suppressed,
	// true again once it is not; the address is never returned.
	address := "Cecilia.Pref." + uuid.NewString()[:8] + "@Example.test"
	w.exec(t, `UPDATE users SET email=$2 WHERE id=$1`, w.candidate.id, "  "+address+" ")
	w.exec(t, `INSERT INTO email_suppressions(address,reason) VALUES($1,'bounce')`, strings.ToLower(address))
	r = w.get(t, w.candidate, notifPrefsCandidatePath)
	wantPrefs(t, "suppressed", r, prefWant(false, prefCandidateTable, changed))
	if strings.Contains(strings.ToLower(string(r.body)), strings.ToLower(address)) || strings.Contains(string(r.body), "bounce") {
		t.Fatalf("body leaks the address or reason: %s", r.body)
	}
	wantPrefs(t, "suppressed put", w.put(t, w.candidate, notifPrefsCandidatePath, `{"preferences":[{"type":"candidate_test_pending","channel":"email","enabled":false}]}`),
		prefWant(false, prefCandidateTable, changed))
	w.exec(t, `DELETE FROM email_suppressions`)
	wantPrefs(t, "unsuppressed", w.get(t, w.candidate, notifPrefsCandidatePath), prefWant(true, prefCandidateTable, changed))
	// Same rule on the member tree. (An empty address cannot reach the handler: the
	// gates refuse a user whose stored email is not a valid address.)
	w.exec(t, `INSERT INTO email_suppressions(address,reason) SELECT lower(btrim(email)),'manual' FROM users WHERE id=$1`, w.recruiter.id)
	wantPrefs(t, "suppressed member", w.get(t, w.recruiter, notifPrefsMemberPath), prefWant(false, prefMemberTable, nil))
	wantPrefs(t, "colleague unaffected", w.get(t, w.colleague, notifPrefsMemberPath), prefWant(true, prefMemberTable, nil))
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}

func TestNotificationsPreferences_LockedPairsAreRefusedAtomically(t *testing.T) {
	w := newNotifWorld(t)
	const locked = `{"error":"notification preference locked","code":"notification_preference_locked","data":{"types":["delivery_overdue","vacancy_assigned"]}}`
	// Valid entries before and after the locked ones are not written either; the
	// types are listed once, in table order, whatever enabled says.
	body := `{"preferences":[{"type":"application_received","channel":"email","enabled":true},{"type":"vacancy_assigned","channel":"email","enabled":false},` +
		`{"type":"delivery_overdue","channel":"in_app","enabled":true},{"type":"vacancy_assigned","channel":"in_app","enabled":true},{"type":"psychometric_pending","channel":"in_app","enabled":false}]}`
	r := w.put(t, w.recruiter, notifPrefsMemberPath, body)
	t.Logf("PUT %s (locked) → %d %s", notifPrefsMemberPath, r.status, r.body)
	if r.status != http.StatusUnprocessableEntity || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
		t.Fatalf("locked: %d %q %s", r.status, r.header.Get("Cache-Control"), r.body)
	}
	notifJSONEqual(t, r.body, locked)
	// A single locked entry with enabled true is refused too.
	r = w.put(t, w.stakeholder, notifPrefsMemberPath, `{"preferences":[{"type":"vacancy_team_added","channel":"email","enabled":true}]}`)
	notifJSONEqual(t, r.body, `{"error":"notification preference locked","code":"notification_preference_locked","data":{"types":["vacancy_team_added"]}}`)
	if r.status != http.StatusUnprocessableEntity {
		t.Fatalf("single locked: %d", r.status)
	}
	if n := w.prefCount(t); n != 0 {
		t.Fatalf("rows after locked PUTs = %d, want 0", n)
	}
	wantPrefs(t, "unchanged", w.get(t, w.recruiter, notifPrefsMemberPath), prefWant(true, prefMemberTable, nil))
}

func TestNotificationsPreferences_ValidationErrors(t *testing.T) {
	w := newNotifWorld(t)
	entry := func(typ, channel, enabled string) string {
		return `{"type":"` + typ + `","channel":"` + channel + `","enabled":` + enabled + `}`
	}
	list := func(entries ...string) string { return `{"preferences":[` + strings.Join(entries, ",") + `]}` }
	validation := func(fields ...string) string {
		out := make([]string, 0, len(fields))
		for _, f := range fields {
			name, code, _ := strings.Cut(f, "=")
			out = append(out, `{"field":"`+name+`","code":"`+code+`"}`)
		}
		return `{"error":"validation failed","code":"validation_error","fields":[` + strings.Join(out, ",") + `]}`
	}
	const invalidRequest = `{"error":"invalid request","code":"invalid_request"}`
	many := make([]string, 0, 29)
	for i := 0; i < 29; i++ {
		many = append(many, entry("application_received", "email", "true"))
	}
	for _, tc := range []struct {
		name, path, body string
		status           int
		want             string
	}{
		{"missing preferences", notifPrefsMemberPath, `{}`, 400, validation("preferences=required")},
		{"null preferences", notifPrefsMemberPath, `{"preferences":null}`, 400, validation("preferences=required")},
		{"empty preferences", notifPrefsMemberPath, `{"preferences":[]}`, 400, validation("preferences=empty")},
		{"over 28 entries", notifPrefsMemberPath, list(many...), 400, validation("preferences=too_many")},
		{"unknown type", notifPrefsMemberPath, list(entry("team_added", "email", "true")), 400, validation("preferences[0].type=invalid")},
		{"candidate type on member tree", notifPrefsMemberPath, list(entry("application_received", "email", "true"), entry("candidate_status_changed", "email", "true")), 400, validation("preferences[1].type=invalid")},
		{"member type on candidate tree", notifPrefsCandidatePath, list(entry("application_received", "email", "true")), 400, validation("preferences[0].type=invalid")},
		{"mandatory type on candidate tree", notifPrefsCandidatePath, list(entry("delivery_overdue", "email", "true")), 400, validation("preferences[0].type=invalid")},
		{"unknown channel", notifPrefsMemberPath, list(entry("application_received", "sms", "true")), 400, validation("preferences[0].channel=invalid")},
		{"duplicate pair", notifPrefsMemberPath, list(entry("application_received", "email", "true"), entry("application_received", "in_app", "true"), entry("application_received", "email", "false")), 400, validation("preferences[2]=duplicate")},
		{"missing enabled", notifPrefsMemberPath, list(`{"type":"application_received","channel":"email"}`), 400, validation("preferences[0].enabled=required")},
		{"null enabled", notifPrefsMemberPath, list(entry("application_received", "email", "null")), 400, validation("preferences[0].enabled=required")},
		{"string enabled", notifPrefsMemberPath, list(entry("application_received", "email", `"true"`)), 400, validation("preferences[0].enabled=invalid")},
		{"numeric enabled", notifPrefsCandidatePath, list(entry("candidate_test_pending", "email", "1")), 400, validation("preferences[0].enabled=invalid")},
		{"missing type and channel", notifPrefsMemberPath, list(`{"enabled":true}`), 400, validation("preferences[0].channel=required", "preferences[0].type=required")},
		{"non-string type", notifPrefsMemberPath, list(`{"type":7,"channel":"email","enabled":true}`), 400, validation("preferences[0].type=invalid")},
		// Validation runs over the whole list first: an invalid entry wins over a locked one.
		{"invalid and locked", notifPrefsMemberPath, list(entry("delivery_overdue", "email", "true"), entry("application_received", "fax", "true")), 400, validation("preferences[1].channel=invalid")},
		{"unknown member", notifPrefsMemberPath, `{"preferences":[` + entry("application_received", "email", "true") + `],"extra":1}`, 400, invalidRequest},
		{"unknown entry member", notifPrefsMemberPath, list(`{"type":"application_received","channel":"email","enabled":true,"source":"unsubscribe"}`), 400, invalidRequest},
		{"preferences not a list", notifPrefsMemberPath, `{"preferences":{"type":"application_received"}}`, 400, invalidRequest},
		{"entry not an object", notifPrefsCandidatePath, `{"preferences":["candidate_test_pending"]}`, 400, invalidRequest},
		{"malformed", notifPrefsMemberPath, `{"preferences":[`, 400, invalidRequest},
		{"empty body", notifPrefsMemberPath, ``, 400, invalidRequest},
		{"trailing data", notifPrefsMemberPath, list(entry("application_received", "email", "true")) + `{}`, 400, invalidRequest},
		{"over the size cap", notifPrefsMemberPath, `{"preferences":[{"type":"` + strings.Repeat("x", 70_000) + `"}]}`, 413, `{"error":"payload too large","code":"payload_too_large"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			u := w.recruiter
			if tc.path == notifPrefsCandidatePath {
				u = w.candidate
			}
			r := w.put(t, u, tc.path, tc.body)
			if r.status != tc.status {
				t.Fatalf("status = %d, want %d: %s", r.status, tc.status, r.body)
			}
			notifJSONEqual(t, r.body, tc.want)
		})
	}
	if n := w.prefCount(t); n != 0 {
		t.Fatalf("rows after invalid PUTs = %d, want 0", n)
	}
	// The whole member tree in one body (22 valid pairs, within the limit) is refused
	// as a whole for its six mandatory types.
	all := make([]string, 0, 22)
	for _, row := range prefMemberTable {
		for _, ch := range []string{"in_app", "email"} {
			all = append(all, entry(row.typ, ch, "true"))
		}
	}
	r := w.put(t, w.recruiter, notifPrefsMemberPath, list(all...))
	if r.status != http.StatusUnprocessableEntity {
		t.Fatalf("whole tree = %d %s, want 422", r.status, r.body)
	}
	notifJSONEqual(t, r.body, `{"error":"notification preference locked","code":"notification_preference_locked","data":{"types":["delivery_overdue","assignment_deadline_overdue","vacancy_assigned","vacancy_reassigned","vacancy_unassigned","vacancy_team_added"]}}`)
	if n := w.prefCount(t); n != 0 {
		t.Fatalf("rows after the whole-tree PUT = %d, want 0", n)
	}
}

func TestNotificationsPreferences_ScopeIsolation(t *testing.T) {
	w := newNotifWorld(t)
	w.put(t, w.recruiter, notifPrefsMemberPath, `{"preferences":[{"type":"application_received","channel":"email","enabled":true}]}`)
	w.put(t, w.candidate, notifPrefsCandidatePath, `{"preferences":[{"type":"candidate_status_changed","channel":"email","enabled":false}]}`)
	mine := map[string]bool{"application_received/email": true}

	// Other users of the same company, another company's member and another
	// candidate see their own defaults.
	for name, u := range map[string]notifUser{"colleague": w.colleague, "owner": w.owner, "outsider": w.outsider} {
		wantPrefs(t, name, w.get(t, u, notifPrefsMemberPath), prefWant(true, prefMemberTable, nil))
	}
	wantPrefs(t, "other candidate", w.get(t, w.candidates[0], notifPrefsCandidatePath), prefWant(true, prefCandidateTable, nil))
	// The stakeholder gets the member catalog (D23) and can write it.
	wantPrefs(t, "stakeholder", w.get(t, w.stakeholder, notifPrefsMemberPath), prefWant(true, prefMemberTable, nil))
	wantPrefs(t, "stakeholder put", w.put(t, w.stakeholder, notifPrefsMemberPath, `{"preferences":[{"type":"psychometric_completed","channel":"email","enabled":true}]}`),
		prefWant(true, prefMemberTable, map[string]bool{"psychometric_completed/email": true}))

	// Preferences are keyed by company (D1): a row of the recruiter in the other
	// company is invisible here, and becomes the one that applies after the
	// membership moves there (the first company's row no longer does).
	w.exec(t, `INSERT INTO notification_preferences(user_id,company_id,type,channel,enabled,source) VALUES($1,$2,'psychometric_pending','in_app',false,'settings')`, w.recruiter.id, w.other)
	wantPrefs(t, "recruiter here", w.get(t, w.recruiter, notifPrefsMemberPath), prefWant(true, prefMemberTable, mine))
	w.exec(t, `UPDATE company_members SET company_id=$2 WHERE user_id=$1`, w.recruiter.id, w.other)
	wantPrefs(t, "recruiter moved", w.get(t, w.recruiter, notifPrefsMemberPath), prefWant(true, prefMemberTable, map[string]bool{"psychometric_pending/in_app": false}))
	w.put(t, w.recruiter, notifPrefsMemberPath, `{"preferences":[{"type":"application_received","channel":"in_app","enabled":false}]}`)
	var here, there int
	if err := w.pool.QueryRow(context.Background(), `SELECT count(*) FILTER (WHERE company_id=$2), count(*) FILTER (WHERE company_id=$3) FROM notification_preferences WHERE user_id=$1`,
		w.recruiter.id, w.company, w.other).Scan(&here, &there); err != nil || here != 1 || there != 2 {
		t.Fatalf("recruiter rows here=%d there=%d (%v), want 1/2", here, there, err)
	}

	// Member vs candidate: the candidate's choice is not on any member catalog and
	// the member rows are not on the candidate's.
	wantPrefs(t, "candidate own", w.get(t, w.candidate, notifPrefsCandidatePath), prefWant(true, prefCandidateTable, map[string]bool{"candidate_status_changed/email": false}))
	var cand []string
	for _, p := range w.prefRows(t, w.candidate.id) {
		cand = append(cand, p.typ+"/"+p.channel+"/"+p.company)
	}
	sort.Strings(cand)
	if strings.Join(cand, ",") != "candidate_status_changed/email/" {
		t.Fatalf("candidate rows = %v", cand)
	}

	// Gates.
	for _, path := range []string{notifPrefsMemberPath, notifPrefsCandidatePath} {
		for _, call := range []func(notifUser) notifResponse{
			func(u notifUser) notifResponse { return w.get(t, u, path) },
			func(u notifUser) notifResponse { return w.put(t, u, path, `{"preferences":[]}`) },
		} {
			if r := call(notifUser{}); r.status != http.StatusUnauthorized || !strings.Contains(r.header.Get("Cache-Control"), "no-store") {
				t.Fatalf("%s anonymous: %d %q", path, r.status, r.header.Get("Cache-Control"))
			}
			if path == notifPrefsMemberPath {
				if r := call(w.candidate); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"forbidden"`) {
					t.Fatalf("%s candidate: %d %s", path, r.status, r.body)
				}
				continue
			}
			if r := call(w.colleague); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"wrong_role"`) {
				t.Fatalf("%s member: %d %s", path, r.status, r.body)
			}
			if r := call(notifUser{sub: "notif-unknown-" + uuid.NewString()}); r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"account_required"`) {
				t.Fatalf("%s no account: %d %s", path, r.status, r.body)
			}
		}
	}
	w.exec(t, `UPDATE companies SET deleted_at=now() WHERE id=$1`, w.company)
	for _, r := range []notifResponse{
		w.get(t, w.colleague, notifPrefsMemberPath),
		w.put(t, w.colleague, notifPrefsMemberPath, `{"preferences":[{"type":"application_received","channel":"email","enabled":true}]}`),
	} {
		if r.status != http.StatusForbidden || !strings.Contains(string(r.body), `"company_inactive"`) {
			t.Fatalf("deleted company: %d %s", r.status, r.body)
		}
	}
	if n := w.audits(t); n != 0 {
		t.Fatalf("audit rows = %d, want 0", n)
	}
}
