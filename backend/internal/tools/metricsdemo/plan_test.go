package metricsdemo

import (
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

var testPeople = People{
	Owner:       uuid.MustParse("00000000-0000-7000-8000-000000000001"),
	Stakeholder: uuid.MustParse("00000000-0000-7000-8000-000000000002"),
	Recruiter:   uuid.MustParse("00000000-0000-7000-8000-000000000003"),
	OwnerName:   "Dueña Real",
}

// The plan's own checks (no instant after now, each delivery result, late
// bucket and stalled flag as designed) hold for every "today" across leap
// years, holidays, weekends and month ends.
func TestBuildPlanHoldsForEveryDay(t *testing.T) {
	zone, err := time.LoadLocation("America/Mexico_City")
	if err != nil {
		t.Fatal(err)
	}
	for day := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC); day.Year() < 2029; day = day.AddDate(0, 0, 1) {
		for _, hour := range []int{0, 12, 23} {
			now := time.Date(day.Year(), day.Month(), day.Day(), hour, 30, 0, 0, zone)
			if _, err := BuildPlan(now, testPeople); err != nil {
				t.Fatalf("%s: %v", now.Format(time.RFC3339), err)
			}
		}
	}
}

// Same day, same statements; another day refreshes the dates and keeps every
// id, so apply is idempotent and re-apply updates the same rows.
func TestBuildPlanIsDeterministic(t *testing.T) {
	now := time.Date(2026, 11, 8, 18, 0, 0, 0, time.UTC)
	first, err := BuildPlan(now, testPeople)
	if err != nil {
		t.Fatal(err)
	}
	second, err := BuildPlan(now, testPeople)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first.Statements, second.Statements) {
		t.Fatal("same day, different statements")
	}
	later, err := BuildPlan(now.AddDate(0, 2, 17), testPeople)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(planIDs(first), planIDs(later)) {
		t.Fatal("ids depend on the day")
	}
	if reflect.DeepEqual(first.Statements, later.Statements) {
		t.Fatal("dates were not recomputed")
	}
	if len(first.Statements) < 500 {
		t.Fatalf("only %d statements", len(first.Statements))
	}
}

// The plan writes only the demo company, its fictitious people and the three
// accounts' memberships: never a real user row, never another company.
func TestBuildPlanScope(t *testing.T) {
	plan, err := BuildPlan(time.Date(2026, 11, 8, 18, 0, 0, 0, time.UTC), testPeople)
	if err != nil {
		t.Fatal(err)
	}
	real := []uuid.UUID{testPeople.Owner, testPeople.Stakeholder, testPeople.Recruiter}
	members := map[uuid.UUID]string{}
	var users, candidates int
	for _, s := range plan.Statements {
		if !strings.HasPrefix(s.SQL, "INSERT INTO ") {
			t.Fatalf("plan mutates existing rows: %s", s.SQL)
		}
		target := strings.Fields(s.SQL)[2]
		table, rest, _ := strings.Cut(target, "(")
		columns := strings.Split(strings.TrimSuffix(rest, ")"), ",")
		if len(columns) != len(s.Args) {
			t.Fatalf("%s: %d columns, %d args", table, len(columns), len(s.Args))
		}
		for i, column := range columns {
			if column == "company_id" || (table == "companies" && column == "id") {
				if s.Args[i] != CompanyID() {
					t.Fatalf("%s writes company %v", table, s.Args[i])
				}
			}
		}
		switch table {
		case "users":
			id := s.Args[0].(uuid.UUID)
			if slices.Contains(real, id) || !slices.Contains(plan.FictitiousUsers, id) {
				t.Fatalf("plan writes user %s", id)
			}
			if !strings.HasSuffix(s.Args[2].(string), "@example.invalid") {
				t.Fatalf("email %v", s.Args[2])
			}
			users++
			if s.Args[4] == "candidate" {
				candidates++
			}
		case "company_members":
			members[s.Args[1].(uuid.UUID)] = s.Args[3].(string)
		}
	}
	if !reflect.DeepEqual(plan.FictitiousUsers, FictitiousUsers()) {
		t.Fatal("plan users differ from the ones remove deletes")
	}
	if users != len(plan.FictitiousUsers) || users-candidates != 5 || candidates < 40 {
		t.Fatalf("users %d, candidates %d, fictitious %d", users, candidates, len(plan.FictitiousUsers))
	}
	want := map[uuid.UUID]string{testPeople.Owner: "owner", testPeople.Stakeholder: "stakeholder", testPeople.Recruiter: "recruiter",
		ID("user", "mariana"): "recruiter", ID("user", "jorge"): "recruiter", ID("user", "lucia"): "recruiter", ID("user", "diego"): "recruiter"}
	if !reflect.DeepEqual(members, want) {
		t.Fatalf("members %v", members)
	}
}

func planIDs(p *Plan) []uuid.UUID {
	var out []uuid.UUID
	for _, s := range p.Statements {
		for _, arg := range s.Args {
			if id, ok := arg.(uuid.UUID); ok {
				out = append(out, id)
			}
		}
	}
	return out
}

// The plan's checks are real: a designed result, a stalled flag or an instant
// that does not hold for the day fails the build.
func TestBuilderRejectsBrokenDesigns(t *testing.T) {
	now := time.Date(2026, 11, 8, 18, 0, 0, 0, time.UTC)
	newBuilder := func() *builder {
		today := civil(now)
		return &builder{now: now, today: today, people: testPeople,
			periodStart: time.Date(today.Year(), today.Month()-11, 1, 0, 0, 0, 0, time.UTC),
			monthEnd:    time.Date(today.Year(), today.Month()+1, 0, 0, 0, 0, 0, time.UTC),
			users:       map[string]uuid.UUID{"owner": testPeople.Owner, "recruiter": testPeople.Recruiter},
			requesters:  map[string]requester{}, candidates: []candidate{{id: uuid.New(), name: "C"}}}
	}
	for name, design := range map[string]func(b *builder){
		"wrong result": func(b *builder) {
			v := b.vacancy("x", "X", "product", "", b.month(3, 1), "with_responsible")
			v.stay("recruiter", "responsible", v.created)
			v.deliver(1, v.d(5))
			v.expect("late", 2)
			v.apply("portal", v.t(1, 11)).to("screening_ok", v.t(2, 11), "recruiter")
		},
		"wrong stalled": func(b *builder) {
			v := b.vacancy("x", "X", "product", "", b.month(3, 1), "with_responsible")
			v.stay("recruiter", "responsible", v.created)
			v.expect("not_configured", -1)
			v.apply("portal", at(b.recent(2), 11, 0)).expectStalled(true)
		},
		"future instant": func(b *builder) {
			v := b.vacancy("x", "X", "product", "", b.month(0, 1), "with_responsible")
			v.stay("recruiter", "responsible", v.created)
			v.expect("not_configured", -1)
			v.close("filled", "", at(b.today.AddDate(0, 0, 1), 10, 0))
		},
		"move back in time": func(b *builder) {
			v := b.vacancy("x", "X", "product", "", b.month(3, 1), "with_responsible")
			v.stay("recruiter", "responsible", v.created)
			v.expect("not_configured", -1)
			v.apply("portal", v.t(3, 11)).to("screening", v.t(2, 11), "recruiter")
		},
	} {
		b := newBuilder()
		design(b)
		for _, v := range b.vacancies {
			v.validate()
		}
		if len(b.errs) == 0 {
			t.Errorf("%s: accepted", name)
		}
	}
}
