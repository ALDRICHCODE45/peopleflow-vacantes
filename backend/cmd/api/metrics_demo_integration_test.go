//go:build integration

package main

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	metricsapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/metricsdemo"
	"github.com/google/uuid"
)

// The dev-only demo seed (cmd/devseed-metrics-demo) over the isolated
// database: every board figure equals the total of its drill-down list
// through the production router, every section is non-trivial, apply is
// idempotent and remove leaves only the documented rows.

var demoDB = metricsdemo.TestOnlyDatabase(draftFlowDBName)

type demoAccounts struct {
	owner, stakeholder, recruiter uuid.UUID
	ownerSub                      string
	emails                        metricsdemo.Accounts
}

// newDemoAccounts registers three employer accounts in no company, as the
// user does in the app before apply, and removes the demo (and its audit
// rows, test database only) and the accounts afterwards.
func newDemoAccounts(t *testing.T, h *draftFlowHarness) *demoAccounts {
	t.Helper()
	ctx := context.Background()
	if _, err := metricsdemo.Remove(ctx, h.pool, demoDB); err != nil {
		t.Fatal(err)
	}
	a := &demoAccounts{}
	var ids []uuid.UUID
	for _, u := range []struct {
		id    *uuid.UUID
		email *string
		name  string
	}{{&a.owner, &a.emails.OwnerEmail, "Olga Dueña"}, {&a.stakeholder, &a.emails.StakeholderEmail, "Sara Interesada"}, {&a.recruiter, &a.emails.RecruiterEmail, "Rafa Reclutador"}} {
		id := uuid.Must(uuid.NewV7())
		sub := "demo-" + id.String()
		*u.id, *u.email = id, "Demo."+id.String()+"@Example.test"
		if u.id == &a.owner {
			a.ownerSub = sub
		}
		ids = append(ids, id)
		if _, err := h.pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,lower($3),$4,'recruiter')`, id, sub, *u.email, u.name); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		if _, err := metricsdemo.Remove(ctx, h.pool, demoDB); err != nil {
			t.Errorf("demo cleanup: %v", err)
		}
		if err := audittest.Delete(ctx, h.pool, `DELETE FROM audit_events WHERE company_id=$1`, metricsdemo.CompanyID()); err != nil {
			t.Errorf("demo audit cleanup: %v", err)
		}
		if _, err := h.pool.Exec(ctx, `DELETE FROM users WHERE id=ANY($1)`, ids); err != nil {
			t.Errorf("demo accounts cleanup: %v", err)
		}
	})
	return a
}

// demoPeriod is the twelve months the seed covers: the first day of the
// month eleven months back through the last day of the current month.
func demoPeriod(now time.Time) string {
	zone, _ := time.LoadLocation(metricsapp.TimeZone)
	local := now.In(zone)
	from := time.Date(local.Year(), local.Month()-11, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(local.Year(), local.Month()+1, 0, 0, 0, 0, 0, time.UTC)
	return "from=" + from.Format(time.DateOnly) + "&to=" + to.Format(time.DateOnly)
}

type demoReader struct {
	t     *testing.T
	h     *draftFlowHarness
	token string
}

func (r demoReader) get(path string) map[string]any {
	r.t.Helper()
	resp := r.h.do(r.t, "GET", "/v2/me/company/metrics/"+path, "", r.token, nil)
	if resp.status != 200 {
		r.t.Fatalf("GET %s: %d %s", path, resp.status, resp.body)
	}
	return draftFlowObject(r.t, resp.body)
}

func (r demoReader) total(kind, query string) int {
	r.t.Helper()
	return mxNum(r.get(kind + "?" + query)["total"])
}

type demoCheck struct {
	name   string
	figure int
	kind   string
	query  string
}

// demoFigures reads every board section for base and returns every figure
// by name after checking that each equals the total of its drill-down list
// (stakeholder-metrics-v2 §4 "Opens" tables).
func demoFigures(r demoReader, base string, withCards bool) map[string]int {
	r.t.Helper()
	summary := r.get("summary?" + base)
	closures := r.get("closures?" + base)
	compliance := r.get("compliance?" + base)
	delays := r.get("delays?" + base)
	pipeline := r.get("pipeline?" + base)
	origin := r.get("origin?" + base)
	checks := []demoCheck{
		// §4.1
		{"summary on-time rate", mxNum(mxAt2(summary, "headline", "on_time_rate", "current", "denominator")), "deliveries", "result=on_time,late,overdue"},
		{"summary on-time numerator", mxNum(mxAt2(summary, "headline", "on_time_rate", "current", "numerator")), "deliveries", "result=on_time"},
		{"summary assigned", mxNum(mxAt2(summary, "headline", "assigned", "current")), "vacancies", "scope=assigned"},
		{"summary median sample", mxNum(mxAt2(summary, "vacancies", "closed", "filled")), "vacancies", "scope=closed&close_reason=filled&sort=business_days_to_close"},
		{"summary placements", mxNum(mxAt2(summary, "headline", "placements", "current")), "placements", ""},
		{"summary did_not_hold", mxNum(mxAt2(summary, "placements", "did_not_hold")), "placements", "held=false"},
		{"summary reassignments", mxNum(mxAt2(summary, "headline", "reassignments", "current")), "reassignments", ""},
		// §4.5
		{"delays overdue", mxNum(mxAt2(delays, "overdue", "total")), "deliveries", "result=overdue&sort=business_days_overdue&order=desc"},
	}
	for _, reason := range []string{"filled", "cancelled", "other", "no_reason"} {
		checks = append(checks, demoCheck{"summary closed " + reason, mxNum(mxAt2(summary, "vacancies", "closed", reason)), "vacancies", "scope=closed&close_reason=" + reason})
	}
	for _, raw := range summary["on_time_by_month"].([]any) {
		m := raw.(map[string]any)
		checks = append(checks, demoCheck{"on-time month " + m["month"].(string), mxNum(mxAt2(m, "rate", "denominator")), "deliveries", "result=on_time,late,overdue&commitment_month=" + m["month"].(string)})
	}
	// §4.2
	for _, raw := range closures["closed_by_month"].([]any) {
		m := raw.(map[string]any)
		month := m["month"].(string)
		checks = append(checks,
			demoCheck{"closed " + month, mxNum(m["closed"]), "vacancies", "scope=closed&closed_month=" + month},
			demoCheck{"filled " + month, mxNum(m["filled"]), "vacancies", "scope=closed&closed_month=" + month + "&close_reason=filled"})
	}
	for status, n := range closures["delivery_status"].(map[string]any) {
		checks = append(checks, demoCheck{"delivery " + status, mxNum(n), "deliveries", "result=" + status})
	}
	// §4.3
	for bucket, n := range compliance["late_buckets"].(map[string]any) {
		checks = append(checks, demoCheck{"late bucket " + bucket, mxNum(n), "deliveries", "result=late&late_bucket=" + bucket})
	}
	// §4.5
	for target, n := range delays["closing_target"].(map[string]any) {
		checks = append(checks, demoCheck{"closing target " + target, mxNum(n), "vacancies", "scope=closed&close_reason=filled&closing_target=" + target})
	}
	for reason, n := range delays["reassignments_by_reason"].(map[string]any) {
		checks = append(checks, demoCheck{"reassignment " + reason, mxNum(n), "reassignments", "reason=" + reason})
	}
	// §4.4
	for _, raw := range pipeline["stages"].([]any) {
		st := raw.(map[string]any)
		kind := st["kind"].(string)
		checks = append(checks,
			demoCheck{"stage " + kind, mxNum(st["candidates"]), "candidates", "stage_kind=" + kind},
			demoCheck{"stalled " + kind, mxNum(st["stalled"]), "candidates", "stage_kind=" + kind + "&stalled=true"})
	}
	for _, raw := range pipeline["top_vacancies"].([]any) {
		v := raw.(map[string]any)
		id := mxAt2(v, "vacancy", "draft_id").(string)
		// The drill-down the metrics package defines, so the check follows it.
		checks = append(checks, demoCheck{"top vacancy " + mxAt2(v, "vacancy", "title").(string), mxNum(v["in_process"]), "candidates", "vacancy_id=" + id + "&" + metricsapp.InProcessQuery})
	}
	// §4.6 origin
	sum := 0
	for channel, n := range origin["by_channel"].(map[string]any) {
		checks = append(checks, demoCheck{"channel " + channel, mxNum(n), "applications", "channel=" + channel})
		sum += mxNum(n)
	}
	checks = append(checks, demoCheck{"applications", sum, "applications", ""})
	// §4.6 recruiter cards (the card's recruiter is the drill-down filter).
	if withCards {
		cards := r.get("recruiters?" + base + "&limit=100")
		if cards["next_cursor"] != nil {
			r.t.Fatal("more than 100 recruiter cards")
		}
		for _, raw := range cards["items"].([]any) {
			card := raw.(map[string]any)
			id := card["user_id"].(string)
			label := fmt.Sprintf("card %v", card["name"])
			if card["former_member"] == true {
				checks = append(checks, demoCheck{"former member cards", 1, "", ""})
			}
			d, p, re := card["delivery"].(map[string]any), card["placements"].(map[string]any), card["reassignments"].(map[string]any)
			checks = append(checks,
				demoCheck{label + " on-time M", mxNum(d["on_time"]) + mxNum(d["late"]) + mxNum(d["overdue"]), "deliveries", "attributed_to=" + id + "&result=on_time,late,overdue"},
				demoCheck{label + " on-time N", mxNum(d["on_time"]), "deliveries", "attributed_to=" + id + "&result=on_time"},
				demoCheck{label + " assigned", mxNum(mxAt2(card, "vacancies", "assigned")), "vacancies", "scope=assigned&recruiter_id=" + id},
				demoCheck{label + " placements", mxNum(p["direct"]) + mxNum(p["participant"]) + mxNum(p["shared"]), "placements", "recipient=" + id},
				demoCheck{label + " conversion M", mxNum(mxAt2(p, "conversion", "denominator")), "vacancies", "scope=closed_assigned&recruiter_id=" + id},
				demoCheck{label + " conversion N", mxNum(mxAt2(p, "conversion", "numerator")), "vacancies", "scope=closed_assigned&recruiter_id=" + id + "&credited_to=" + id},
				demoCheck{label + " received", mxNum(re["received"]), "reassignments", "recruiter_id=" + id + "&direction=received"},
				demoCheck{label + " lost", mxNum(re["lost"]), "reassignments", "recruiter_id=" + id + "&direction=lost"},
			)
		}
	}
	figures := map[string]int{}
	for _, c := range checks {
		if c.kind != "" && !(strings.Contains(c.query, "recruiter_id=") && strings.Contains(base, "recruiter_id=")) {
			query := base
			if c.query != "" {
				query += "&" + c.query
			}
			if got := r.total(c.kind, query); got != c.figure {
				r.t.Fatalf("%s (%s): figure %d, list total %d", c.name, base, c.figure, got)
			}
		}
		figures[c.name] += c.figure
	}
	return figures
}

// demoNonTrivial asserts every section of the board shows each of its cases
// the app can reach. delivery not_configured and stage retired cannot: a
// vacancy publishes only with a complete delivery configuration and only an
// empty stage can be retired (T13), so both stay 0 and are asserted so.
func demoNonTrivial(t *testing.T, f map[string]int, cards bool) {
	t.Helper()
	want := []string{"summary placements", "summary did_not_hold", "summary reassignments", "summary assigned",
		"summary closed filled", "summary closed cancelled", "summary closed other", "summary closed no_reason",
		"delivery on_time", "delivery late", "delivery overdue", "delivery pending",
		"late bucket up_to_2", "late bucket from_3_to_5", "late bucket over_5",
		"closing target on_time", "closing target late", "closing target no_target",
		"reassignment workload", "reassignment recruiter_departure", "reassignment performance", "reassignment client_request", "reassignment other",
		"channel portal", "channel careers_site", "channel manual", "channel unknown",
		"stage new", "stage screening", "stage screening_ok", "stage in_process", "stage custom", "stage placement"}
	if cards {
		want = append(want, "former member cards")
	}
	for _, name := range want {
		if f[name] == 0 {
			t.Errorf("%s is 0", name)
		}
	}
	for _, name := range []string{"delivery not_configured", "stage retired"} {
		if f[name] != 0 {
			t.Errorf("%s is %d, an unreachable state", name, f[name])
		}
	}
	stalled := 0
	for name, n := range f {
		if strings.HasPrefix(name, "stalled ") {
			stalled += n
		}
	}
	if stalled == 0 {
		t.Error("no stalled candidates")
	}
}

// demoRows counts the rows tied to the demo company (and the demo users).
func demoRows(t *testing.T, h *draftFlowHarness) map[string]int {
	t.Helper()
	out := map[string]int{}
	for name, query := range map[string]string{
		"companies":             `SELECT count(*) FROM companies WHERE id=$1`,
		"company_members":       `SELECT count(*) FROM company_members WHERE company_id=$1`,
		"job_drafts":            `SELECT count(*) FROM job_drafts WHERE company_id=$1`,
		"vacancy_processes":     `SELECT count(*) FROM vacancy_processes WHERE company_id=$1`,
		"vacancy_assignments":   `SELECT count(*) FROM vacancy_assignments WHERE company_id=$1`,
		"vacancy_reassignments": `SELECT count(*) FROM vacancy_reassignments WHERE company_id=$1`,
		"placement_credits":     `SELECT count(*) FROM placement_credits WHERE company_id=$1`,
		"job_draft_requesters":  `SELECT count(*) FROM job_draft_requesters WHERE company_id=$1`,
		"company_candidate_cvs": `SELECT count(*) FROM company_candidate_cvs WHERE company_id=$1`,
		"process_participations": `SELECT count(*) FROM process_participations p WHERE p.process_id IN (SELECT id FROM job_drafts WHERE company_id=$1)
 OR p.candidate_id=ANY($2)`,
		"participation_stage_history": `SELECT count(*) FROM participation_stage_history WHERE $1::uuid IS NOT NULL AND actor_id=ANY($2)
 OR participation_id IN (SELECT id FROM process_participations WHERE candidate_id=ANY($2))`,
		"users":                 `SELECT count(*) FROM users WHERE $1::uuid IS NOT NULL AND id=ANY($2)`,
		"candidate_cv_versions": `SELECT count(*) FROM candidate_cv_versions WHERE $1::uuid IS NOT NULL AND candidate_id=ANY($2)`,
		"audit_events":          `SELECT count(*) FROM audit_events WHERE company_id=$1`,
	} {
		var n int
		args := []any{metricsdemo.CompanyID(), metricsdemo.FictitiousUsers()}
		if !strings.Contains(query, "$2") {
			args = args[:1]
		}
		if err := h.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		out[name] = n
	}
	return out
}

// companyRows fingerprints another company's data.
func companyRows(t *testing.T, h *draftFlowHarness, company uuid.UUID) string {
	t.Helper()
	var out string
	if err := h.pool.QueryRow(context.Background(), `SELECT concat_ws('|',
 (SELECT count(*) FROM companies WHERE id=$1 AND deleted_at IS NULL),
 (SELECT count(*) FROM company_members WHERE company_id=$1),
 (SELECT count(*) FROM job_drafts WHERE company_id=$1),
 (SELECT count(*) FROM vacancy_processes WHERE company_id=$1),
 (SELECT count(*) FROM vacancy_assignments WHERE company_id=$1),
 (SELECT count(*) FROM job_draft_requesters WHERE company_id=$1),
 (SELECT count(*) FROM process_participations WHERE process_id IN (SELECT id FROM job_drafts WHERE company_id=$1)),
 (SELECT string_agg(md5(fields::text), ',' ORDER BY id) FROM job_drafts WHERE company_id=$1))`, company).Scan(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestMetricsDemo_FiguresEqualListsAndRemove(t *testing.T) {
	ctx := context.Background()
	h := newDraftFlowHarness(t)
	a := newDemoAccounts(t, h)
	// Another company with data, which apply and remove must leave alone.
	other := newMXFixture(t, h)
	other.member("recruiter", "Ajena")
	requester := other.requester("client", "Cliente Ajeno")
	draft := other.draft("Vacante Ajena", mxPtr(mxAt("2026-06-01T16:00:00Z")), mxPtr("client"), &requester, "with_responsible")
	other.stay(draft, other.ownerID, "responsible", mxAt("2026-06-01T16:00:00Z"), nil)
	otherBefore := companyRows(t, h, other.company.companyID)

	now := mxAt("2026-11-05T18:00:00Z") // a Thursday
	h.metrics.WithClock(func() time.Time { return now })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	applied, err := metricsdemo.Apply(ctx, h.pool, demoDB, a.emails, now)
	if err != nil {
		t.Fatal(err)
	}
	if applied.Removed.Total() != 0 {
		t.Fatalf("first apply replaced %d rows", applied.Removed.Total())
	}
	owner := demoReader{t: t, h: h, token: h.actor(t, a.owner, a.ownerSub).token}
	period := demoPeriod(now)
	figures := demoFigures(owner, period, true)
	demoNonTrivial(t, figures, true)
	for _, common := range []string{"&requester_kind=client", "&requester_kind=internal_area", "&requester_id=none",
		"&requester_kind=client&requester_id=" + metricsdemo.ID("requester", "banorte").String(), "&recruiter_id=" + a.recruiter.String()} {
		demoFigures(owner, period+common, !strings.Contains(common, "recruiter_id"))
	}
	demoLog(t, figures)

	// Apply again (a new router: no snapshot cache): the same figures.
	before := demoRows(t, h)
	h2 := newDraftFlowHarness(t)
	h2.metrics.WithClock(func() time.Time { return now })
	t.Cleanup(func() { h2.metrics.WithClock(time.Now) })
	again, err := metricsdemo.Apply(ctx, h2.pool, demoDB, a.emails, now)
	if err != nil {
		t.Fatal(err)
	}
	if again.Statements != applied.Statements || again.Removed.Total() == 0 {
		t.Fatalf("re-apply wrote %d rows (first %d), replaced %d", again.Statements, applied.Statements, again.Removed.Total())
	}
	after := demoRows(t, h)
	delete(before, "audit_events")
	delete(after, "audit_events")
	if !maps.Equal(before, after) {
		t.Fatalf("re-apply rows %v, first %v", after, before)
	}
	if got := demoFigures(demoReader{t: t, h: h2, token: owner.token}, period, true); !maps.Equal(got, figures) {
		t.Fatalf("re-apply figures differ:\n%v\n%v", got, figures)
	}

	// Re-applied on another day, the dates follow today (the real clock).
	h3 := newDraftFlowHarness(t)
	today := time.Now()
	if _, err := metricsdemo.Apply(ctx, h3.pool, demoDB, a.emails, today); err != nil {
		t.Fatal(err)
	}
	todayFigures := demoFigures(demoReader{t: t, h: h3, token: owner.token}, demoPeriod(today), true)
	demoNonTrivial(t, todayFigures, true)
	t.Logf("figures applied today (%s):", today.Format(time.DateOnly))
	demoLog(t, todayFigures)

	// Remove: nothing of the demo stays but its audit rows; the accounts stay
	// without membership; the other company is untouched.
	audit := demoRows(t, h)["audit_events"]
	if audit == 0 {
		t.Fatal("the audited lists wrote no audit rows")
	}
	removed, err := metricsdemo.Remove(ctx, h.pool, demoDB)
	if err != nil {
		t.Fatal(err)
	}
	if removed.Total() == 0 {
		t.Fatal("remove deleted nothing")
	}
	for table, n := range demoRows(t, h) {
		if (table == "audit_events" && n != audit) || (table != "audit_events" && n != 0) {
			t.Errorf("after remove %s: %d", table, n)
		}
	}
	var accounts, members int
	if err := h.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM users WHERE id=ANY($1) AND deleted_at IS NULL), (SELECT count(*) FROM company_members WHERE user_id=ANY($1))`,
		[]uuid.UUID{a.owner, a.stakeholder, a.recruiter}).Scan(&accounts, &members); err != nil {
		t.Fatal(err)
	}
	if accounts != 3 || members != 0 {
		t.Fatalf("accounts %d, memberships %d", accounts, members)
	}
	if got := companyRows(t, h, other.company.companyID); got != otherBefore {
		t.Fatalf("other company changed: %s → %s", otherBefore, got)
	}
	if again, err := metricsdemo.Remove(ctx, h.pool, demoDB); err != nil || again.Total() != 0 {
		t.Fatalf("second remove: %d rows, %v", again.Total(), err)
	}
}

// Apply refuses, writing nothing, an account that is missing, a candidate,
// a member of another company or the same account twice; and any database
// but the one it was told.
func TestMetricsDemo_RefusesAccounts(t *testing.T) {
	ctx := context.Background()
	h := newDraftFlowHarness(t)
	a := newDemoAccounts(t, h)
	other := newMXFixture(t, h)
	foreign, _ := other.member("recruiter", "Ajena")
	var foreignEmail string
	if err := h.pool.QueryRow(ctx, `SELECT email FROM users WHERE id=$1`, foreign).Scan(&foreignEmail); err != nil {
		t.Fatal(err)
	}
	candidate := uuid.Must(uuid.NewV7())
	if _, err := h.pool.Exec(ctx, `INSERT INTO users(id,cognito_sub,email,full_name,user_type) VALUES($1,$2,$3,'Cand','candidate')`, candidate, "demo-"+candidate.String(), candidate.String()+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = h.pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, candidate) })
	otherBefore := companyRows(t, h, other.company.companyID)
	for name, accounts := range map[string]metricsdemo.Accounts{
		"another company": {OwnerEmail: a.emails.OwnerEmail, StakeholderEmail: a.emails.StakeholderEmail, RecruiterEmail: foreignEmail},
		"candidate":       {OwnerEmail: a.emails.OwnerEmail, StakeholderEmail: candidate.String() + "@example.test", RecruiterEmail: a.emails.RecruiterEmail},
		"missing":         {OwnerEmail: "nadie@example.test", StakeholderEmail: a.emails.StakeholderEmail, RecruiterEmail: a.emails.RecruiterEmail},
		"same account":    {OwnerEmail: a.emails.OwnerEmail, StakeholderEmail: a.emails.OwnerEmail, RecruiterEmail: a.emails.RecruiterEmail},
	} {
		if _, err := metricsdemo.Apply(ctx, h.pool, demoDB, accounts, time.Now()); !errors.Is(err, metricsdemo.ErrAccount) {
			t.Errorf("%s: %v", name, err)
		}
		if rows := demoRows(t, h); rows["companies"]+rows["users"] != 0 {
			t.Fatalf("%s: wrote %v", name, rows)
		}
	}
	if _, err := metricsdemo.Apply(ctx, h.pool, metricsdemo.LocalDatabase(), a.emails, time.Now()); err == nil || !strings.Contains(err.Error(), "refusing database") {
		t.Fatalf("local database guard: %v", err)
	}
	if _, err := metricsdemo.Remove(ctx, h.pool, metricsdemo.LocalDatabase()); err == nil {
		t.Fatal("remove ran on the wrong database")
	}
	if got := companyRows(t, h, other.company.companyID); got != otherBefore {
		t.Fatalf("other company changed: %s → %s", otherBefore, got)
	}
}

// demoLog prints the seed's figures, one line per section (go test -v).
func demoLog(t *testing.T, f map[string]int) {
	t.Helper()
	for _, section := range []string{"summary", "delivery", "late bucket", "closing target", "reassignment", "channel", "stage", "stalled", "card", "top vacancy", "closed", "filled", "on-time month"} {
		var parts []string
		for name, n := range f {
			if strings.HasPrefix(name, section+" ") {
				parts = append(parts, fmt.Sprintf("%s=%d", strings.TrimPrefix(name, section+" "), n))
			}
		}
		sort.Strings(parts)
		t.Logf("%s: %s", section, strings.Join(parts, " "))
	}
}
