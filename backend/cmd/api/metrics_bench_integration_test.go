//go:build integration

package main

import (
	"context"
	"fmt"
	"math"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	auditpostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	metricsapp "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/application"
	metricspostgres "github.com/aldrichcode45/peopleflow-vacantes/internal/features/metrics/infrastructure/postgres"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/tools/metricsdemo"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Seeded benchmark of the metrics and company dashboard budgets
// (stakeholder-metrics-v2 §2, company-dashboard-v2 §4; T6 in
// odd/tasks/stakeholder-metrics-v2-backend.md). Opt-in, measurement only;
// results and the exact command live in backend/docs/metrics-benchmark.md:
//
//	METRICS_BENCH=1 DRAFT_TEST_DATABASE_URL=<draft_test DSN> \
//	  go test -tags=integration -count=1 -timeout 30m -run '^TestMetricsBench' -v ./cmd/api/
//
// METRICS_BENCH_N sets the runs per measurement (default 30);
// METRICS_BENCH_KEEP=1 keeps the two seeded companies afterwards.

// benchNow is pinned so the seed and every figure are repeatable: a Thursday,
// 07:00 in Mexico City, so hours of cold-run clock bumps stay on the same day.
var benchNow = time.Date(2026, 11, 5, 13, 0, 0, 0, time.UTC)

type benchStats struct {
	p50, p95, max time.Duration
	n             int
}

func benchSummarize(d []time.Duration) benchStats {
	s := slices.Clone(d)
	slices.Sort(s)
	at := func(q float64) time.Duration { return s[int(math.Ceil(q*float64(len(s))))-1] }
	return benchStats{at(0.50), at(0.95), s[len(s)-1], len(s)}
}

func benchMS(d time.Duration) string {
	return strconv.FormatFloat(float64(d)/float64(time.Millisecond), 'f', 1, 64)
}

func (s benchStats) row(name, mode string, budget time.Duration) string {
	verdict := "—"
	if budget > 0 {
		verdict = "pass"
		if s.p95 > budget {
			verdict = "**over**"
		}
	}
	b := "—"
	if budget > 0 {
		b = "≤ " + benchMS(budget)
	}
	return fmt.Sprintf("| %s | %s | %s | %s | %s | %s | %s |", name, mode, benchMS(s.p50), benchMS(s.p95), benchMS(s.max), b, verdict)
}

func benchRuns(t *testing.T) int {
	if raw := os.Getenv("METRICS_BENCH_N"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			t.Fatalf("METRICS_BENCH_N=%q", raw)
		}
		return n
	}
	return 30
}

// benchLoader measures a loader after one untimed run (pgx statement cache,
// shared buffers), so the first measurement is not charged for warming up.
func benchLoader(t *testing.T, n int, f func() error) benchStats {
	t.Helper()
	if err := f(); err != nil {
		t.Fatal(err)
	}
	return benchTime(t, n, f)
}

func benchTime(t *testing.T, n int, f func() error) benchStats {
	t.Helper()
	d := make([]time.Duration, 0, n)
	for i := 0; i < n; i++ {
		start := time.Now()
		if err := f(); err != nil {
			t.Fatal(err)
		}
		d = append(d, time.Since(start))
	}
	return benchSummarize(d)
}

// benchCounts are the data sizes of one company.
func benchCounts(t *testing.T, h *draftFlowHarness, company uuid.UUID) string {
	t.Helper()
	var out string
	if err := h.pool.QueryRow(context.Background(), `SELECT concat_ws(', ',
 'published vacancies '||(SELECT count(*) FROM vacancy_processes WHERE company_id=$1),
 'open now '||(SELECT count(*) FROM vacancy_processes WHERE company_id=$1 AND status<>'closed'),
 'drafts '||(SELECT count(*) FROM job_drafts WHERE company_id=$1),
 'participations '||(SELECT count(*) FROM process_participations p JOIN job_drafts d ON d.id=p.process_id WHERE d.company_id=$1),
 'active participations '||(SELECT count(*) FROM process_participations p JOIN job_drafts d ON d.id=p.process_id WHERE d.company_id=$1 AND p.discarded_at IS NULL),
 'stage history rows '||(SELECT count(*) FROM participation_stage_history h JOIN process_participations p ON p.id=h.participation_id JOIN job_drafts d ON d.id=p.process_id WHERE d.company_id=$1),
 'tramos '||(SELECT count(*) FROM vacancy_assignments WHERE company_id=$1),
 'functions '||(SELECT count(*) FROM vacancy_assignment_functions f JOIN job_drafts d ON d.id=f.draft_id WHERE d.company_id=$1),
 'closes '||(SELECT count(*) FROM vacancy_lifecycle_events e JOIN job_drafts d ON d.id=e.process_id WHERE d.company_id=$1 AND e.action='close'),
 'credits '||(SELECT count(*) FROM placement_credits WHERE company_id=$1),
 'reassignments '||(SELECT count(*) FROM vacancy_reassignments WHERE company_id=$1),
 'delivery configs '||(SELECT count(*) FROM job_draft_delivery_configs c JOIN job_drafts d ON d.id=c.draft_id WHERE d.company_id=$1),
 'fulfillments '||(SELECT count(*) FROM process_delivery_fulfillments f JOIN job_drafts d ON d.id=f.process_id WHERE d.company_id=$1),
 'recruiters '||(SELECT count(*) FROM company_members WHERE company_id=$1 AND role='recruiter'))`, company).Scan(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

// benchTableSizes are the whole database's row counts of the tables the
// loaders read (every company in draft_test, not only the two seeded).
func benchTableSizes(t *testing.T, h *draftFlowHarness) string {
	t.Helper()
	var parts []string
	for _, table := range []string{"job_drafts", "vacancy_processes", "process_participations", "participation_stage_history", "vacancy_assignments",
		"vacancy_assignment_functions", "vacancy_lifecycle_events", "placement_credits", "users"} {
		var n int64
		if err := h.pool.QueryRow(context.Background(), `SELECT count(*) FROM `+table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		parts = append(parts, fmt.Sprintf("%s %d", table, n))
	}
	return strings.Join(parts, ", ")
}

func TestMetricsBench_Budgets(t *testing.T) {
	if os.Getenv("METRICS_BENCH") != "1" {
		t.Skip("METRICS_BENCH=1 runs the seeded metrics benchmark (backend/docs/metrics-benchmark.md)")
	}
	ctx := context.Background()
	n := benchRuns(t)
	h := newDraftFlowHarness(t)
	db := metricsdemo.TestOnlyDatabase(draftFlowDBName)
	a, b := metricsdemo.RealisticBench("A"), metricsdemo.RealisticBench("B")
	for _, s := range []metricsdemo.Bench{a, b} {
		if _, err := metricsdemo.RemoveBench(ctx, h.pool, db, s); err != nil {
			t.Fatal(err)
		}
	}
	if os.Getenv("METRICS_BENCH_KEEP") != "1" {
		t.Cleanup(func() {
			for _, s := range []metricsdemo.Bench{a, b} {
				if _, err := metricsdemo.RemoveBench(ctx, h.pool, db, s); err != nil {
					t.Errorf("bench cleanup: %v", err)
				}
				if err := audittest.Delete(ctx, h.pool, `DELETE FROM audit_events WHERE company_id=$1`, s.CompanyID()); err != nil {
					t.Errorf("bench audit cleanup: %v", err)
				}
			}
		})
	}
	analyze := func() {
		t.Helper()
		start := time.Now()
		if _, err := h.pool.Exec(ctx, `ANALYZE`); err != nil {
			t.Fatal(err)
		}
		t.Logf("ANALYZE: %s", time.Since(start).Round(time.Millisecond))
	}
	seed := func(s metricsdemo.Bench) {
		t.Helper()
		start := time.Now()
		applied, err := metricsdemo.ApplyBench(ctx, h.pool, db, s, benchNow)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("seed %s: %d rows in %s", s.Key, applied.Statements, time.Since(start).Round(time.Millisecond))
		t.Logf("company %s: %s", s.Key, benchCounts(t, h, s.CompanyID()))
	}

	store := metricspostgres.NewStore(h.pool, auditpostgres.NewAuditEventRepository(), metricsStagesFrom, metricsPipelineFrom)
	period := benchPeriod(t)
	load := func(s metricsdemo.Bench, p metricsapp.Period) func() error {
		return func() error {
			_, err := store.Load(ctx, s.CompanyID(), metricsapp.Scope{Period: p})
			return err
		}
	}
	vacanciesOf := func(s metricsdemo.Bench) int {
		data, err := store.Load(ctx, s.CompanyID(), metricsapp.Scope{Period: period})
		if err != nil {
			t.Fatal(err)
		}
		return len(data.Vacancies)
	}

	// Isolation: company A alone, then with B of the same size.
	seed(a)
	analyze()
	aloneVacancies := vacanciesOf(a)
	alone := benchLoader(t, n, load(a, period))
	seed(b)
	analyze()
	if got := vacanciesOf(a); got != aloneVacancies {
		t.Fatalf("company A snapshot has %d vacancies with B seeded, %d alone", got, aloneVacancies)
	}
	t.Logf("database sizes: %s", benchTableSizes(t, h))
	var rows []string
	rows = append(rows, "### Loaders (Store, no HTTP, no cache)", "", "| Loader | Mode | p50 ms | p95 ms | max ms | Budget | Verdict |", "| --- | --- | --- | --- | --- | --- | --- |")
	since, _ := time.ParseInLocation(time.DateOnly, benchNow.In(benchZone(t)).AddDate(0, 0, -metricsapp.HistoryDays).Format(time.DateOnly), benchZone(t))
	rows = append(rows,
		alone.row("Store.Load A, 12 months (A alone)", "db", 0),
		benchLoader(t, n, load(a, period)).row("Store.Load A, 12 months (A+B)", "db", 0),
		benchLoader(t, n, load(b, period)).row("Store.Load B, 12 months (A+B)", "db", 0),
		benchLoader(t, n, load(a, period.Previous())).row("Store.Load A, previous 12 months", "db", 0),
		benchLoader(t, n, func() error { _, err := store.LoadPipeline(ctx, a.CompanyID()); return err }).row("Store.LoadPipeline A", "db", 0),
		benchLoader(t, n, func() error { _, err := store.LoadHistory(ctx, a.CompanyID(), since); return err }).row("Store.LoadHistory A (182 days)", "db", 0),
	)

	// Through the production router, as company A's owner.
	var offset atomic.Int64
	h.metrics.WithClock(func() time.Time { return benchNow.Add(time.Duration(offset.Load())) })
	t.Cleanup(func() { h.metrics.WithClock(time.Now) })
	ownerID, sub := a.Owner()
	token := h.actor(t, ownerID, sub).token
	get := func(path string) func() error {
		return func() error {
			resp, err := h.roundTrip("GET", path, "", token, nil)
			if err != nil {
				return err
			}
			if resp.status != 200 {
				return fmt.Errorf("GET %s: %d %s", path, resp.status, resp.body)
			}
			return nil
		}
	}
	// cold expires every cache (60 s TTL) before each run; warm reuses them.
	cold := func(path string) func() error {
		return func() error {
			offset.Add(int64(61 * time.Second))
			return get(path)()
		}
	}
	const coldSummary, warmBudget = 400 * time.Millisecond, 50 * time.Millisecond
	q := "?from=" + period.From + "&to=" + period.To
	type route struct {
		name, path string
		coldBudget time.Duration
	}
	metricsRoutes := []route{
		{"metrics summary (with previous period)", "/v2/me/company/metrics/summary" + q, coldSummary},
		{"metrics closures", "/v2/me/company/metrics/closures" + q, 0},
		{"metrics compliance", "/v2/me/company/metrics/compliance" + q, 0},
		{"metrics delays", "/v2/me/company/metrics/delays" + q, 0},
		{"metrics origin", "/v2/me/company/metrics/origin" + q, 0},
		{"metrics pipeline", "/v2/me/company/metrics/pipeline" + q, 0},
		{"metrics recruiters (cards)", "/v2/me/company/metrics/recruiters" + q, 0},
		{"list vacancies", "/v2/me/company/metrics/vacancies" + q + "&scope=assigned", 0},
		{"list deliveries", "/v2/me/company/metrics/deliveries" + q + "&result=on_time,late,overdue", 0},
		{"list placements (audited)", "/v2/me/company/metrics/placements" + q, 0},
		{"list reassignments", "/v2/me/company/metrics/reassignments" + q, 0},
		{"list candidates (audited)", "/v2/me/company/metrics/candidates" + q + "&stage_kind=screening,screening_ok,in_process,custom,retired", 0},
		{"list applications", "/v2/me/company/metrics/applications" + q, 0},
	}
	w := "?window=90"
	dashboardRoutes := []route{
		{"dashboard summary (window 90)", "/v2/me/company/dashboard/summary" + w, coldSummary},
		{"dashboard attention", "/v2/me/company/dashboard/attention" + w, 0},
		{"dashboard pipeline", "/v2/me/company/dashboard/pipeline" + w, 0},
		{"dashboard vacancies", "/v2/me/company/dashboard/vacancies" + w, 0},
		{"dashboard recent", "/v2/me/company/dashboard/recent" + w, 0},
		{"dashboard origin", "/v2/me/company/dashboard/origin" + w, 0},
		{"dashboard list candidates", "/v2/me/company/dashboard/lists/candidates" + w + "&in_process=true", 0},
		{"dashboard list deliveries", "/v2/me/company/dashboard/lists/deliveries" + w + "&state=overdue", 0},
		{"dashboard list vacancies", "/v2/me/company/dashboard/lists/vacancies" + w + "&status=published", 0},
		{"dashboard list applications", "/v2/me/company/dashboard/lists/applications" + w, 0},
	}
	for _, group := range []struct {
		title  string
		routes []route
	}{{"Metrics routes (owner of A, 12-month period)", metricsRoutes}, {"Company dashboard routes (owner of A)", dashboardRoutes}} {
		rows = append(rows, "", "### "+group.title, "", "| Route | Mode | p50 ms | p95 ms | max ms | Budget | Verdict |", "| --- | --- | --- | --- | --- | --- | --- |")
		for _, r := range group.routes {
			c := benchTime(t, n, cold(r.path))
			wm := benchTime(t, n, get(r.path))
			rows = append(rows, c.row(r.name, "cold", r.coldBudget), wm.row(r.name, "warm", warmBudget))
		}
	}
	t.Logf("runs per measurement: %d\n%s", n, strings.Join(rows, "\n"))

	benchExplain(t, h, a.CompanyID(), period, since)
}

func benchZone(t *testing.T) *time.Location {
	zone, err := time.LoadLocation(metricsapp.TimeZone)
	if err != nil {
		t.Fatal(err)
	}
	return zone
}

// benchPeriod is the twelve months the seed covers (as demoPeriod).
func benchPeriod(t *testing.T) metricsapp.Period {
	t.Helper()
	local := benchNow.In(benchZone(t))
	from := time.Date(local.Year(), local.Month()-11, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(local.Year(), local.Month()+1, 0, 0, 0, 0, 0, time.UTC)
	p, err := metricsapp.NewPeriod(from.Format(time.DateOnly), to.Format(time.DateOnly))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// The loaders' heaviest queries, copied from
// internal/features/metrics/infrastructure/postgres (store.go, pipeline.go,
// history.go) for EXPLAIN; keep them in step when those change.
const (
	benchCandidateName  = `COALESCE(cc.full_name, CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE u.full_name END, '')`
	benchCandidateJoins = ` LEFT JOIN users u ON u.id=p.candidate_id
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=$2
 LEFT JOIN company_candidate_corrections o ON o.company_id=$2 AND o.user_id=p.candidate_id`
	benchScopeSQL = `SELECT d.id FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id AND vp.company_id=d.company_id
 LEFT JOIN job_draft_delivery_configs c ON c.draft_id=d.id
 LEFT JOIN process_delivery_fulfillments f ON f.process_id=d.id
 WHERE d.company_id=$1 AND (
 EXISTS (SELECT 1 FROM vacancy_assignments a WHERE a.draft_id=d.id AND a.started_at < $3 AND (a.ended_at IS NULL OR a.ended_at >= $2))
 OR EXISTS (SELECT 1 FROM vacancy_lifecycle_events e WHERE e.process_id=d.id AND e.action='close' AND e.created_at >= $2 AND e.created_at < $3)
 OR COALESCE(f.commitment_date, c.commitment_date) BETWEEN $4::date AND $5::date
 OR EXISTS (SELECT 1 FROM placement_credits pc WHERE pc.process_id=d.id AND pc.company_id=$1 AND pc.hired_at >= $2 AND pc.hired_at < $3)
 OR EXISTS (SELECT 1 FROM vacancy_reassignments r WHERE r.draft_id=d.id AND r.performed_at >= $2 AND r.performed_at < $3)
 OR EXISTS (SELECT 1 FROM process_participations p WHERE p.process_id=d.id AND p.created_at >= $2 AND p.created_at < $3)) ORDER BY 1`
	benchVacanciesSQL = `SELECT d.id, COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',''), vp.published_at,
 d.requester_kind, d.requester_id, rq.name, mc.hiring_headcount,
 c.cutoff_stage_id, c.target_quantity, c.commitment_date::text,
 f.process_id IS NOT NULL, f.cutoff_stage_id, f.target, f.commitment_date::text,
 (f.candidates->(f.target-1)->>'reached_at')::timestamptz,
 (SELECT cc.previous_date::text FROM vacancy_commitment_changes cc WHERE cc.draft_id=d.id AND cc.previous_date IS NOT NULL ORDER BY cc.performed_at, cc.id LIMIT 1),
 (SELECT count(*) FROM vacancy_commitment_changes cc WHERE cc.draft_id=d.id),
 pc.configuration,
 (SELECT a.user_id FROM vacancy_assignment_functions fn JOIN vacancy_assignments a ON a.id=fn.assignment_id
  WHERE fn.draft_id=d.id AND fn.ended_at IS NULL AND fn.function='responsible')
 FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id
 LEFT JOIN job_draft_requesters rq ON rq.id=d.requester_id AND rq.company_id=d.company_id
 LEFT JOIN job_draft_management_configs mc ON mc.draft_id=d.id
 LEFT JOIN job_draft_delivery_configs c ON c.draft_id=d.id
 LEFT JOIN process_delivery_fulfillments f ON f.process_id=d.id
 LEFT JOIN job_draft_pipeline_configs pc ON pc.draft_id=d.id
 WHERE d.id=ANY($1) AND d.company_id=$2`
	benchClosesSQL = `SELECT e.process_id, e.created_at, e.reason,
 CASE WHEN EXISTS (SELECT 1 FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id AND t.performed_at <= e.created_at)
  THEN (SELECT t.new_date::text FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id AND t.performed_at <= e.created_at ORDER BY t.performed_at DESC, t.id DESC LIMIT 1)
  WHEN EXISTS (SELECT 1 FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id)
  THEN (SELECT t.previous_date::text FROM vacancy_close_target_changes t WHERE t.draft_id=e.process_id ORDER BY t.performed_at, t.id LIMIT 1)
  ELSE (SELECT mc.target_close_date::text FROM job_draft_management_configs mc WHERE mc.draft_id=e.process_id) END
 FROM vacancy_lifecycle_events e WHERE e.process_id=ANY($1) AND e.action='close' ORDER BY e.created_at, e.lifecycle_version`
	benchCreditsSQL = `SELECT pc.process_id, pc.id, pc.hired_at, pc.status, COALESCE(cc.id, u.id), ` + benchCandidateName + `,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',r.user_id,'kind',r.kind) ORDER BY r.user_id) FROM placement_credit_recipients r WHERE r.credit_id=pc.id),'[]'::jsonb)
 FROM placement_credits pc JOIN process_participations p ON p.id=pc.participation_id` + benchCandidateJoins + `
 WHERE pc.process_id=ANY($1) AND pc.company_id=$2 AND pc.status IN ('active','did_not_hold')
 ORDER BY pc.hired_at, pc.id`
	benchTramosSQL = `SELECT id, draft_id, user_id, started_at, ended_at FROM vacancy_assignments
 WHERE draft_id=ANY($1) AND company_id=$2 ORDER BY started_at, id`
	benchFunctionsSQL = `SELECT f.draft_id, f.assignment_id, a.user_id, f.function, f.started_at, f.ended_at
 FROM vacancy_assignment_functions f JOIN vacancy_assignments a ON a.id=f.assignment_id
 WHERE f.draft_id=ANY($1) ORDER BY f.started_at, f.id`
	benchOriginSQL = `SELECT process_id, origin_channel, count(*) FROM process_participations
 WHERE process_id=ANY($1) AND created_at >= $2 AND created_at < $3 GROUP BY 1, 2`
	benchEntriesSQL = `SELECT p.process_id, p.id, h.created_at, h.actor_id, h.actor_kind='recruiter', h.stage_id, h.event_kind='intake' AND p.source='manual'
 FROM unnest($1::uuid[], $2::uuid[]) k(draft_id, cutoff)
 JOIN process_participations p ON p.process_id=k.draft_id
 JOIN participation_stage_history h ON h.participation_id=p.id
 WHERE h.event_kind IN ('intake','move','recovery') AND (h.stage_id=k.cutoff OR (p.source='manual' AND h.event_kind='intake'))
 ORDER BY h.created_at, p.id, h.id`
	benchOpenVacanciesSQL = `SELECT d.id, COALESCE(convert_from(d.fields,'UTF8')::jsonb->'fields'->>'title',''),
 d.requester_kind, d.requester_id, rq.name, pc.configuration,
 (SELECT a.user_id FROM vacancy_assignment_functions fn JOIN vacancy_assignments a ON a.id=fn.assignment_id
  WHERE fn.draft_id=d.id AND fn.ended_at IS NULL AND fn.function='responsible')
 FROM job_drafts d JOIN vacancy_processes vp ON vp.id=d.id AND vp.company_id=d.company_id
 LEFT JOIN job_draft_requesters rq ON rq.id=d.requester_id AND rq.company_id=d.company_id
 LEFT JOIN job_draft_pipeline_configs pc ON pc.draft_id=d.id
 WHERE d.company_id=$1 AND vp.status<>'closed' AND vp.process_status<>'finished'
 ORDER BY d.id`
	benchParticipationsSQL = `SELECT p.process_id, p.id, COALESCE(cc.id, u.id), ` + benchCandidateName + `, p.stage_id, p.created_at,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',h.event_kind,'at',h.created_at) ORDER BY h.created_at, h.id)
  FROM participation_stage_history h WHERE h.participation_id=p.id AND h.stage_id=p.stage_id),'[]'::jsonb)
 FROM process_participations p` + benchCandidateJoins + `
 WHERE p.process_id=ANY($1) AND p.discarded_at IS NULL
 ORDER BY p.process_id, p.created_at, p.id`
	benchTracksSQL = `SELECT p.process_id, p.id, COALESCE(cc.id, u.id), ` + benchCandidateName + `, p.created_at, p.origin_channel, p.stage_id, p.discarded_at IS NOT NULL,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',h.event_kind,'stage_id',h.stage_id,'at',h.created_at) ORDER BY h.created_at, h.id)
  FROM participation_stage_history h WHERE h.participation_id=p.id AND h.event_kind IN ('intake','move','recovery','discard')),'[]'::jsonb)
 FROM process_participations p` + benchCandidateJoins + `
 WHERE p.process_id=ANY($1) AND (p.discarded_at IS NULL OR p.discarded_at >= $3 OR p.created_at >= $3)
 ORDER BY p.process_id, p.created_at, p.id`
	benchRecentSQL = `SELECT v.id, r.* FROM unnest($1::uuid[]) v(id) CROSS JOIN LATERAL (
 SELECT p.id, CASE WHEN p.company_candidate_id IS NULL THEN 'organic' ELSE 'manual' END,
 COALESCE(p.company_candidate_id,p.candidate_id),
 COALESCE(CASE WHEN o.corrections ? 'full_name' THEN o.corrections->>'full_name' ELSE COALESCE(cc.full_name,u.full_name) END,''),
 CASE WHEN o.corrections ? 'professional_title' THEN o.corrections->>'professional_title'
 ELSE CASE WHEN p.company_candidate_id IS NOT NULL THEN cc.professional_title ELSE p.profile_snapshot->>'professional_title' END END,
 p.stage_id, p.source, p.created_at, ad.id, COALESCE(ad.full_name,'')
 FROM process_participations p
 LEFT JOIN users u ON u.id=p.candidate_id
 LEFT JOIN company_candidates cc ON cc.id=p.company_candidate_id AND cc.company_id=$2
 LEFT JOIN company_candidate_corrections o ON p.company_candidate_id IS NULL AND o.user_id=p.candidate_id AND o.company_id=$2
 LEFT JOIN users ad ON ad.id=p.added_by AND p.source='manual'
 WHERE p.process_id=v.id ORDER BY p.created_at DESC, p.id DESC LIMIT 5) r`
	benchLifecycleSQL = `SELECT process_id, action, created_at FROM vacancy_lifecycle_events
 WHERE process_id=ANY($1) ORDER BY created_at, lifecycle_version`
)

var (
	benchSeqScan   = regexp.MustCompile(`Seq Scan on (\w+)`)
	benchIndexScan = regexp.MustCompile(`(?:Index Scan|Index Only Scan|Bitmap Index Scan)(?: Backward)? (?:using|on) (\w+)`)
	benchExecTime  = regexp.MustCompile(`Execution Time: ([\d.]+) ms`)
	benchIDArray   = regexp.MustCompile(`'\{[0-9a-f,-]{80,}\}'`)
)

// benchExplain logs EXPLAIN (ANALYZE, BUFFERS) of each query, then one
// summary line per query: execution time, sequential scans, indexes used.
func benchExplain(t *testing.T, h *draftFlowHarness, company uuid.UUID, p metricsapp.Period, since time.Time) {
	t.Helper()
	ctx := context.Background()
	collect := func(sql string, args ...any) []uuid.UUID {
		rows, err := h.pool.Query(ctx, sql, args...)
		if err != nil {
			t.Fatal(err)
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			t.Fatal(err)
		}
		return ids
	}
	scope := collect(benchScopeSQL, company, p.Start, p.End, p.From, p.To)
	open := collect(`SELECT id FROM vacancy_processes WHERE company_id=$1 AND status<>'closed' AND process_status<>'finished' ORDER BY id`, company)
	published := collect(`SELECT id FROM vacancy_processes WHERE company_id=$1 ORDER BY id`, company)
	var drafts, cutoffs []uuid.UUID
	rows, err := h.pool.Query(ctx, `SELECT c.draft_id, COALESCE(f.cutoff_stage_id, c.cutoff_stage_id) FROM job_draft_delivery_configs c
 LEFT JOIN process_delivery_fulfillments f ON f.process_id=c.draft_id WHERE c.draft_id=ANY($1) ORDER BY 1`, scope)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var d, c uuid.UUID
		if err := rows.Scan(&d, &c); err != nil {
			t.Fatal(err)
		}
		drafts, cutoffs = append(drafts, d), append(cutoffs, c)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	t.Logf("EXPLAIN inputs: scope %d vacancies, open %d, published %d, configured %d", len(scope), len(open), len(published), len(drafts))
	queries := []struct {
		name string
		sql  string
		args []any
	}{
		{"Load: scope", benchScopeSQL, []any{company, p.Start, p.End, p.From, p.To}},
		{"Load: vacancies", benchVacanciesSQL, []any{scope, company}},
		{"Load: tramos", benchTramosSQL, []any{scope, company}},
		{"Load: functions", benchFunctionsSQL, []any{scope}},
		{"Load: closes", benchClosesSQL, []any{scope}},
		{"Load: credits", benchCreditsSQL, []any{scope, company}},
		{"Load: origin", benchOriginSQL, []any{scope, p.Start, p.End}},
		{"Load: entries", benchEntriesSQL, []any{drafts, cutoffs}},
		{"LoadPipeline: open vacancies", benchOpenVacanciesSQL, []any{company}},
		{"LoadPipeline: participations", benchParticipationsSQL, []any{open, company}},
		{"LoadHistory: vacancies", benchVacanciesSQL, []any{published, company}},
		{"LoadHistory: lifecycle", benchLifecycleSQL, []any{published}},
		{"LoadHistory: tracks", benchTracksSQL, []any{published, company, since}},
		{"LoadHistory: recent", benchRecentSQL, []any{published, company}},
	}
	var summary []string
	for _, q := range queries {
		rows, err := h.pool.Query(ctx, `EXPLAIN (ANALYZE, BUFFERS) `+q.sql, q.args...)
		if err != nil {
			t.Fatalf("%s: %v", q.name, err)
		}
		lines, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			t.Fatalf("%s: %v", q.name, err)
		}
		plan := strings.Join(lines, "\n")
		t.Logf("EXPLAIN %s\n%s", q.name, benchIDArray.ReplaceAllStringFunc(plan, func(m string) string {
			return fmt.Sprintf("'{%d ids}'", strings.Count(m, ",")+1)
		}))
		seq, idx := map[string]bool{}, map[string]bool{}
		for _, m := range benchSeqScan.FindAllStringSubmatch(plan, -1) {
			seq[m[1]] = true
		}
		for _, m := range benchIndexScan.FindAllStringSubmatch(plan, -1) {
			idx[m[1]] = true
		}
		exec := "?"
		if m := benchExecTime.FindStringSubmatch(plan); m != nil {
			exec = m[1]
		}
		keys := func(m map[string]bool) string {
			out := make([]string, 0, len(m))
			for k := range m {
				out = append(out, k)
			}
			slices.Sort(out)
			if len(out) == 0 {
				return "—"
			}
			return strings.Join(out, ", ")
		}
		summary = append(summary, fmt.Sprintf("| %s | %s | %s | %s |", q.name, exec, keys(seq), keys(idx)))
	}
	t.Logf("EXPLAIN summary\n| Query | Execution ms | Seq Scan on | Indexes used |\n| --- | --- | --- | --- |\n%s", strings.Join(summary, "\n"))
}
