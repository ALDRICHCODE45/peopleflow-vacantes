//go:build integration

package main

import (
	"context"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/jobs/application/pipelineconfig"
	"github.com/google/uuid"
)

// Replacement processes R4 (docs/contracts/replacement-processes-v1.md, «GET V/replacements»;
// feature doc L11): the chain of a logical vacancy, the start block, the startable credits and
// the candidates that can be carried, through the production router. Fixtures are real
// participations with credits seeded by SQL (their intake paths are other features).

const replTimeLayout = "2006-01-02T15:04:05.000000Z"

func replTime(at time.Time) string { return at.UTC().Format(replTimeLayout) }

// chain is GET V/replacements of `id` as `token`.
func (f *replFlow) chain(id, token string) draftFlowResponse {
	f.t.Helper()
	return f.h.do(f.t, "GET", draftFlowV2Path+"/"+id+"/replacements", "", token, nil)
}

// chainOK is the 200 body of GET V/replacements of `id` as the owner.
func (f *replFlow) chainOK(id string) map[string]any {
	f.t.Helper()
	got := f.chain(id, f.owner.token)
	if got.status != 200 {
		f.t.Fatalf("replacements of %s: %d %s", id, got.status, got.body)
	}
	draftFlowAssertNoStore(f.t, got)
	return draftFlowObject(f.t, got.body)
}

func replObject(t *testing.T, v any) map[string]any {
	t.Helper()
	m, ok := v.(map[string]any)
	if !ok {
		t.Fatalf("not an object: %#v", v)
	}
	return m
}

func replList(t *testing.T, v any) []any {
	t.Helper()
	l, ok := v.([]any)
	if !ok {
		t.Fatalf("not a list: %#v", v)
	}
	return l
}

func replStart(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	return replObject(t, body["start_replacement"])
}

// replAssertTopLevel pins the response's keys.
func replAssertTopLevel(t *testing.T, body map[string]any) {
	t.Helper()
	if got, want := replSortedKeys(body), []string{"carry_candidates", "carry_candidates_truncated", "items", "root_process_id", "start_replacement"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("keys = %v, want %v", got, want)
	}
	if got, want := replSortedKeys(replStart(t, body)), []string{"active_replacement_id", "allowed", "blocker", "missing", "publish_ready", "startable_credits"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("start_replacement keys = %v, want %v", got, want)
	}
}

// replAssertNotAllowed pins the start block of a source that cannot start: the credits,
// the readiness and the candidates are only filled when it can.
func replAssertNotAllowed(t *testing.T, body map[string]any, blocker string, active any) {
	t.Helper()
	replAssertTopLevel(t, body)
	start := replStart(t, body)
	if start["allowed"] != false || start["blocker"] != blocker || start["active_replacement_id"] != active ||
		!reflect.DeepEqual(start["startable_credits"], []any{}) || start["publish_ready"] != nil || !reflect.DeepEqual(start["missing"], []any{}) ||
		!reflect.DeepEqual(body["carry_candidates"], []any{}) || body["carry_candidates_truncated"] != false {
		t.Fatalf("start block = %v, carry = %v %v, want blocker %q active %v", start, body["carry_candidates"], body["carry_candidates_truncated"], blocker, active)
	}
}

// hire seeds a hire of `p` in `process`: a participation in Placement and its credit with
// the process' current team as recipients. status "active" keeps the candidate placed;
// "did_not_hold" and "voided" discard the participation out of Placement an hour later, as
// a departure does (candidate_left / moved_by_mistake).
func (f *carryFlow) hire(process string, p carryPerson, hiredAt time.Time, status string) (credit, participation string) {
	f.t.Helper()
	s := replStages(process)
	participation = f.participate(process, p, s["placement"], hiredAt)
	credit = uuid.NewString()
	f.exec(`INSERT INTO placement_credits(id,company_id,process_id,participation_id,hire_history_id,hired_at,hired_by,team_mode,status) VALUES($1,$2,$3,$4,$5,$6,$7,'with_responsible','active')`,
		credit, f.company.companyID, process, participation, uuid.New(), hiredAt, f.owner.userID)
	f.exec(`INSERT INTO placement_credit_recipients(credit_id,user_id,assignment_id,kind) SELECT $1,a.user_id,a.id,'direct' FROM vacancy_assignments a WHERE a.draft_id=$2 AND a.ended_at IS NULL`, credit, process)
	if status == "active" {
		return credit, participation
	}
	reason := map[string]string{"did_not_hold": "candidate_left", "voided": "moved_by_mistake"}[status]
	left, history := hiredAt.Add(time.Hour), uuid.New()
	f.discard(participation, s["discarded"], s["placement"])
	f.exec(`INSERT INTO participation_stage_history(id,participation_id,stage_id,actor_id,created_at,from_stage_id,hire,departure,actor_kind,event_kind,reason_group,reason_code) VALUES($1,$2,$3,$4,$5,$6,false,true,'recruiter','discard','candidate','unresponsive')`,
		history, participation, s["discarded"], f.owner.userID, left, s["placement"])
	f.exec(`UPDATE placement_credits SET status=$2,exit_history_id=$3,exit_reason=$4,status_changed_at=$5 WHERE id=$1`, credit, status, history, reason, left)
	return credit, participation
}

// fallenChain is a published original closed covered and finished, with n hires that left.
func (f *carryFlow) fallenChain(n int) (root string, credits []string, people []carryPerson) {
	f.t.Helper()
	root = f.published()
	base := time.Now().UTC().Truncate(time.Microsecond).Add(-72 * time.Hour)
	for i := 0; i < n; i++ {
		p := f.manual(fmt.Sprintf("Fallen %d", i))
		credit, _ := f.hire(root, p, base.Add(time.Duration(i)*time.Minute), "did_not_hold")
		credits, people = append(credits, credit), append(people, p)
	}
	f.closeIt(root, "finish")
	f.cover(root)
	return root, credits, people
}

func replStageName(process, kind string) string {
	d := pipelineconfig.Defaults(uuid.MustParse(process))
	for _, s := range d.Stages {
		if s.Kind == kind {
			return s.Name
		}
	}
	return d.Exit.Name
}

func (f *replFlow) ownerName() string {
	f.t.Helper()
	return f.scalar(`SELECT full_name FROM users WHERE id=$1`, f.owner.userID).(string)
}

func TestReplacementListOfAClosedOriginal(t *testing.T) {
	f := newCarryFlow(t)
	root := f.published()
	s := replStages(root)
	base := time.Now().UTC().Truncate(time.Microsecond).Add(-72 * time.Hour)

	// Two hires that left (a company candidate and an organic one whose name the company corrected),
	// a voided one (never startable), an active hire (covers) and a candidate still in screening.
	zoe, alba := f.manual("Zoe Fallen"), f.organic("Alba Original")
	f.exec(`INSERT INTO company_candidate_corrections(company_id,user_id,corrections) VALUES($1,$2,'{"full_name":"Alba Corregida"}'::jsonb)`, f.company.companyID, alba.id)
	t.Cleanup(func() { f.exec(`DELETE FROM company_candidate_corrections WHERE company_id=$1`, f.company.companyID) })
	zoeCredit, zoePart := f.hire(root, zoe, base, "did_not_hold")
	albaCredit, albaPart := f.hire(root, alba, base.Add(time.Minute), "did_not_hold")
	void := f.manual("Void Person")
	_, voidPart := f.hire(root, void, base.Add(2*time.Minute), "voided")
	f.hire(root, f.manual("Still Hired"), base.Add(3*time.Minute), "active")
	mario := f.manual("Mario Screening")
	marioPart := f.participate(root, mario, s["screening"], base.Add(4*time.Minute))
	f.closeIt(root, "finish")
	f.cover(root)

	body := f.chainOK(root)
	replAssertTopLevel(t, body)
	if body["root_process_id"] != root || body["carry_candidates_truncated"] != false {
		t.Fatalf("body = %v", body)
	}

	// One item, the original: sequence 0 (feature doc L11), title, lifecycle, coverage of the live board.
	items := replList(t, body["items"])
	if len(items) != 1 {
		t.Fatalf("items = %v", items)
	}
	item := replObject(t, items[0])
	if got, want := replSortedKeys(item), []string{"can_open", "coverage", "id", "kind", "lifecycle", "replaced_credit_ids", "replacement_of", "sequence", "started_at", "started_by", "title", "visibility"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("item keys = %v, want %v", got, want)
	}
	closedAt := f.processTime("closed_at", root)
	owner := map[string]any{"id": f.owner.userID.String(), "name": f.ownerName()}
	want := map[string]any{
		"id": root, "kind": "original", "sequence": float64(0), "replacement_of": nil, "title": "Backend Go", "visibility": "public",
		"lifecycle":  map[string]any{"publication": "closed", "process": "finished", "close_reason": "filled", "closed_at": replTime(closedAt)},
		"started_at": replTime(f.processTime("published_at", root)), "started_by": owner,
		"coverage": map[string]any{"covered": float64(1), "required": float64(2)}, "replaced_credit_ids": []any{}, "can_open": true,
	}
	if !reflect.DeepEqual(item, want) {
		t.Fatalf("item = %#v\nwant %#v", item, want)
	}

	// The start block: the two fallen credits, oldest hire first, with the hired candidate (the board's
	// name view), the departure time and the frozen recipients; the voided one is not startable.
	start := replStart(t, body)
	if start["allowed"] != true || start["blocker"] != nil || start["active_replacement_id"] != nil || start["publish_ready"] != true || !reflect.DeepEqual(start["missing"], []any{}) {
		t.Fatalf("start block = %v", start)
	}
	credits := replList(t, start["startable_credits"])
	if len(credits) != 2 {
		t.Fatalf("startable credits = %v", credits)
	}
	recipients := []any{map[string]any{"user_id": f.owner.userID.String(), "name": f.ownerName(), "kind": "direct"}}
	for i, c := range []struct {
		credit, participation string
		person                carryPerson
		name                  string
		hired                 time.Time
	}{{zoeCredit, zoePart, zoe, "Zoe Fallen", base}, {albaCredit, albaPart, alba, "Alba Corregida", base.Add(time.Minute)}} {
		credit := replObject(t, credits[i])
		if got, want := replSortedKeys(credit), []string{"candidate", "credit_id", "exit_reason", "hired_at", "left_at", "participation_id", "process_id", "recipients"}; !reflect.DeepEqual(got, want) {
			t.Fatalf("credit keys = %v, want %v", got, want)
		}
		wantCredit := map[string]any{
			"credit_id": c.credit, "process_id": root, "participation_id": c.participation,
			"candidate": map[string]any{"kind": c.person.kind, "id": c.person.id.String(), "full_name": c.name},
			"hired_at":  replTime(c.hired), "left_at": replTime(c.hired.Add(time.Hour)), "exit_reason": "candidate_left", "recipients": recipients,
		}
		if !reflect.DeepEqual(credit, wantCredit) {
			t.Fatalf("credit %d = %#v\nwant %#v", i, credit, wantCredit)
		}
	}

	// carry_candidates: everyone who is not currently placed (a voided hire included: «Cualquiera»), by name;
	// the discarded ones show the stage they left, by kind and name only; v1 lists only eligible candidates.
	candidates := replList(t, body["carry_candidates"])
	wantCandidates := []any{
		map[string]any{"candidate": map[string]any{"kind": "organic", "id": alba.id.String(), "full_name": "Alba Corregida"}, "process_id": root, "participation_id": albaPart,
			"stage": map[string]any{"kind": "placement", "name": replStageName(root, "placement")}, "discarded": true, "eligible": true},
		map[string]any{"candidate": map[string]any{"kind": "manual", "id": mario.id.String(), "full_name": "Mario Screening"}, "process_id": root, "participation_id": marioPart,
			"stage": map[string]any{"kind": "screening", "name": replStageName(root, "screening")}, "discarded": false, "eligible": true},
		map[string]any{"candidate": map[string]any{"kind": "manual", "id": void.id.String(), "full_name": "Void Person"}, "process_id": root, "participation_id": voidPart,
			"stage": map[string]any{"kind": "placement", "name": replStageName(root, "placement")}, "discarded": true, "eligible": true},
		map[string]any{"candidate": map[string]any{"kind": "manual", "id": zoe.id.String(), "full_name": "Zoe Fallen"}, "process_id": root, "participation_id": zoePart,
			"stage": map[string]any{"kind": "placement", "name": replStageName(root, "placement")}, "discarded": true, "eligible": true},
	}
	if !reflect.DeepEqual(candidates, wantCandidates) {
		t.Fatalf("carry_candidates = %#v\nwant %#v", candidates, wantCandidates)
	}
}

func TestReplacementListServesTheSameChainFromAnyProcess(t *testing.T) {
	f := newCarryFlow(t)
	root, credits, _ := f.fallenChain(2)

	// Start a replacement for the first credit; the source is finished by the start.
	started := f.startOK(root, replBody(t, ",\"target_quantity\":2", credits[0]))
	repl := started["id"].(string)
	fromRoot, fromRepl := f.chainOK(root), f.chainOK(repl)
	replAssertTopLevel(t, fromRoot)
	if fromRoot["root_process_id"] != root || !reflect.DeepEqual(fromRoot["items"], fromRepl["items"]) || fromRepl["root_process_id"] != root {
		t.Fatalf("the chain differs by entry point:\n%v\n%v", fromRoot, fromRepl)
	}
	items := replList(t, fromRoot["items"])
	if len(items) != 2 {
		t.Fatalf("items = %v", items)
	}
	original, replacement := replObject(t, items[0]), replObject(t, items[1])
	if original["id"] != root || original["kind"] != "original" || original["sequence"] != float64(0) || !reflect.DeepEqual(original["replaced_credit_ids"], []any{}) {
		t.Fatalf("original = %v", original)
	}
	wantRepl := map[string]any{
		"id": repl, "kind": "replacement", "sequence": float64(1), "replacement_of": root, "title": "Backend Go", "visibility": "private",
		"lifecycle":  map[string]any{"publication": "published", "process": "active", "close_reason": nil, "closed_at": nil},
		"started_at": replTime(f.processTime("published_at", repl)), "started_by": map[string]any{"id": f.owner.userID.String(), "name": f.ownerName()},
		"coverage": map[string]any{"covered": float64(0), "required": float64(2)}, "replaced_credit_ids": []any{credits[0]}, "can_open": true,
	}
	if !reflect.DeepEqual(replacement, wantRepl) {
		t.Fatalf("replacement = %#v\nwant %#v", replacement, wantRepl)
	}

	// While the replacement runs nothing can start: the original has a replacement active, the replacement is not closed.
	replAssertNotAllowed(t, fromRoot, "replacement_active", repl)
	replAssertNotAllowed(t, fromRepl, "source_not_closed", repl)

	// Closed and still running: the replacement is the latest, closed, with the spare credit startable;
	// the original keeps the «replacement_active» blocker.
	f.closeIt(repl, "continue")
	atRoot, atRepl := f.chainOK(root), f.chainOK(repl)
	replAssertNotAllowed(t, atRoot, "replacement_active", repl)
	replAssertTopLevel(t, atRepl)
	start := replStart(t, atRepl)
	spare := replList(t, start["startable_credits"])
	if start["allowed"] != true || start["blocker"] != nil || start["active_replacement_id"] != repl || len(spare) != 1 || replObject(t, spare[0])["credit_id"] != credits[1] || start["publish_ready"] != true {
		t.Fatalf("start block of the closed replacement = %v", start)
	}
	closedItem := replObject(t, replList(t, atRepl["items"])[1])
	if closedItem["lifecycle"].(map[string]any)["publication"] != "closed" || closedItem["lifecycle"].(map[string]any)["close_reason"] != "cancelled" || closedItem["lifecycle"].(map[string]any)["closed_at"] == nil {
		t.Fatalf("closed item = %v", closedItem)
	}
	// carry_candidates are filled for the source that may start; both fallen hires are carriable.
	if len(replList(t, atRepl["carry_candidates"])) != 2 {
		t.Fatalf("carry candidates = %v", atRepl["carry_candidates"])
	}

	// Finished: the original is no longer the latest; the replacement can start the next one.
	if got := f.transition(repl, "finish-process", `{}`); got.status != 200 {
		t.Fatalf("finish: %d %s", got.status, got.body)
	}
	replAssertNotAllowed(t, f.chainOK(root), "not_latest", nil)
	if start = replStart(t, f.chainOK(repl)); start["allowed"] != true || start["active_replacement_id"] != nil {
		t.Fatalf("start block of the finished replacement = %v", start)
	}
}

func TestReplacementListBlockersAndPublishReadiness(t *testing.T) {
	f := newCarryFlow(t)

	// A draft that never published has no process: an empty chain rooted at itself, not startable.
	draft := f.draft()
	body := f.chainOK(draft)
	replAssertNotAllowed(t, body, "source_not_closed", nil)
	if body["root_process_id"] != draft || !reflect.DeepEqual(body["items"], []any{}) {
		t.Fatalf("draft chain = %v", body)
	}

	// Open (published) and paused sources are not closed.
	open := f.published()
	replAssertNotAllowed(t, f.chainOK(open), "source_not_closed", nil)
	if got := f.transition(open, "pause", `{}`); got.status != 200 {
		t.Fatalf("pause: %d %s", got.status, got.body)
	}
	replAssertNotAllowed(t, f.chainOK(open), "source_not_closed", nil)

	// Closed without a fallen credit.
	none := f.published()
	f.closeIt(none, "finish")
	body = f.chainOK(none)
	replAssertNotAllowed(t, body, "no_startable_credits", nil)
	if items := replList(t, body["items"]); len(items) != 1 || replObject(t, items[0])["id"] != none {
		t.Fatalf("items = %v", items)
	}

	// publish_ready follows the SOURCE's content; the codes Start fills itself never show.
	root, _, _ := f.fallenChain(1)
	f.exec(`UPDATE job_draft_delivery_configs SET commitment_date=(now() AT TIME ZONE 'America/Mexico_City')::date - 30 WHERE draft_id=$1`, root)
	start := replStart(t, f.chainOK(root))
	if start["allowed"] != true || start["publish_ready"] != true || !reflect.DeepEqual(start["missing"], []any{}) {
		t.Fatalf("a past commitment date is Start's to fill: %v", start)
	}
	f.breakContent(root)
	start = replStart(t, f.chainOK(root))
	if start["allowed"] != true || start["publish_ready"] != false || !reflect.DeepEqual(start["missing"], []any{"title_missing"}) {
		t.Fatalf("a content gap must show: %v", start)
	}
}

func TestReplacementListCarryCandidatesUseTheMostRecentParticipation(t *testing.T) {
	f := newCarryFlow(t)
	root, _, _ := f.fallenChain(0)
	repl := f.published()
	f.link(repl, root, root, 1)
	f.closeIt(repl, "finish")
	f.cover(repl)
	rs, ps := replStages(root), replStages(repl)
	t0 := time.Now().UTC().Truncate(time.Microsecond).Add(-96 * time.Hour)
	at := func(h int) time.Time { return t0.Add(time.Duration(h) * time.Hour) }

	// Left Placement in the original, started over in the replacement's pipeline: the NEWER row is the template.
	again := f.manual("A again")
	f.hire(root, again, at(0), "did_not_hold")
	againNow := f.participate(repl, again, ps["new"], at(10))
	// Discarded from in_process in the original only.
	gone := f.organic("B gone")
	gonePart := f.participate(root, gone, rs["in_process"], at(1))
	f.discard(gonePart, rs["discarded"], rs["in_process"])
	// Currently placed in the original: excluded.
	f.hire(root, f.manual("C placed"), at(2), "active")
	// Placed before, then again in screening of the replacement: the newer, unplaced row counts.
	moved := f.organic("E moved")
	f.hire(root, moved, at(3), "active")
	movedNow := f.participate(repl, moved, ps["screening"], at(11))
	// Older screening row, but newer placement in the replacement: currently placed, excluded.
	placed := f.manual("F placed later")
	f.participate(root, placed, rs["screening"], at(4))
	f.hire(repl, placed, at(12), "active")
	// A discarded hire of the replacement shows the stage it left.
	left := f.manual("G left")
	_, leftPart := f.hire(repl, left, at(5), "did_not_hold")
	// Two people with the same name: ordered by id.
	twinA, twinB := f.manual("Twin"), f.manual("Twin")
	twinAPart := f.participate(root, twinA, rs["new"], at(6))
	twinBPart := f.participate(root, twinB, rs["new"], at(7))

	// The latest process (the replacement) may start: it has startable credits (A's and G's hires).
	body := f.chainOK(repl)
	replAssertTopLevel(t, body)
	if start := replStart(t, body); start["allowed"] != true {
		t.Fatalf("start block = %v", start)
	}
	type row struct {
		kind, id, name, process, participation, stage string
		discarded                                     bool
	}
	var got []row
	for _, v := range replList(t, body["carry_candidates"]) {
		c := replObject(t, v)
		who := replObject(t, c["candidate"])
		stage := replObject(t, c["stage"])
		// v1 lists only eligible candidates: no `reason` key.
		if c["eligible"] != true || len(c) != 6 {
			t.Fatalf("candidate = %v", c)
		}
		got = append(got, row{who["kind"].(string), who["id"].(string), who["full_name"].(string), c["process_id"].(string), c["participation_id"].(string), stage["kind"].(string) + "|" + stage["name"].(string), c["discarded"].(bool)})
	}
	twins := []struct {
		p    carryPerson
		part string
	}{{twinA, twinAPart}, {twinB, twinBPart}}
	if twins[0].p.id.String() > twins[1].p.id.String() {
		twins[0], twins[1] = twins[1], twins[0]
	}
	stage := func(process, kind string) string { return kind + "|" + replStageName(process, kind) }
	want := []row{
		{"manual", again.id.String(), "A again", repl, againNow, stage(repl, "new"), false},
		{"organic", gone.id.String(), "B gone", root, gonePart, stage(root, "in_process"), true},
		{"organic", moved.id.String(), "E moved", repl, movedNow, stage(repl, "screening"), false},
		{"manual", left.id.String(), "G left", repl, leftPart, stage(repl, "placement"), true},
		{"manual", twins[0].p.id.String(), "Twin", root, twins[0].part, stage(root, "new"), false},
		{"manual", twins[1].p.id.String(), "Twin", root, twins[1].part, stage(root, "new"), false},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("carry candidates:\n got %+v\nwant %+v", got, want)
	}

	// The original is not the latest process of the chain: it lists no candidates.
	replAssertNotAllowed(t, f.chainOK(root), "not_latest", nil)
}

func TestReplacementListCarryCandidatesAreCappedAtAThousand(t *testing.T) {
	f := newCarryFlow(t)
	root, _, _ := f.fallenChain(1)
	f.t.Cleanup(func() { // before the fixture cleanups (LIFO): participations first, then the bulk candidates
		ctx := context.Background()
		for _, q := range []string{
			`DELETE FROM participation_stage_history WHERE participation_id IN (SELECT id FROM process_participations WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1))`,
			`DELETE FROM process_participations WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1 AND full_name LIKE 'Bulk %')`,
			`DELETE FROM company_candidate_cvs WHERE company_id=$1 AND file_name='bulk.pdf'`,
			`DELETE FROM company_candidates WHERE company_id=$1 AND full_name LIKE 'Bulk %'`,
		} {
			if _, err := f.h.pool.Exec(ctx, q, f.company.companyID); err != nil {
				t.Errorf("bulk cleanup: %v", err)
			}
		}
	})
	f.exec(`INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,professional_title,created_by)
 SELECT gen_random_uuid(),$1,'Bulk '||lpad(g::text,5,'0'),'bulk-'||g||'-'||$3||'@example.test','bulk-'||g||'-'||$3||'@example.test','US','Title',$2 FROM generate_series(1,1001) g`, f.company.companyID, f.owner.userID, uuid.NewString())
	f.exec(`INSERT INTO company_candidate_cvs(id,company_id,company_candidate_id,storage_key,size,content_type,file_name)
 SELECT gen_random_uuid(),company_id,id,replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-',''),6,'application/pdf','bulk.pdf' FROM company_candidates WHERE company_id=$1 AND full_name LIKE 'Bulk %'`, f.company.companyID)
	f.exec(`INSERT INTO process_participations(id,process_id,company_candidate_id,company_candidate_cv_id,stage_id,source,added_by,profile_snapshot,questions_snapshot,answers_snapshot,origin_channel,created_at)
 SELECT gen_random_uuid(),$2,c.id,v.id,$3,'manual',$4,'{`+snapshot00061Fields+`,"professional_title":"Frozen"}','[]','[]','manual',now()-interval '1 day'
 FROM company_candidates c JOIN company_candidate_cvs v ON v.company_candidate_id=c.id WHERE c.company_id=$1 AND c.full_name LIKE 'Bulk %'`, f.company.companyID, root, replStages(root)["new"], f.owner.userID)

	body := f.chainOK(root)
	list := replList(t, body["carry_candidates"])
	first, last := replObject(t, replObject(t, list[0])["candidate"]), replObject(t, replObject(t, list[len(list)-1])["candidate"])
	if len(list) != 1000 || body["carry_candidates_truncated"] != true || first["full_name"] != "Bulk 00001" || last["full_name"] != "Bulk 01000" {
		t.Fatalf("%d candidates, truncated %v, first %v, last %v", len(list), body["carry_candidates_truncated"], first, last)
	}
	// The fallen hire is one of the 1002 candidates; remove two so exactly 1000 remain: not truncated.
	f.exec(`DELETE FROM process_participations WHERE company_candidate_id IN (SELECT id FROM company_candidates WHERE company_id=$1 AND full_name IN ('Bulk 00001','Bulk 00002'))`, f.company.companyID)
	body = f.chainOK(root)
	if list = replList(t, body["carry_candidates"]); len(list) != 1000 || body["carry_candidates_truncated"] != false {
		t.Fatalf("%d candidates, truncated %v", len(list), body["carry_candidates_truncated"])
	}
}

func TestReplacementListPermissions(t *testing.T) {
	f := newCarryFlow(t)
	recruiterID, recruiterSub := f.company.addUser(t, "recruiter")
	recruiter := f.h.actor(t, recruiterID, recruiterSub)
	outsiderID, outsiderSub := f.company.addUser(t, "recruiter")
	outsider := f.h.actor(t, outsiderID, outsiderSub)
	stakeholderID, stakeholderSub := f.company.addUser(t, "stakeholder")
	stakeholder := f.h.actor(t, stakeholderID, stakeholderSub)
	_, foreignID, foreignSub := draftFlowNewPrincipal(t, f.h.pool, "active")
	foreign := f.h.actor(t, foreignID, foreignSub)

	root, credits, _ := f.fallenChain(1)
	repl := f.startOK(root, replBody(t, "", credits[0]))["id"].(string)
	// The recruiter has a tramo on the original only.
	f.exec(`INSERT INTO vacancy_assignments(id,draft_id,company_id,user_id,started_at,start_cause) VALUES(gen_random_uuid(),$1,$2,$3,now(),'backfill')`, root, f.company.companyID, recruiterID)

	// Same access as GET V/lifecycle: the same status for the same actor, on either process of the chain.
	for _, tc := range []struct {
		name, token string
		status      int
		code        string
	}{{"no tramo", outsider.token, 404, "not_found"}, {"other company", foreign.token, 404, "not_found"}, {"stakeholder", stakeholder.token, 403, "forbidden"}, {"no session", "", 401, ""}} {
		for _, id := range []string{root, repl, uuid.NewString()} {
			got := f.chain(id, tc.token)
			lifecycle := f.h.do(t, "GET", draftFlowV2Path+"/"+id+"/lifecycle", "", tc.token, nil)
			if got.status != tc.status || lifecycle.status != tc.status {
				t.Fatalf("%s %s: replacements %d %s, lifecycle %d", tc.name, id, got.status, got.body, lifecycle.status)
			}
			if tc.code != "" {
				draftFlowAssertCatalogError(t, got, tc.status, tc.code)
			}
		}
	}
	if got := f.chain("not-a-uuid", f.owner.token); got.status != 400 {
		t.Fatalf("a malformed id: %d %s", got.status, got.body)
	}

	// With a tramo on the original the recruiter reads the whole chain, and can_open says what they may open.
	got := f.chain(repl, recruiter.token)
	if got.status != 404 {
		t.Fatalf("a tramo on the original does not open the replacement: %d %s", got.status, got.body)
	}
	got = f.chain(root, recruiter.token)
	if got.status != 200 {
		t.Fatalf("recruiter with a tramo: %d %s", got.status, got.body)
	}
	items := replList(t, draftFlowObject(t, got.body)["items"])
	if len(items) != 2 || replObject(t, items[0])["can_open"] != true || replObject(t, items[1])["can_open"] != false {
		t.Fatalf("can_open = %v", items)
	}
	// The owner may open every process.
	for _, v := range replList(t, f.chainOK(root)["items"]) {
		if replObject(t, v)["can_open"] != true {
			t.Fatalf("owner item = %v", v)
		}
	}
}
