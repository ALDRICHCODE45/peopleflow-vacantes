package metricsdemo

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
)

// planDigest hashes every statement of a plan with its arguments, pointers
// dereferenced, so two plans with the same rows hash the same.
func planDigest(p *Plan) string {
	h := sha256.New()
	for _, s := range p.Statements {
		fmt.Fprintln(h, s.SQL)
		for _, a := range s.Args {
			v := reflect.ValueOf(a)
			for v.IsValid() && v.Kind() == reflect.Pointer {
				if v.IsNil() {
					break
				}
				v = v.Elem()
			}
			switch {
			case !v.IsValid() || (v.Kind() == reflect.Pointer && v.IsNil()):
				fmt.Fprintln(h, "<nil>")
			case v.Type() == reflect.TypeOf(time.Time{}):
				fmt.Fprintln(h, v.Interface().(time.Time).UTC().Format(time.RFC3339Nano))
			default:
				fmt.Fprintf(h, "%v\n", v.Interface())
			}
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

func benchTables(p *Plan) map[string]int {
	out := map[string]int{}
	for _, s := range p.Statements {
		out[tableOf(s.SQL)]++
	}
	return out
}

// The realistic seed has the contract's size (300 published vacancies, about
// 10k participations) and every kind of fact the loaders read.
func TestBuildBenchPlanRealisticSize(t *testing.T) {
	now := time.Date(2026, 11, 5, 13, 0, 0, 0, time.UTC)
	plan, err := BuildBenchPlan(now, RealisticBench("T"))
	if err != nil {
		t.Fatal(err)
	}
	n := benchTables(plan)
	t.Logf("%v", n)
	if n["vacancy_processes"] != 300 || n["job_drafts"] != 315 {
		t.Fatalf("vacancies %d, drafts %d", n["vacancy_processes"], n["job_drafts"])
	}
	if p := n["process_participations"]; p < 9_000 || p > 11_000 {
		t.Fatalf("participations %d", p)
	}
	for _, table := range []string{"vacancy_assignments", "vacancy_assignment_functions", "vacancy_lifecycle_events", "placement_credits",
		"placement_credit_recipients", "vacancy_reassignments", "job_draft_delivery_configs", "process_delivery_fulfillments",
		"vacancy_commitment_changes", "vacancy_close_target_changes", "job_draft_pipeline_configs", "company_candidate_cvs"} {
		if n[table] == 0 {
			t.Errorf("no %s rows", table)
		}
	}
	kinds := map[string]int{}
	for _, s := range plan.Statements {
		if tableOf(s.SQL) == "participation_stage_history" {
			kinds[s.Args[5].(string)]++
		}
	}
	for _, kind := range []string{"intake", "move", "discard", "recovery", "substate"} {
		if kinds[kind] == 0 {
			t.Errorf("no %s history rows (%v)", kind, kinds)
		}
	}
	again, err := BuildBenchPlan(now, RealisticBench("T"))
	if err != nil || planDigest(again) != planDigest(plan) {
		t.Fatalf("same key and now, different plan (%v)", err)
	}
}

// Two benchmark companies share no id with each other or with the demo.
func TestBuildBenchPlanKeysAreDisjoint(t *testing.T) {
	now := time.Date(2026, 11, 5, 13, 0, 0, 0, time.UTC)
	small := func(key string) Bench {
		return Bench{Key: key, Vacancies: 40, Drafts: 2, Participations: 600, Recruiters: 5, Candidates: 200}
	}
	demo, err := BuildPlan(now, testPeople)
	if err != nil {
		t.Fatal(err)
	}
	owner := map[uuid.UUID]string{}
	for name, plan := range map[string]*Plan{"demo": demo, "A": nil, "B": nil} {
		if plan == nil {
			if plan, err = BuildBenchPlan(now, small(name)); err != nil {
				t.Fatal(err)
			}
		}
		for _, s := range plan.Statements {
			for _, a := range s.Args {
				id, ok := a.(uuid.UUID)
				if !ok || id == testPeople.Owner || id == testPeople.Stakeholder || id == testPeople.Recruiter {
					continue
				}
				if other, dup := owner[id]; dup && other != name {
					t.Fatalf("%s and %s share %s (%s)", other, name, id, tableOf(s.SQL))
				}
				owner[id] = name
			}
		}
	}
	if small("A").CompanyID() == small("B").CompanyID() || small("A").CompanyID() == CompanyID() {
		t.Fatal("company ids collide")
	}
}

// The generated layout holds for every day of a year (nothing in the future,
// every credit with its tramo, at most one responsible).
func TestBuildBenchPlanHoldsForEveryDay(t *testing.T) {
	zone, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		t.Fatal(err)
	}
	spec := Bench{Key: "D", Vacancies: 60, Drafts: 2, Participations: 900, Recruiters: 6, Candidates: 300}
	for day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC); day.Year() < 2027; day = day.AddDate(0, 0, 1) {
		now := time.Date(day.Year(), day.Month(), day.Day(), 0, 30, 0, 0, zone)
		if _, err := BuildBenchPlan(now, spec); err != nil {
			t.Fatalf("%s: %v", now.Format(time.RFC3339), err)
		}
	}
}

// The benchmark builder shares the demo's primitives; the demo's own plan
// must stay byte-for-byte what it was before the benchmark existed.
func TestBuildPlanDigestUnchanged(t *testing.T) {
	plan, err := BuildPlan(time.Date(2026, 11, 8, 18, 0, 0, 0, time.UTC), testPeople)
	if err != nil {
		t.Fatal(err)
	}
	// Recorded on the demo code before the benchmark builder (5abe42b0),
	// re-recorded by T13: schema-2 drafts, candidate_cv_library rows and
	// only app-reachable states (delivery configured on every published
	// vacancy, v21's retired-stage candidate discarded).
	const want = "bc2a8b7b7e1b64b18f7c82cd55e7eff6fcc6133b831ceff65e7869848e2c7c36"
	if got := planDigest(plan); got != want {
		t.Fatalf("demo plan digest %s, want %s (the demo output changed)", got, want)
	}
}
