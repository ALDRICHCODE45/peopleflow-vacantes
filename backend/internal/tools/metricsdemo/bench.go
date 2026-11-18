package metricsdemo

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand/v2"
	"strconv"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/domain/valueobjects"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Bench sizes one benchmark company for the metrics budgets
// (odd/tasks/stakeholder-metrics-v2-backend.md T6, backend/docs/metrics-benchmark.md).
// It reuses the demo's builder primitives with generated vacancies instead of
// the hand-written scenario; the demo's own plan is untouched. Every id hangs
// off Key (uuid v5 under Namespace), so two benchmark companies never share a
// row and the same Key and now always give the same statements.
type Bench struct {
	Key            string
	Vacancies      int // published over the last twelve months
	Drafts         int // never published (outside every metric)
	Participations int // about, spread over the published vacancies
	Recruiters     int
	Candidates     int
}

// RealisticBench is the contract's realistic seed (stakeholder-metrics-v2
// §2): 300 published vacancies and about 10k participations, 15 recruiters.
func RealisticBench(key string) Bench {
	return Bench{Key: key, Vacancies: 300, Drafts: 15, Participations: 10_000, Recruiters: 15, Candidates: 3_000}
}

// CompanyID is the benchmark company.
func (s Bench) CompanyID() uuid.UUID { return ID("bench", s.Key, "company") }

// Owner is the benchmark company's owner account and its login subject.
func (s Bench) Owner() (uuid.UUID, string) {
	return ID("bench", s.Key, "user", "owner"), "bench-metrics|" + s.Key + "|owner"
}

func (s Bench) recruiterKey(i int) string { return fmt.Sprintf("r%02d", i+1) }

// FictitiousUsers are every users row the benchmark company creates.
func (s Bench) FictitiousUsers() []uuid.UUID {
	owner, _ := s.Owner()
	out := []uuid.UUID{owner}
	for i := 0; i < s.Recruiters; i++ {
		out = append(out, ID("bench", s.Key, "user", s.recruiterKey(i)))
	}
	for i := 0; i < s.Candidates; i++ {
		out = append(out, ID("bench", s.Key, "candidate", strconv.Itoa(i)))
	}
	return out
}

// benchRand is deterministic per Key.
func (s Bench) rand() *rand.Rand {
	sum := sha256.Sum256([]byte("metrics-bench/" + s.Key))
	return rand.New(rand.NewPCG(binary.BigEndian.Uint64(sum[:8]), binary.BigEndian.Uint64(sum[8:16])))
}

var benchReasons = []string{"requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected"}
var benchReassignReasons = []string{"workload", "recruiter_departure", "performance", "client_request", "other"}
var benchAreas = []string{"technology_systems", "administration_finance", "sales_business_development", "human_resources",
	"logistics_transport", "operations_production", "marketing_communications", "customer_service_support"}

// BuildBenchPlan builds every row of the benchmark company for now. It is
// pure, like BuildPlan.
func BuildBenchPlan(now time.Time, s Bench) (*Plan, error) {
	if s.Key == "" || s.Vacancies <= 0 || s.Recruiters < 3 || s.Candidates <= 0 {
		return nil, errors.New("bench: key, vacancies, at least 3 recruiters and candidates are required")
	}
	today := civil(now)
	owner, sub := s.Owner()
	company := s.CompanyID()
	b := &builder{company: company, now: now, today: today, people: People{Owner: owner, OwnerName: "Dueño Bench " + s.Key},
		periodStart: time.Date(today.Year(), today.Month()-11, 1, 0, 0, 0, 0, time.UTC),
		monthEnd:    time.Date(today.Year(), today.Month()+1, 0, 0, 0, 0, 0, time.UTC),
		users:       map[string]uuid.UUID{"owner": owner}, requesters: map[string]requester{}}
	plan := &Plan{}
	start := at(b.periodStart.AddDate(0, 0, -7), 9, 0)
	add := func(st Statement) { plan.Statements = append(plan.Statements, st) }

	add(insert("companies", "id,name,rfc,industry_id,status,description,size,created_at,updated_at",
		company, "Bench Métricas "+s.Key, "BENCHMETRICS"+s.Key, "technology", "active", "Empresa ficticia del benchmark de métricas (solo pruebas).", "large", start, start))
	plan.FictitiousUsers = s.FictitiousUsers()
	add(insert("users", "id,cognito_sub,email,full_name,user_type,created_at", owner, sub, "bench-"+s.Key+"-owner@example.invalid", b.people.OwnerName, "recruiter", start))
	add(insert("company_members", "id,user_id,company_id,role", ID("bench", s.Key, "member", "owner"), owner, company, "owner"))
	var recruiterKeys []string
	for i := 0; i < s.Recruiters; i++ {
		key := s.recruiterKey(i)
		id := ID("bench", s.Key, "user", key)
		b.users[key] = id
		recruiterKeys = append(recruiterKeys, key)
		name := firstNames[i%len(firstNames)] + " " + lastNames[(i*7)%len(lastNames)] + " (bench)"
		add(insert("users", "id,cognito_sub,email,full_name,user_type,created_at", id, "bench-metrics|"+s.Key+"|"+key,
			"bench-"+s.Key+"-"+key+"@example.invalid", name, "recruiter", start))
		add(insert("company_members", "id,user_id,company_id,role", ID("bench", s.Key, "member", key), id, company, "recruiter"))
	}
	var requesterKeys []string
	for i := 0; i < 12; i++ {
		kind, label := "client", "Cliente Bench "
		if i >= 8 {
			kind, label = "internal_area", "Área Bench "
		}
		name, err := valueobjects.NewRequesterName(fmt.Sprintf("%s%s %02d", label, s.Key, i+1))
		if err != nil {
			return nil, err
		}
		key := "q" + strconv.Itoa(i)
		id := ID("bench", s.Key, "requester", key)
		b.requesters[key] = requester{id: id, kind: kind, name: name.Value()}
		requesterKeys = append(requesterKeys, key)
		add(insert("job_draft_requesters", "id,company_id,kind,name,name_key,normalization_version,created_at",
			id, company, kind, name.Value(), name.Key(), int32(1), start))
	}
	for i := 0; i < s.Candidates; i++ {
		name := firstNames[i%len(firstNames)] + " " + lastNames[(i/len(firstNames))%len(lastNames)] + " " + lastNames[(i/(len(firstNames)*len(lastNames))+i)%len(lastNames)]
		c := candidate{id: ID("bench", s.Key, "candidate", strconv.Itoa(i)), cv: ID("bench", s.Key, "candidate-cv", strconv.Itoa(i)), name: name,
			email: fmt.Sprintf("bench-%s-candidato%04d@example.invalid", s.Key, i+1)}
		b.candidates = append(b.candidates, c)
		hash := sha256.Sum256([]byte("metrics-bench/cv/" + c.cv.String()))
		add(insert("users", "id,cognito_sub,email,full_name,user_type,created_at", c.id, "bench-metrics|"+s.Key+"|candidate|"+strconv.Itoa(i), c.email, name, "candidate", start))
		add(insert("candidate_cv_versions", "id,candidate_id,storage_key,size,content_type,uploaded_at", c.cv, c.id, hex.EncodeToString(hash[:]), int64(204_800), "application/pdf", start))
	}

	g := &benchGen{b: b, s: s, r: s.rand(), recruiters: recruiterKeys, requesters: requesterKeys}
	for i := 0; i < s.Vacancies; i++ {
		g.vacancy(i)
	}
	for i := 0; i < s.Drafts; i++ {
		v := b.draftOnly(fmt.Sprintf("bench/%s/d%03d", s.Key, i), fmt.Sprintf("Borrador Bench %03d", i), benchAreas[i%len(benchAreas)], "", b.recent(2+i%10))
		v.stay(recruiterKeys[i%len(recruiterKeys)], "responsible", v.created)
		v.closingTarget(1, nil)
	}
	for _, v := range b.vacancies {
		v.emit(&plan.Statements)
	}
	plan.Statements = append(plan.Statements, g.extra...)
	if len(b.errs) > 0 {
		return nil, errors.Join(b.errs...)
	}
	return plan, nil
}

// benchGen lays out the generated vacancies. Times are business days after
// publication (v.d / v.t), always before today, so nothing is in the future
// whatever hour now is.
type benchGen struct {
	b          *builder
	s          Bench
	r          *rand.Rand
	recruiters []string
	requesters []string
	extra      []Statement // substate history rows (the builder has no substates)
	substates  int
}

func (g *benchGen) pct(p int) bool { return g.r.IntN(100) < p }

// pub spreads the vacancies evenly over the twelve months; the current
// month's ones stay at least five business days before today.
func (g *benchGen) pub(i int) time.Time {
	k := 11 - i*12/g.s.Vacancies
	perMonth := (g.s.Vacancies + 11) / 12
	day := 1 + (i%perMonth)*27/perMonth
	d := g.b.month(k, day)
	if latest := g.b.recent(5); d.After(latest) {
		d = g.b.recent(5 + i%15)
	}
	return d
}

func (g *benchGen) vacancy(i int) {
	b := g.b
	pub := g.pub(i)
	mode := "with_responsible"
	if g.pct(15) {
		mode = "shared"
	}
	req := ""
	if !g.pct(10) {
		req = g.requesters[g.r.IntN(len(g.requesters))]
	}
	v := b.vacancy(fmt.Sprintf("bench/%s/v%03d", g.s.Key, i), fmt.Sprintf("Vacante Bench %03d", i), benchAreas[i%len(benchAreas)], req, pub, mode)
	if g.pct(10) {
		v.customPipeline("Entrevista con cliente", "Prueba técnica (anterior)")
	}
	// last is the latest business-day index strictly before today.
	last := businessDaysBetween(pub, b.today) - 1

	// Team.
	n := len(g.recruiters)
	resp := g.recruiters[i%n]
	other := g.recruiters[(i+1+g.r.IntN(n-2))%n]
	var collaborator string
	if mode == "shared" {
		v.stay(resp, "member", v.created)
		v.stay(other, "member", v.created)
	} else {
		v.stay(resp, "responsible", v.created)
		if g.pct(30) {
			collaborator = other
			v.stay(collaborator, "collaborator", v.created)
		}
	}

	// Closing day: most vacancies older than ~45 business days are closed.
	closeDay := -1
	if c := 20 + g.r.IntN(25); c <= last && (last > 45 && g.pct(85) || g.pct(20)) {
		closeDay = c
	}
	bound := last // moves happen before the close and before today
	if closeDay >= 0 {
		bound = closeDay - 1
	}

	headcount := 1
	if g.pct(15) {
		headcount = 2
	}
	var target *time.Time
	if g.pct(50) {
		target = ptr(v.d(30))
	}
	v.closingTarget(headcount, target)
	if target != nil && bound > 10 && g.pct(10) {
		v.moveTarget(v.d(40), v.t(10, 11))
	}
	if g.pct(80) {
		commitment := v.d(8 + g.r.IntN(9))
		if commitment.After(b.monthEnd) {
			commitment = b.monthEnd
		}
		v.deliver(2+g.r.IntN(3), commitment)
		if bound > 4 && g.pct(10) {
			v.renegotiate(v.d(5), v.t(3, 13))
		}
	}

	// Reassignment of the responsible on day 6.
	reassigned := false
	if mode == "with_responsible" && bound >= 12 && g.pct(10) {
		to := g.recruiters[(i+2+g.r.IntN(n-3))%n]
		if to == collaborator || to == resp {
			to = g.recruiters[(i+n-1)%n]
		}
		if to != collaborator && to != resp {
			reason := benchReassignReasons[g.r.IntN(len(benchReassignReasons))]
			note := ""
			if reason == "other" {
				note = "Cambio de prioridades en el equipo"
			}
			v.reassign(resp, to, reason, note, v.t(6, 10), g.pct(30))
			resp, reassigned = to, true
		}
	}
	actor := func(day int) string {
		if reassigned && day < 6 {
			return g.recruiters[i%n]
		}
		return resp
	}
	if mode == "shared" {
		actor = func(day int) string {
			if day%2 == 0 {
				return resp
			}
			return other
		}
	}

	// Participations.
	if bound >= 1 {
		count := g.s.Participations / g.s.Vacancies
		count = count/2 + g.r.IntN(count+1)
		for k := 0; k < count; k++ {
			g.participation(v, bound, actor)
		}
	}

	// Hires: the filled close hires headcount people the day before closing;
	// a few first hires did not hold; some open vacancies hire too.
	recipients := func(day int) []recipient {
		if mode == "shared" {
			return []recipient{{resp, "shared"}, {other, "shared"}}
		}
		out := []recipient{{actor(day), "direct"}}
		if collaborator != "" {
			out = append(out, recipient{collaborator, "participant"})
		}
		return out
	}
	hire := func(day int, status string) {
		if day < 5 {
			return
		}
		start := g.r.IntN(min(3, day-4))
		p := v.apply("portal", v.t(start, 11))
		p.to("screening", v.t(start+1, 10), actor(start+1)).to("screening_ok", v.t(start+2, 12), actor(start+2)).
			to("in_process", v.t(start+3, 10), actor(start+3))
		if status == "did_not_hold" {
			p.hire(v.t(day-2, 10), actor(day-2)).leave(v.t(day, 10), actor(day))
		} else {
			p.hire(v.t(day, 10), actor(day))
		}
		v.credit(p, status, recipients(day)...)
	}
	switch {
	case closeDay < 0:
		if bound >= 8 && g.pct(10) {
			hire(bound, "active")
		}
		if g.pct(5) {
			v.pause(at(b.recent(2), 16, 0))
		}
	default:
		reason, note := "filled", ""
		switch r := g.r.IntN(100); {
		case r < 20:
			reason = "cancelled"
		case r < 30:
			reason, note = "other", "Se cubrió con una promoción interna"
		case r < 38:
			reason = ""
		}
		if reason == "filled" {
			if g.pct(5) {
				hire(closeDay-3, "did_not_hold")
			}
			for h := 0; h < headcount; h++ {
				hire(closeDay-1, "active")
			}
		}
		if closeDay > 12 && g.pct(4) {
			v.close("other", "El cliente pausó la contratación", v.t(closeDay-8, 17))
			v.reopen(v.t(closeDay-6, 10))
		}
		v.close(reason, note, v.t(closeDay, 17))
	}
}

// participation is one random path through the pipeline within [0, bound]:
// it may stay new, advance, be discarded, be recovered and get substates.
func (g *benchGen) participation(v *vacancy, bound int, actor func(int) string) {
	day := g.r.IntN(min(bound, 25) + 1)
	var p *part
	switch r := g.r.IntN(100); {
	case r < 50:
		p = v.apply("portal", v.t(day, 11))
	case r < 75:
		p = v.apply("careers_site", v.t(day, 11))
	case r < 85:
		p = v.apply("unknown", v.t(day, 11))
	default:
		p = v.intake(actor(day), v.t(day, 10))
	}
	path := []string{"screening", "screening_ok", "in_process"}
	if _, ok := v.stages["custom"]; ok && g.pct(30) {
		path = append(path, "custom")
	}
	depth := 0
	if !g.pct(25) {
		depth = 1 + g.r.IntN(len(path))
	}
	discardAfter := -1
	if g.pct(35) {
		discardAfter = g.r.IntN(depth + 1)
	}
	next := func() bool {
		step := 1 + g.r.IntN(4)
		if day+step > bound {
			return false
		}
		day += step
		return true
	}
	for k := 0; k <= depth; k++ {
		if k == discardAfter {
			if !next() {
				return
			}
			p.discard(v.t(day, 15), actor(day), benchReasons[g.r.IntN(len(benchReasons))])
			if g.pct(10) && next() {
				p.discarded = false
				p.step(&entry{stage: p.last().from, at: v.t(day, 10), actor: v.actor(actor(day)), kind: "recovery"})
			}
			return
		}
		if k == depth {
			break
		}
		if !next() {
			break
		}
		stage := path[k]
		if _, ok := v.stages["retired"]; ok && stage == "in_process" && g.pct(10) {
			stage = "retired"
			p.to(stage, v.t(day, 12), actor(day))
			break
		}
		p.to(stage, v.t(day, 12), actor(day))
		if g.pct(15) {
			g.substate(p, v.t(day, 13), actor(day))
		}
	}
}

// substate adds a substate history row in the participation's current stage
// (event_kind substate: no stage change, ignored by every metric).
func (g *benchGen) substate(p *part, when time.Time, by string) {
	g.substates++
	sub := ID("bench", g.s.Key, "substate", strconv.Itoa(g.substates%3))
	g.extra = append(g.extra, insert("participation_stage_history",
		"id,participation_id,stage_id,actor_id,created_at,event_kind,actor_kind,hire,departure,to_substate_id,to_substate_name",
		ID("bench", g.s.Key, "substate-history", strconv.Itoa(g.substates)), p.id, p.v.stages[p.stage()], p.v.actor(by), when,
		"substate", "recruiter", false, false, sub, "En espera "+strconv.Itoa(g.substates%3)))
}

// ApplyBench writes the benchmark company for now, replacing a previous one
// with the same Key, in one transaction on db only.
func ApplyBench(ctx context.Context, pool Beginner, db Database, s Bench, now time.Time) (Applied, error) {
	out := Applied{Company: s.CompanyID()}
	plan, err := BuildBenchPlan(now, s)
	if err != nil {
		return out, fmt.Errorf("build the bench company: %w", err)
	}
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	if err := db.verify(ctx, tx); err != nil {
		return out, err
	}
	if out.Removed, err = purge(ctx, tx, s.CompanyID(), plan.FictitiousUsers); err != nil {
		return out, err
	}
	const chunk = 5_000
	for from := 0; from < len(plan.Statements); from += chunk {
		part := plan.Statements[from:min(from+chunk, len(plan.Statements))]
		batch := &pgx.Batch{}
		for _, st := range part {
			batch.Queue(st.SQL, st.Args...)
		}
		results := tx.SendBatch(ctx, batch)
		for i := range part {
			if _, err := results.Exec(); err != nil {
				results.Close()
				return out, fmt.Errorf("bench row %d (%s): %w", from+i, tableOf(part[i].SQL), err)
			}
		}
		if err := results.Close(); err != nil {
			return out, err
		}
	}
	out.Statements = len(plan.Statements)
	return out, tx.Commit(ctx)
}

// RemoveBench deletes the benchmark company and its fictitious users from db.
func RemoveBench(ctx context.Context, pool Beginner, db Database, s Bench) (Removed, error) {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := db.verify(ctx, tx); err != nil {
		return nil, err
	}
	removed, err := purge(ctx, tx, s.CompanyID(), s.FictitiousUsers())
	if err != nil {
		return nil, err
	}
	return removed, tx.Commit(ctx)
}
