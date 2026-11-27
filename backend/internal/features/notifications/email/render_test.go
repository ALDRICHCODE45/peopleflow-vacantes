package email

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
	"github.com/google/uuid"
)

const (
	testBase        = "https://app.peopleflow.test"
	testUnsubscribe = "https://app.peopleflow.test/api/notificaciones/baja"
	testFrom        = `"PeopleFlow" <no-reply@peopleflow.test>`
	testTo          = "persona@example.test"
)

var (
	testDelivery      = uuid.MustParse("11111111-1111-4111-8111-111111111111")
	testUser          = uuid.MustParse("22222222-2222-4222-8222-222222222222")
	testCompany       = uuid.MustParse("33333333-3333-4333-8333-333333333333")
	testJob           = uuid.MustParse("44444444-4444-4444-8444-444444444444")
	testParticipation = uuid.MustParse("55555555-5555-4555-8555-555555555555")
	testInvitation    = uuid.MustParse("66666666-6666-4666-8666-666666666666")
	// 2026-11-27 03:30 UTC is still 26 November in America/Mexico_City (UTC−6).
	testDay = time.Date(2026, 11, 27, 3, 30, 0, 0, time.UTC)
	// A DATE column value: its calendar components, never converted.
	testCommitment = time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC)
)

// fakeSigner stands in for the E7 HMAC signer.
type fakeSigner struct {
	calls []domain.PreferenceKey
	token string
	err   error
}

func (f *fakeSigner) Sign(k domain.PreferenceKey) (string, error) {
	f.calls = append(f.calls, k)
	if f.err != nil {
		return "", f.err
	}
	if f.token != "" {
		return f.token, nil
	}
	return "k1.payload-" + string(k.Type) + ".mac", nil
}

func newTestRenderer(t *testing.T, s TokenSigner) *Renderer {
	t.Helper()
	r, err := NewRenderer(Settings{From: testFrom, AppBaseURL: testBase, UnsubscribeURL: testUnsubscribe}, s)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func ptr(s string) *string { return &s }

func memberView(tp domain.Type) View {
	return View{
		DeliveryID: testDelivery, Type: tp, To: testTo, User: testUser, Company: testCompany,
		Count: 1, JobTitle: ptr("Analista de Datos"), CompanyName: ptr("Acme Talento"),
	}
}

func candidateView(tp domain.Type) View {
	v := memberView(tp)
	v.Company = uuid.Nil
	return v
}

func vacancyLink(kind LinkKind) *Link { return &Link{Kind: kind, JobID: testJob} }

var (
	pipelineURL      = testBase + "/empresa/vacantes/44444444-4444-4444-8444-444444444444/pipeline"
	participationURL = pipelineURL + "?candidato=55555555-5555-4555-8555-555555555555"
	deliveryURL      = testBase + "/empresa/vacantes/44444444-4444-4444-8444-444444444444/configuracion/entrega"
	applicationURL   = testBase + "/candidato/postulaciones?postulacion=55555555-5555-4555-8555-555555555555"
	assessmentURL    = testBase + "/candidato/evaluaciones/66666666-6666-4666-8666-666666666666"
	memberPrefsURL   = testBase + "/empresa/configuracion/notificaciones"
	candidatePrefs   = testBase + "/candidato/configuracion/notificaciones"
)

const (
	f1Line = "Recibes este correo porque este aviso está activado en tus preferencias."
	f2Line = "Este aviso es obligatorio y no se puede desactivar."
)

type golden struct {
	name                           string
	view                           View
	template                       string
	subject, heading, line, button string
	appURL, prefsURL               string
	mandatory                      bool
}

// goldens covers T1–T17 with the verbatim copy of §Templates (T13 per L8),
// labels, fallbacks, Mexico City dates and the Q3 path map.
func goldens() []golden {
	participation := &Link{Kind: LinkParticipation, JobID: testJob, ParticipationID: testParticipation}
	application := &Link{Kind: LinkApplication, JobID: testJob, ParticipationID: testParticipation}
	assessment := &Link{Kind: LinkAssessment, InvitationID: testInvitation}

	t1 := memberView(domain.TypeApplicationReceived)
	t1.Link, t1.Day = participation, testDay
	t2 := memberView(domain.TypeApplicationReceived)
	t2.Link, t2.Day, t2.Count = vacancyLink(LinkVacancyCandidates), testDay, 3
	t3 := memberView(domain.TypePsychometricCompleted)
	t3.Link = participation
	t4 := memberView(domain.TypePsychometricCompleted)
	t4.Link, t4.Count = vacancyLink(LinkVacancyCandidates), 2
	t5 := memberView(domain.TypePsychometricPending)
	t5.Link = participation
	t6 := memberView(domain.TypePsychometricPending)
	t6.Link, t6.Count = vacancyLink(LinkVacancyCandidates), 4
	t7 := memberView(domain.TypeDeliveryDueSoon)
	t7.Link, t7.CommitmentDate = vacancyLink(LinkVacancyDelivery), testCommitment
	t8 := memberView(domain.TypeDeliveryOverdue)
	t8.Link, t8.CommitmentDate = vacancyLink(LinkVacancyDelivery), testCommitment
	t9 := memberView(domain.TypeAssignmentDeadlineDueSoon)
	t9.Link, t9.CommitmentDate, t9.Function = vacancyLink(LinkVacancyDelivery), testCommitment, "responsible"
	t10 := memberView(domain.TypeAssignmentDeadlineOverdue)
	t10.Link, t10.CommitmentDate, t10.Function = vacancyLink(LinkVacancyDelivery), testCommitment, "collaborator"
	t11 := memberView(domain.TypeVacancyAssigned)
	t11.Link = vacancyLink(LinkVacancy)
	t12 := memberView(domain.TypeVacancyReassigned)
	t12.Link, t12.Reason = vacancyLink(LinkVacancy), "workload"
	t13 := memberView(domain.TypeVacancyUnassigned)
	t13.Link, t13.Reason = vacancyLink(LinkVacancy), "recruiter_departure"
	t14 := memberView(domain.TypeVacancyTeamAdded)
	t14.Link, t14.Function = vacancyLink(LinkVacancy), "member"
	t15 := candidateView(domain.TypeCandidateStatusChanged)
	t15.Link, t15.Status = application, "in_process"
	t16 := candidateView(domain.TypeCandidateMessageReceived)
	t16.Link = application
	t17 := candidateView(domain.TypeCandidateTestPending)
	t17.Link = assessment

	return []golden{
		{"T1", t1, "application_received.one", "Nueva postulación en Analista de Datos", "Nueva postulación en Analista de Datos", "Recibiste una postulación nueva el 26 de noviembre de 2026.", "Ver candidatos", participationURL, memberPrefsURL, false},
		{"T2", t2, "application_received.many", "3 postulaciones nuevas en Analista de Datos", "3 postulaciones nuevas en Analista de Datos", "Llegaron 3 postulaciones nuevas el 26 de noviembre de 2026.", "Ver candidatos", pipelineURL, memberPrefsURL, false},
		{"T3", t3, "psychometric_completed.one", "Prueba psicométrica completada en Analista de Datos", "Prueba psicométrica completada", "Un candidato de Analista de Datos terminó su prueba psicométrica.", "Ver resultado", participationURL, memberPrefsURL, false},
		{"T4", t4, "psychometric_completed.many", "2 pruebas psicométricas completadas en Analista de Datos", "2 pruebas psicométricas completadas", "2 candidatos de Analista de Datos terminaron su prueba psicométrica.", "Ver candidatos", pipelineURL, memberPrefsURL, false},
		{"T5", t5, "psychometric_pending.one", "Prueba psicométrica pendiente en Analista de Datos", "Prueba psicométrica pendiente", "Se envió una prueba psicométrica a un candidato de Analista de Datos y aún no la responde.", "Ver candidato", participationURL, memberPrefsURL, false},
		{"T6", t6, "psychometric_pending.many", "4 pruebas psicométricas pendientes en Analista de Datos", "4 pruebas psicométricas pendientes", "Se enviaron 4 pruebas psicométricas a candidatos de Analista de Datos y aún no las responden.", "Ver candidatos", pipelineURL, memberPrefsURL, false},
		{"T7", t7, "delivery_due_soon", "La entrega de Analista de Datos vence pronto", "La entrega vence pronto", "La fecha compromiso de Analista de Datos es el 1 de diciembre de 2026.", "Ver entrega", deliveryURL, memberPrefsURL, false},
		{"T8", t8, "delivery_overdue", "La entrega de Analista de Datos está vencida", "La entrega está vencida", "La fecha compromiso de Analista de Datos era el 1 de diciembre de 2026.", "Ver entrega", deliveryURL, memberPrefsURL, true},
		{"T9", t9, "assignment_deadline_due_soon", "Tu fecha límite en Analista de Datos se acerca", "Tu fecha límite se acerca", "Como responsable de Analista de Datos, tu entrega vence el 1 de diciembre de 2026.", "Ver entrega", deliveryURL, memberPrefsURL, false},
		{"T10", t10, "assignment_deadline_overdue", "Venció tu fecha límite en Analista de Datos", "Venció tu fecha límite", "Tu entrega como colaborador de Analista de Datos era el 1 de diciembre de 2026.", "Ver entrega", deliveryURL, memberPrefsURL, true},
		{"T11", t11, "vacancy_assigned", "Te asignaron Analista de Datos", "Te asignaron una vacante", "Ahora eres responsable de Analista de Datos en Acme Talento.", "Abrir vacante", pipelineURL, memberPrefsURL, true},
		{"T12", t12, "vacancy_reassigned", "Ahora eres responsable de Analista de Datos", "Te reasignaron una vacante", "Ahora eres responsable de Analista de Datos. Motivo: carga de trabajo.", "Abrir vacante", pipelineURL, memberPrefsURL, true},
		{"T13", t13, "vacancy_unassigned", "Ya no eres responsable de Analista de Datos", "Se reasignó una vacante", "Otra persona quedó a cargo de Analista de Datos. Motivo: salida del reclutador.", "Ir a PeopleFlow", pipelineURL, memberPrefsURL, true},
		{"T14", t14, "vacancy_team_added", "Te agregaron al equipo de Analista de Datos", "Te agregaron a un equipo", "Formas parte del equipo de Analista de Datos como integrante.", "Abrir vacante", pipelineURL, memberPrefsURL, true},
		{"T15", t15, "candidate_status_changed", "Tu postulación a Analista de Datos cambió de estado", "Tu postulación ahora está «En proceso»", "Acme Talento actualizó tu proceso para Analista de Datos.", "Ver postulación", applicationURL, candidatePrefs, false},
		{"T16", t16, "candidate_message_received", "Acme Talento te dejó un mensaje", "Tienes un mensaje sobre tu postulación", "Acme Talento te escribió sobre Analista de Datos. Por privacidad no lo incluimos aquí; léelo en PeopleFlow.", "Leer mensaje", applicationURL, candidatePrefs, false},
		{"T17", t17, "candidate_test_pending", "Tienes una prueba psicométrica pendiente", "Tienes una prueba pendiente", "Acme Talento te envió una prueba psicométrica para Analista de Datos.", "Empezar prueba", assessmentURL, candidatePrefs, false},
	}
}

func unsubscribeLanding(tp domain.Type) string {
	return testBase + "/notificaciones/baja?token=k1.payload-" + string(tp) + ".mac"
}

// expectedText is the plain-text layout: heading, line, button + link, then
// the footer (F1 with both links, F2 with «Mis preferencias» only).
func expectedText(g golden) string {
	var b strings.Builder
	b.WriteString(g.heading + "\n\n" + g.line + "\n\n" + g.button + ": " + g.appURL + "\n\n--\n")
	if g.mandatory {
		b.WriteString(f2Line + "\nMis preferencias: " + g.prefsURL + "\n")
	} else {
		b.WriteString(f1Line + "\nMis preferencias: " + g.prefsURL + "\nDejar de recibir este tipo de correo: " + unsubscribeLanding(g.view.Type) + "\n")
	}
	return b.String()
}

func TestRenderGoldenPerTemplate(t *testing.T) {
	gs := goldens()
	if len(gs) != 17 {
		t.Fatalf("%d goldens, want 17", len(gs))
	}
	for _, g := range gs {
		t.Run(g.name, func(t *testing.T) {
			signer := &fakeSigner{}
			m, err := newTestRenderer(t, signer).Render(g.view)
			if err != nil {
				t.Fatal(err)
			}
			if m.Subject != g.subject {
				t.Errorf("subject\n got %q\nwant %q", m.Subject, g.subject)
			}
			if m.Text != expectedText(g) {
				t.Errorf("text\n got %q\nwant %q", m.Text, expectedText(g))
			}
			if m.Template != g.template || m.Type != string(g.view.Type) || m.DeliveryID != testDelivery.String() {
				t.Errorf("meta template=%q type=%q delivery=%q", m.Template, m.Type, m.DeliveryID)
			}
			if m.To != testTo || m.From != testFrom {
				t.Errorf("to=%q from=%q", m.To, m.From)
			}
			if m.MessageID != "<11111111-1111-4111-8111-111111111111@peopleflow.test>" {
				t.Errorf("message id %q", m.MessageID)
			}
			// HTML part: same copy, escaped (no special characters here), links
			// as anchors; the body line with its emphasis is checked in
			// TestRenderBodyEmphasis (design 03 · Centrada).
			for _, want := range []string{
				`<html lang="es-MX"`,
				">" + g.heading + "</h1>",
				`<a href="` + htmlAttr(g.appURL) + `"`, ">" + g.button + "</a>",
				`<a href="` + g.prefsURL + `"`, ">Mis preferencias</a>",
				"<title>" + g.subject + "</title>",
			} {
				if !strings.Contains(m.HTML, want) {
					t.Errorf("html lacks %q\n%s", want, m.HTML)
				}
			}
			landing := `<a href="` + htmlAttr(unsubscribeLanding(g.view.Type)) + `"`
			if g.mandatory {
				if !strings.Contains(m.HTML, f2Line) || strings.Contains(m.HTML, f1Line) || strings.Contains(m.HTML, "Dejar de recibir") {
					t.Errorf("mandatory footer wrong\n%s", m.HTML)
				}
				if len(signer.calls) != 0 {
					t.Errorf("token issued for a mandatory type: %v", signer.calls)
				}
				if _, ok := m.Headers["List-Unsubscribe"]; ok {
					t.Error("List-Unsubscribe on a mandatory type")
				}
				if _, ok := m.Headers["List-Unsubscribe-Post"]; ok {
					t.Error("List-Unsubscribe-Post on a mandatory type")
				}
			} else {
				if !strings.Contains(m.HTML, f1Line) || !strings.Contains(m.HTML, landing) || !strings.Contains(m.HTML, ">Dejar de recibir este tipo de correo</a>") || strings.Contains(m.HTML, f2Line) {
					t.Errorf("optional footer wrong\n%s", m.HTML)
				}
				wantKey := domain.PreferenceKey{User: testUser, Company: g.view.Company, Type: g.view.Type}
				if len(signer.calls) != 1 || signer.calls[0] != wantKey {
					t.Errorf("signer calls %v, want [%v]", signer.calls, wantKey)
				}
				if got := m.Headers["List-Unsubscribe"]; got != "<"+testUnsubscribe+"?token=k1.payload-"+string(g.view.Type)+".mac>" {
					t.Errorf("List-Unsubscribe %q", got)
				}
				if got := m.Headers["List-Unsubscribe-Post"]; got != "List-Unsubscribe=One-Click" {
					t.Errorf("List-Unsubscribe-Post %q", got)
				}
			}
			if m.Headers["Auto-Submitted"] != "auto-generated" {
				t.Errorf("Auto-Submitted %q", m.Headers["Auto-Submitted"])
			}
			wantHeaders := 1
			if !g.mandatory {
				wantHeaders = 3
			}
			if len(m.Headers) != wantHeaders {
				t.Errorf("headers %v", m.Headers)
			}
		})
	}
}

// htmlAttr is how html/template writes a URL in an attribute (& → &amp;).
func htmlAttr(s string) string { return strings.ReplaceAll(s, "&", "&amp;") }

// Full literal goldens for two templates (group form, F1; mandatory T13, F2).
func TestRenderLiteralGoldens(t *testing.T) {
	gs := goldens()
	m, err := newTestRenderer(t, &fakeSigner{}).Render(gs[1].view)
	if err != nil {
		t.Fatal(err)
	}
	wantT2 := "3 postulaciones nuevas en Analista de Datos\n\n" +
		"Llegaron 3 postulaciones nuevas el 26 de noviembre de 2026.\n\n" +
		"Ver candidatos: https://app.peopleflow.test/empresa/vacantes/44444444-4444-4444-8444-444444444444/pipeline\n\n" +
		"--\n" +
		"Recibes este correo porque este aviso está activado en tus preferencias.\n" +
		"Mis preferencias: https://app.peopleflow.test/empresa/configuracion/notificaciones\n" +
		"Dejar de recibir este tipo de correo: https://app.peopleflow.test/notificaciones/baja?token=k1.payload-application_received.mac\n"
	if m.Subject != "3 postulaciones nuevas en Analista de Datos" || m.Text != wantT2 {
		t.Fatalf("T2 subject %q text\n%s", m.Subject, m.Text)
	}

	t13 := gs[12].view
	t13.Link = nil // the recipient can no longer open the vacancy (v1 D19)
	t13.JobTitle = nil
	m, err = newTestRenderer(t, &fakeSigner{}).Render(t13)
	if err != nil {
		t.Fatal(err)
	}
	wantT13 := "Se reasignó una vacante\n\n" +
		"Otra persona quedó a cargo de una vacante. Motivo: salida del reclutador.\n\n" +
		"Ir a PeopleFlow: https://app.peopleflow.test/empresa\n\n" +
		"--\n" +
		"Este aviso es obligatorio y no se puede desactivar.\n" +
		"Mis preferencias: https://app.peopleflow.test/empresa/configuracion/notificaciones\n"
	if m.Subject != "Ya no eres responsable de una vacante" || m.Text != wantT13 {
		t.Fatalf("T13 subject %q text\n%s", m.Subject, m.Text)
	}
}

func TestRenderLabels(t *testing.T) {
	r := newTestRenderer(t, &fakeSigner{})
	functions := map[string]string{"responsible": "responsable", "collaborator": "colaborador", "member": "integrante"}
	for code, label := range functions {
		v := memberView(domain.TypeVacancyTeamAdded)
		v.Link, v.Function = vacancyLink(LinkVacancy), code
		m, err := r.Render(v)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(m.Text, "Formas parte del equipo de Analista de Datos como "+label+".\n") {
			t.Errorf("function %s: %q", code, m.Text)
		}
	}
	reasons := map[string]string{"workload": "carga de trabajo", "recruiter_departure": "salida del reclutador", "performance": "desempeño", "client_request": "solicitud del cliente", "other": "otro motivo"}
	for code, label := range reasons {
		v := memberView(domain.TypeVacancyReassigned)
		v.Link, v.Reason = vacancyLink(LinkVacancy), code
		m, err := r.Render(v)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(m.Text, "Motivo: "+label+".\n") {
			t.Errorf("reason %s: %q", code, m.Text)
		}
	}
	statuses := map[string]string{"submitted": "Enviada", "in_process": "En proceso", "closed": "Cerrada"}
	for code, label := range statuses {
		v := candidateView(domain.TypeCandidateStatusChanged)
		v.Link = &Link{Kind: LinkApplication, JobID: testJob, ParticipationID: testParticipation}
		v.Status = code
		m, err := r.Render(v)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(m.Text, "Tu postulación ahora está «"+label+"»\n") {
			t.Errorf("status %s: %q", code, m.Text)
		}
	}
}

// Unknown label codes fail the render: a free-text value never reaches the mail.
func TestRenderRejectsUnknownLabelCodes(t *testing.T) {
	r := newTestRenderer(t, &fakeSigner{})
	team := memberView(domain.TypeVacancyTeamAdded)
	team.Link, team.Function = vacancyLink(LinkVacancy), "Juan Pérez"
	reassigned := memberView(domain.TypeVacancyReassigned)
	reassigned.Link, reassigned.Reason = vacancyLink(LinkVacancy), "nota libre del reclutador"
	status := candidateView(domain.TypeCandidateStatusChanged)
	status.Link, status.Status = &Link{Kind: LinkApplication, JobID: testJob, ParticipationID: testParticipation}, "discarded"
	for name, v := range map[string]View{"function": team, "reason": reassigned, "status": status} {
		if _, err := r.Render(v); err == nil {
			t.Errorf("%s: unknown code rendered", name)
		}
	}
}

func TestRenderFallbacks(t *testing.T) {
	r := newTestRenderer(t, &fakeSigner{})
	v := memberView(domain.TypeVacancyAssigned)
	v.Link, v.JobTitle, v.CompanyName = vacancyLink(LinkVacancy), nil, nil
	m, err := r.Render(v)
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Te asignaron una vacante" || !strings.Contains(m.Text, "Ahora eres responsable de una vacante en una empresa.\n") {
		t.Fatalf("fallbacks: %q / %q", m.Subject, m.Text)
	}
	// Blank values are treated as missing.
	c := candidateView(domain.TypeCandidateMessageReceived)
	c.Link = &Link{Kind: LinkApplication, JobID: testJob, ParticipationID: testParticipation}
	c.JobTitle, c.CompanyName = ptr("   "), ptr("")
	m, err = r.Render(c)
	if err != nil {
		t.Fatal(err)
	}
	if m.Subject != "Una empresa te dejó un mensaje" || !strings.Contains(m.Text, "Una empresa te escribió sobre una vacante.") {
		t.Fatalf("blank fallbacks: %q / %q", m.Subject, m.Text)
	}
}

// Candidate items with a null link (no participation / invalid invitation)
// open the applications list (L6); vacancy_unassigned null → /empresa (L5).
func TestRenderNullLinkRules(t *testing.T) {
	r := newTestRenderer(t, &fakeSigner{})
	for _, tp := range []domain.Type{domain.TypeCandidateStatusChanged, domain.TypeCandidateMessageReceived, domain.TypeCandidateTestPending} {
		v := candidateView(tp)
		v.Status = "submitted"
		m, err := r.Render(v)
		if err != nil {
			t.Fatalf("%s: %v", tp, err)
		}
		if !strings.Contains(m.Text, ": "+testBase+"/candidato/postulaciones\n") {
			t.Errorf("%s: %q", tp, m.Text)
		}
	}
	v := memberView(domain.TypeVacancyUnassigned)
	v.Reason = "other"
	m, err := r.Render(v)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.Text, "Ir a PeopleFlow: "+testBase+"/empresa\n") || !strings.Contains(m.HTML, `href="`+testBase+`/empresa"`) {
		t.Errorf("T13 null link: %q", m.Text)
	}
	// Every other type needs its link.
	for _, tp := range []domain.Type{domain.TypeApplicationReceived, domain.TypeDeliveryOverdue, domain.TypeVacancyAssigned, domain.TypeVacancyTeamAdded, domain.TypePsychometricPending} {
		v := memberView(tp)
		v.Day, v.CommitmentDate, v.Function = testDay, testCommitment, "member"
		if _, err := r.Render(v); err == nil {
			t.Errorf("%s rendered without a link", tp)
		}
	}
}

// Link kinds must belong to the type and carry their ids.
func TestRenderRejectsInconsistentViews(t *testing.T) {
	r := newTestRenderer(t, &fakeSigner{})
	cases := map[string]View{}

	wrongKind := memberView(domain.TypeDeliveryDueSoon)
	wrongKind.Link, wrongKind.CommitmentDate = vacancyLink(LinkVacancy), testCommitment
	cases["kind of another type"] = wrongKind

	noParticipation := memberView(domain.TypeApplicationReceived)
	noParticipation.Link, noParticipation.Day = &Link{Kind: LinkParticipation, JobID: testJob}, testDay
	cases["participation without id"] = noParticipation

	noJob := memberView(domain.TypeVacancyAssigned)
	noJob.Link = &Link{Kind: LinkVacancy}
	cases["vacancy without job"] = noJob

	noInvitation := candidateView(domain.TypeCandidateTestPending)
	noInvitation.Link = &Link{Kind: LinkAssessment}
	cases["assessment without invitation"] = noInvitation

	oneOfMany := memberView(domain.TypeApplicationReceived)
	oneOfMany.Link, oneOfMany.Day, oneOfMany.Count = &Link{Kind: LinkParticipation, JobID: testJob, ParticipationID: testParticipation}, testDay, 2
	cases["participation link for a group of 2"] = oneOfMany

	zeroCount := memberView(domain.TypePsychometricCompleted)
	zeroCount.Link, zeroCount.Count = vacancyLink(LinkVacancyCandidates), 0
	cases["count 0"] = zeroCount

	memberWithoutCompany := memberView(domain.TypeVacancyAssigned)
	memberWithoutCompany.Link, memberWithoutCompany.Company = vacancyLink(LinkVacancy), uuid.Nil
	cases["member type without company"] = memberWithoutCompany

	candidateWithCompany := candidateView(domain.TypeCandidateMessageReceived)
	candidateWithCompany.Company = testCompany
	cases["candidate type with company"] = candidateWithCompany

	unknown := memberView(domain.Type("secret_type"))
	cases["unknown type"] = unknown

	noDay := memberView(domain.TypeApplicationReceived)
	noDay.Link = &Link{Kind: LinkParticipation, JobID: testJob, ParticipationID: testParticipation}
	cases["T1 without day"] = noDay

	noCommitment := memberView(domain.TypeDeliveryOverdue)
	noCommitment.Link = vacancyLink(LinkVacancyDelivery)
	cases["T8 without commitment date"] = noCommitment

	noReason := memberView(domain.TypeVacancyUnassigned)
	cases["T13 without reason"] = noReason

	noFunction := memberView(domain.TypeAssignmentDeadlineDueSoon)
	noFunction.Link, noFunction.CommitmentDate = vacancyLink(LinkVacancyDelivery), testCommitment
	cases["T9 without function"] = noFunction

	noDelivery := memberView(domain.TypeVacancyAssigned)
	noDelivery.Link, noDelivery.DeliveryID = vacancyLink(LinkVacancy), uuid.Nil
	cases["no delivery id"] = noDelivery

	noTo := memberView(domain.TypeVacancyAssigned)
	noTo.Link, noTo.To = vacancyLink(LinkVacancy), ""
	cases["no recipient"] = noTo

	for name, v := range cases {
		if _, err := r.Render(v); err == nil {
			t.Errorf("%s: rendered", name)
		}
	}
}

// A grouped type with count 1 but no participation uses the group form (the
// inbox link rule): vacancy_candidates + .many.
func TestRenderGroupFormForSingleWithoutParticipation(t *testing.T) {
	v := memberView(domain.TypePsychometricCompleted)
	v.Link = vacancyLink(LinkVacancyCandidates)
	m, err := newTestRenderer(t, &fakeSigner{}).Render(v)
	if err != nil {
		t.Fatal(err)
	}
	if m.Template != "psychometric_completed.many" || m.Subject != "1 pruebas psicométricas completadas en Analista de Datos" {
		t.Fatalf("%s %q", m.Template, m.Subject)
	}
}

// Variables are HTML-escaped in the HTML part, kept literal in the text part
// and the subject; control characters (header/line injection) collapse to a
// space.
func TestRenderEscapesVariables(t *testing.T) {
	v := memberView(domain.TypeVacancyAssigned)
	v.Link = vacancyLink(LinkVacancy)
	v.JobTitle = ptr(`<script>alert("x")</script> & Co`)
	v.CompanyName = ptr("Acme\r\nBcc: victim@example.test\t<b>")
	m, err := newTestRenderer(t, &fakeSigner{}).Render(v)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(m.HTML, "<script>") || strings.Contains(m.HTML, "<b>") {
		t.Fatalf("raw markup in HTML:\n%s", m.HTML)
	}
	if !strings.Contains(m.HTML, "&lt;script&gt;alert(&#34;x&#34;)&lt;/script&gt; &amp; Co") || !strings.Contains(m.HTML, "Acme Bcc: victim@example.test &lt;b&gt;") {
		t.Fatalf("escaped values missing:\n%s", m.HTML)
	}
	if m.Subject != `Te asignaron <script>alert("x")</script> & Co` {
		t.Fatalf("subject %q", m.Subject)
	}
	if strings.ContainsAny(m.Subject, "\r\n") || !strings.Contains(m.Text, "en Acme Bcc: victim@example.test <b>.\n") {
		t.Fatalf("control characters kept: %q", m.Text)
	}
}

func TestRenderSignerFailureFailsTheRender(t *testing.T) {
	v := memberView(domain.TypeDeliveryDueSoon)
	v.Link, v.CommitmentDate = vacancyLink(LinkVacancyDelivery), testCommitment
	if _, err := newTestRenderer(t, &fakeSigner{err: errors.New("no key")}).Render(v); err == nil {
		t.Fatal("signer error ignored")
	}
	// A token outside the E7 charset is refused (it would break the URL/header).
	if _, err := newTestRenderer(t, &fakeSigner{token: "a b>\r\nX: y"}).Render(v); err == nil {
		t.Fatal("unsafe token accepted")
	}
}

func TestNewRendererValidatesSettings(t *testing.T) {
	good := Settings{From: testFrom, AppBaseURL: testBase, UnsubscribeURL: testUnsubscribe}
	if _, err := NewRenderer(good, nil); err == nil {
		t.Error("nil signer accepted")
	}
	for name, s := range map[string]Settings{
		"no from":        {AppBaseURL: testBase, UnsubscribeURL: testUnsubscribe},
		"bad from":       {From: "nobody", AppBaseURL: testBase, UnsubscribeURL: testUnsubscribe},
		"no base":        {From: testFrom, UnsubscribeURL: testUnsubscribe},
		"no unsubscribe": {From: testFrom, AppBaseURL: testBase},
	} {
		if _, err := NewRenderer(s, &fakeSigner{}); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

// Every template id of the map exists once with non-empty copy, and the copy
// references only the variables of its row (§Template map).
func TestTemplateTableCoversTheMap(t *testing.T) {
	want := []string{
		"application_received.one", "application_received.many",
		"psychometric_completed.one", "psychometric_completed.many",
		"psychometric_pending.one", "psychometric_pending.many",
		"delivery_due_soon", "delivery_overdue", "assignment_deadline_due_soon", "assignment_deadline_overdue",
		"vacancy_assigned", "vacancy_reassigned", "vacancy_unassigned", "vacancy_team_added",
		"candidate_status_changed", "candidate_message_received", "candidate_test_pending",
	}
	got := TemplateIDs()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("template ids\n got %v\nwant %v", got, want)
	}
}

// D14: the visible text never contains the recipient address or ids other
// than inside URLs.
func TestRenderNeverShowsAddressOrIDsInVisibleText(t *testing.T) {
	for _, g := range goldens() {
		m, err := newTestRenderer(t, &fakeSigner{}).Render(g.view)
		if err != nil {
			t.Fatal(err)
		}
		visible := m.Subject + "\n" + g.heading + "\n" + g.line
		for _, s := range []string{testTo, testUser.String(), testCompany.String(), testDelivery.String()} {
			if strings.Contains(m.Text, s) || strings.Contains(m.HTML, s) || strings.Contains(visible, s) {
				t.Errorf("%s: %q leaked", g.name, s)
			}
		}
	}
}
