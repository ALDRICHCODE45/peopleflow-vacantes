// Command design-preview renders T1–T17 with the «03 · Centrada» layout and
// sends them to Mailpit through the smtpmail adapter (T10, S11). Scratch:
// not committed. Run from backend/:
//
//	go run ./internal/features/notifications/.design-preview [-run TAG] [-out DIR]
//
// Dark mode is client-side (prefers-color-scheme / [data-ogsc]): open the
// messages in a dark-mode client, or toggle the Mailpit UI theme for the shell.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email"
	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/email/smtpmail"
	"github.com/google/uuid"
)

type previewSigner struct{}

func (previewSigner) Sign(k domain.PreferenceKey) (string, error) {
	return "k1.preview-" + string(k.Type) + ".mac", nil
}

func s(v string) *string { return &v }

func main() {
	run := flag.String("run", time.Now().UTC().Format("20060102t150405"), "run tag (recipient preview+TAG@peopleflow.test)")
	out := flag.String("out", "internal/features/notifications/.design-preview", "directory for the rendered HTML of the sample templates")
	flag.Parse()

	r, err := email.NewRenderer(email.Settings{
		From:           "PeopleFlow <avisos@peopleflow.test>",
		AppBaseURL:     "http://localhost:3000",
		UnsubscribeURL: "http://localhost:3000/api/notificaciones/baja",
		PostalAddress:  os.Getenv("NOTIFICATIONS_EMAIL_POSTAL_ADDRESS"), // empty → placeholder
	}, previewSigner{})
	if err != nil {
		fail(err)
	}
	to := "preview+" + *run + "@peopleflow.test"
	user, company := uuid.New(), uuid.New()
	job, participation, invitation := uuid.New(), uuid.New(), uuid.New()
	mexico, _ := time.LoadLocation("America/Mexico_City")
	day := time.Date(2026, 11, 25, 19, 30, 0, 0, mexico)
	commitSoon := time.Date(2026, 11, 29, 0, 0, 0, 0, time.UTC)
	commitPast := time.Date(2026, 11, 24, 0, 0, 0, 0, time.UTC)

	member := func(tp domain.Type, title string, link *email.Link) email.View {
		return email.View{DeliveryID: uuid.New(), Type: tp, To: to, User: user, Company: company, Count: 1,
			Link: link, JobTitle: s(title), CompanyName: s("Grupo Altavista")}
	}
	candidate := func(tp domain.Type, title, companyName string, link *email.Link) email.View {
		return email.View{DeliveryID: uuid.New(), Type: tp, To: to, User: user, Count: 1,
			Link: link, JobTitle: s(title), CompanyName: s(companyName)}
	}
	part := &email.Link{Kind: email.LinkParticipation, JobID: job, ParticipationID: participation}
	cands := &email.Link{Kind: email.LinkVacancyCandidates, JobID: job}
	deliv := &email.Link{Kind: email.LinkVacancyDelivery, JobID: job}
	vac := &email.Link{Kind: email.LinkVacancy, JobID: job}
	app := &email.Link{Kind: email.LinkApplication, JobID: job, ParticipationID: participation}

	type item struct {
		id   string
		view email.View
	}
	var items []item
	add := func(id string, v email.View, edit func(*email.View)) {
		if edit != nil {
			edit(&v)
		}
		items = append(items, item{id, v})
	}
	add("t1", member(domain.TypeApplicationReceived, "Analista de Nómina", part), func(v *email.View) { v.Day = day })
	add("t2", member(domain.TypeApplicationReceived, "Analista de Nómina", cands), func(v *email.View) { v.Day, v.Count = day, 5 })
	add("t3", member(domain.TypePsychometricCompleted, "Ejecutivo de Ventas", part), nil)
	add("t4", member(domain.TypePsychometricCompleted, "Ejecutivo de Ventas", cands), func(v *email.View) { v.Count = 3 })
	add("t5", member(domain.TypePsychometricPending, "Auxiliar Contable", part), nil)
	add("t6", member(domain.TypePsychometricPending, "Auxiliar Contable", cands), func(v *email.View) { v.Count = 4 })
	add("t7", member(domain.TypeDeliveryDueSoon, "Supervisor de Almacén", deliv), func(v *email.View) { v.CommitmentDate = commitSoon })
	add("t8", member(domain.TypeDeliveryOverdue, "Supervisor de Almacén", deliv), func(v *email.View) { v.CommitmentDate = commitPast })
	add("t9", member(domain.TypeAssignmentDeadlineDueSoon, "Coordinador de Logística", deliv), func(v *email.View) { v.CommitmentDate, v.Function = commitSoon, "responsible" })
	add("t10", member(domain.TypeAssignmentDeadlineOverdue, "Coordinador de Logística", deliv), func(v *email.View) { v.CommitmentDate, v.Function = commitPast, "collaborator" })
	add("t11", member(domain.TypeVacancyAssigned, "Gerente de Recursos Humanos", vac), nil)
	add("t12", member(domain.TypeVacancyReassigned, "Coordinador de Logística", vac), func(v *email.View) { v.Reason = "workload" })
	add("t13", member(domain.TypeVacancyUnassigned, "Coordinador de Logística", nil), func(v *email.View) { v.Reason = "recruiter_departure" })
	add("t14", member(domain.TypeVacancyTeamAdded, "Desarrollador Backend", vac), func(v *email.View) { v.Function = "member" })
	add("t15", candidate(domain.TypeCandidateStatusChanged, "Analista de Nómina", "Grupo Altavista", app), func(v *email.View) { v.Status = "in_process" })
	add("t16", candidate(domain.TypeCandidateMessageReceived, "Recepcionista Bilingüe", "Hotelera del Pacífico", app), nil)
	add("t17", candidate(domain.TypeCandidateTestPending, "Auxiliar Contable", "Constructora Sierra Madre", &email.Link{Kind: email.LinkAssessment, InvitationID: invitation}), nil)

	mailer := smtpmail.New("127.0.0.1", 1025)
	save := map[string]bool{"t2": true, "t8": true, "t12": true, "t15": true, "t17": true}
	for _, it := range items {
		m, err := r.Render(it.view)
		if err != nil {
			fail(fmt.Errorf("%s: %w", it.id, err))
		}
		m.Headers["X-Tags"] = "design-preview," + *run
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if _, err := mailer.Send(ctx, m); err != nil {
			cancel()
			fail(fmt.Errorf("%s: %w", it.id, err))
		}
		cancel()
		footer := "F1"
		if domain.Locked(it.view.Type) {
			footer = "F2"
		}
		fmt.Printf("%-4s %-30s %s  %s\n", it.id, m.Template, footer, m.Subject)
		if save[it.id] {
			if err := os.WriteFile(filepath.Join(*out, "03-"+it.id+".html"), []byte(m.HTML), 0o644); err != nil {
				fail(err)
			}
		}
	}
	fmt.Printf("sent %d to %s (Mailpit http://127.0.0.1:8025, tag design-preview,%s)\n", len(items), to, *run)
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "design-preview:", err)
	os.Exit(1)
}
