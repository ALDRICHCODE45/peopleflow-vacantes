//go:build integration

package main

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/audit_events/infrastructure/postgres/audittest"
	"github.com/google/uuid"
)

// Regression probes from the independent 2b verification (audit-log-v1 §7, §8)
// and the fixes it asked for.

// csvByEntity indexes an export by entity_id (column 8); the rows seeded here
// have distinct entity ids.
func csvByEntity(t *testing.T, body []byte) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	for _, row := range parseCSV(t, body)[1:] {
		out[row[8]] = row
	}
	return out
}

func probeExec(t *testing.T, h *draftFlowHarness, query string, args ...any) {
	t.Helper()
	if _, err := h.pool.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}

func probeDay(t *testing.T, s *auditScreen, day string) string {
	t.Helper()
	return `{"from":"` + day + `","to":"` + day + `"}`
}

// The member label is a name of a person: it resolves only for someone who
// belongs, or belonged, to the caller's company. A row carrying another
// company's user id shows no name, in the list and in the CSV.
func TestVerify2b_MemberLabelNeverResolvesAnotherCompany(t *testing.T) {
	a, b := newAuditScreen(t), newAuditScreen(t)
	company := a.company.companyID
	foreignName := "Beatriz Ajena"
	setUserName(t, b.h, b.owner.userID, foreignName, uniqueEmail("beatriz"))

	// A former member who acted in A, and one who only appears in member events.
	actedID, _ := a.company.addUser(t, "recruiter")
	setUserName(t, a.h, actedID, "Fabián Ex", uniqueEmail("fabian"))
	pairID, _ := a.company.addUser(t, "recruiter")
	setUserName(t, a.h, pairID, "Paula Pareja", uniqueEmail("paula"))
	if _, err := a.h.pool.Exec(context.Background(), `DELETE FROM company_members WHERE user_id = ANY($1)`, []uuid.UUID{actedID, pairID}); err != nil {
		t.Fatal(err)
	}

	base := time.Date(2025, 3, 10, 15, 0, 0, 0, time.UTC)
	n := 0
	member := func(eventType string, memberID uuid.UUID, actor *uuid.UUID) uuid.UUID {
		n++
		entity := uuid.Must(uuid.NewV7())
		seedAudit(t, a.h, company, auditSeed{at: base.Add(time.Duration(n) * time.Minute), actor: actor, eventType: eventType, entityType: "company_member", entity: entity,
			metadata: fmt.Sprintf(`{"member_user_id":%q}`, memberID)})
		return entity
	}
	seedAudit(t, a.h, company, auditSeed{at: base, actor: &actedID, eventType: "SessionEnded", entityType: "user", entity: actedID})
	current := member("CompanyMemberRoleChanged", a.recruiter.userID, &a.owner.userID)
	acted := member("CompanyMemberOffboarded", actedID, &a.owner.userID)
	pairAdded := member("CompanyMemberAdded", pairID, &a.owner.userID)
	pairGone := member("CompanyMemberOffboarded", pairID, &a.owner.userID)
	foreign := member("CompanyMemberAdded", b.owner.userID, &a.owner.userID)

	want := map[uuid.UUID]any{
		current:   "Rosa Reclutadora", // current member
		acted:     "Fabián Ex",        // former member, appears as an actor of the company
		pairAdded: "Paula Pareja",     // former member known by two member events
		pairGone:  "Paula Pareja",
		foreign:   nil, // another company's user: no name
	}
	items := itemsOf(t, a.list(t, "limit=100"))
	seen := 0
	for _, item := range items {
		if want2, ok := want[uuid.MustParse(item["entity"].(map[string]any)["id"].(string))]; ok {
			seen++
			if got := item["entity"].(map[string]any)["label"]; got != want2 {
				t.Errorf("list label of %v = %v, want %v", item["entity"].(map[string]any)["id"], got, want2)
			}
		}
	}
	if seen != len(want) {
		t.Fatalf("saw %d of %d member rows", seen, len(want))
	}
	r := a.export(t, probeDay(t, a, "2025-03-10"))
	if r.status != 200 {
		t.Fatalf("export %d %s", r.status, r.body)
	}
	if strings.Contains(string(r.body), foreignName) {
		t.Fatal("the export carries another company's person name")
	}
	rows := csvByEntity(t, r.body)
	for id, w := range want {
		wantCell := ""
		if w != nil {
			wantCell = w.(string)
		}
		if got := rows[id.String()][9]; got != wantCell {
			t.Errorf("csv entity_label of %s = %q, want %q", id, got, wantCell)
		}
	}
}

// Rows of company A that point at company B's entities resolve no label and no
// vacancy title anywhere: list, CSV and /vacancies.
func TestVerify2b_LabelsNeverResolveAnotherCompany(t *testing.T) {
	a, b := newAuditScreen(t), newAuditScreen(t)
	company := a.company.companyID
	candidate := uuid.Must(uuid.NewV7())
	probeExec(t, b.h, `INSERT INTO company_candidates(id,company_id,full_name,email,email_normalized,country_code,created_by) VALUES($1,$2,'Candidata Ajena',$3,$3,'US',$4)`,
		candidate, b.company.companyID, "ajena-"+candidate.String()+"@example.test", b.owner.userID)
	t.Cleanup(func() { probeExec(t, b.h, `DELETE FROM company_candidates WHERE id=$1`, candidate) })
	foreignVacancy := seedVacancy(t, b.h, b.company.companyID, b.owner.userID, "Vacante Ajena")

	base := time.Date(2025, 3, 10, 15, 0, 0, 0, time.UTC)
	seeded := map[uuid.UUID]bool{}
	seed := func(i int, eventType, entityType string, entity uuid.UUID, vacancy *uuid.UUID) {
		id := seedAudit(t, a.h, company, auditSeed{at: base.Add(time.Duration(i) * time.Minute), actor: &a.owner.userID, eventType: eventType, entityType: entityType, entity: entity, vacancy: vacancy})
		seeded[id] = true
	}
	seed(1, "CompanyCandidateViewed", "company_candidate", candidate, nil)
	seed(2, "CompanyCandidateEdited", "company_candidate", b.owner.userID, nil) // an account of B
	seed(3, "CompanyUpdated", "company", b.company.companyID, nil)
	seed(4, "VacancyPaused", "job_draft", foreignVacancy, &foreignVacancy)
	seed(5, "VacancyTeamCreated", "vacancy", foreignVacancy, &foreignVacancy)
	seed(6, "VacancyDeliveryFulfilled", "vacancy_process", foreignVacancy, &foreignVacancy)

	items := itemsOf(t, a.list(t, "limit=100"))
	count := 0
	for _, item := range items {
		if !seeded[uuid.MustParse(item["id"].(string))] {
			continue
		}
		count++
		if label := item["entity"].(map[string]any)["label"]; label != nil {
			t.Errorf("%v: entity.label = %v, want null", item["event_type"], label)
		}
		if v, ok := item["vacancy"].(map[string]any); ok && v["title"] != nil {
			t.Errorf("%v: vacancy.title = %v, want null", item["event_type"], v["title"])
		}
	}
	if count != len(seeded) {
		t.Fatalf("listed %d of %d seeded rows", count, len(seeded))
	}

	r := a.export(t, probeDay(t, a, "2025-03-10"))
	if r.status != 200 {
		t.Fatalf("export %d %s", r.status, r.body)
	}
	for _, name := range []string{"Candidata Ajena", "Vacante Ajena", companyNameOf(t, b)} {
		if strings.Contains(string(r.body), name) {
			t.Errorf("the export carries %q from another company", name)
		}
	}
	for _, row := range parseCSV(t, r.body)[1:] {
		if row[9] != "" || row[11] != "" {
			t.Errorf("csv %s: entity_label=%q vacancy_title=%q, want both empty", row[2], row[9], row[11])
		}
	}

	rv := a.get(t, "/vacancies")
	if rv.status != 200 {
		t.Fatalf("/vacancies %d %s", rv.status, rv.body)
	}
	options := itemsOf(t, draftFlowObject(t, rv.body))
	if len(options) != 1 || options[0]["vacancy_id"] != foreignVacancy.String() || options[0]["title"] != nil {
		t.Fatalf("/vacancies = %v", options)
	}
}

// from and to are whole days in America/Mexico_City (UTC-6 in July): the day
// starts at 06:00:00Z inclusive and ends at the next 06:00:00Z exclusive.
func TestVerify2b_MexicoCityDayBoundaries(t *testing.T) {
	s := newAuditScreen(t)
	company := s.company.companyID
	at := func(v string) time.Time {
		ts, err := time.Parse(time.RFC3339Nano, v)
		if err != nil {
			t.Fatal(err)
		}
		return ts
	}
	seed := func(v string) uuid.UUID {
		return seedAudit(t, s.h, company, auditSeed{at: at(v), eventType: "CompanyUpdated"})
	}
	seed("2025-07-10T05:59:59.999Z")
	start := seed("2025-07-10T06:00:00Z")
	end := seed("2025-07-11T05:59:59.999Z")
	seed("2025-07-11T06:00:00Z")

	page := s.list(t, "from=2025-07-10&to=2025-07-10")
	got := idsOf(itemsOf(t, page))
	if want := []string{end.String(), start.String()}; !reflect.DeepEqual(got, want) || page["total"] != float64(2) {
		t.Fatalf("list = %v total %v, want %v", got, page["total"], want)
	}
	r := s.export(t, probeDay(t, s, "2025-07-10"))
	if r.status != 200 {
		t.Fatalf("export %d %s", r.status, r.body)
	}
	if rows := parseCSV(t, r.body); len(rows) != 3 {
		t.Fatalf("export has %d lines, want header + 2", len(rows))
	}
}

// A client that disconnects in the middle of a large export gives its database
// connection back, and later exports are complete.
func TestVerify2b_RealMidStreamAbort(t *testing.T) {
	const total = 45_000
	s := newAuditScreen(t)
	company := s.company.companyID
	ctx := context.Background()
	t.Cleanup(func() {
		if err := audittest.Delete(ctx, s.h.pool, `DELETE FROM audit_events WHERE company_id=$1`, company); err != nil {
			t.Error(err)
		}
	})
	// 2025-03-10T06:00:00Z + i seconds stays inside the Mexico City day 2025-03-10.
	if _, err := s.h.pool.Exec(ctx, `INSERT INTO audit_events (id, occurred_at, actor_type, event_type, entity_type, entity_id, metadata, company_id, user_agent)
SELECT gen_random_uuid(), timestamptz '2025-03-10 06:00:00+00' + g * interval '1 second', 'system', 'CompanyUpdated', 'company', $1, '{}'::jsonb, $1, repeat('x', 400)
FROM generate_series(0, $2::int - 1) g`, company, total); err != nil {
		t.Fatal(err)
	}

	post := func() (*http.Response, error) {
		req, err := http.NewRequest("POST", s.h.server.URL+auditEventsPath+"/export", strings.NewReader(probeDay(t, s, "2025-03-10")))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+s.owner.token)
		req.Header.Set("Content-Type", "application/json")
		return s.h.client.Do(req)
	}
	resp, err := post()
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Fatalf("status %d", resp.StatusCode)
	}
	if _, err := bufio.NewReader(resp.Body).ReadString('\n'); err != nil {
		t.Fatalf("first line: %v", err)
	}
	resp.Body.Close()

	deadline := time.Now().Add(10 * time.Second)
	for s.h.pool.Stat().AcquiredConns() != 0 {
		if time.Now().After(deadline) {
			t.Fatalf("the aborted export still holds %d connections after 10s", s.h.pool.Stat().AcquiredConns())
		}
		time.Sleep(50 * time.Millisecond)
	}

	for i := 0; i < 3; i++ {
		r := s.export(t, probeDay(t, s, "2025-03-10"))
		if r.status != 200 {
			t.Fatalf("export %d: %d", i, r.status)
		}
		if lines := strings.Count(string(r.body), "\n"); lines != total+1 {
			t.Fatalf("export %d has %d lines, want %d", i, lines, total+1)
		}
	}
	if n := len(exportedRows(t, s)); n != 4 {
		t.Fatalf("AuditLogExported rows = %d, want 4 (the aborted export and three more)", n)
	}
}
