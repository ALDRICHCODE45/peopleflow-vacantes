package email

import (
	"text/template"

	"github.com/aldrichcode45/peopleflow-vacantes/internal/features/notifications/domain"
)

// The Spanish copy of §Templates, kept verbatim (frontend review approved by
// the user, odd/tasks/notifications-v2-backend.md L5; T13 body per L8). The
// contract's {{var}} placeholders are written {{.var}} (Go templates). No
// variable is a candidate or actor name, and no free text is ever passed (D14).

// Variables beyond job_title and company_name, which every template receives
// (with their fallbacks).
const (
	varCount          = "count"
	varDateLocal      = "date_local"
	varCommitmentDate = "commitment_date_local"
	varFunction       = "function"
	varReason         = "reason"
	varStatus         = "status"
)

// form is the template form of a type: grouped types have .one / .many.
type form int

const (
	formSingle form = iota
	formOne
	formMany
)

type templateSpec struct {
	id   string
	typ  domain.Type
	form form
	// vars are the extra variables of the row (§Template map); the copy fails
	// to render if it references any other.
	vars                           []string
	subject, heading, line, button string
}

// templateSpecs follows the §Template map order (T1–T17).
var templateSpecs = []templateSpec{
	{"application_received.one", domain.TypeApplicationReceived, formOne, []string{varDateLocal},
		"Nueva postulación en {{.job_title}}", "Nueva postulación en {{.job_title}}", "Recibiste una postulación nueva el {{.date_local}}.", "Ver candidatos"},
	{"application_received.many", domain.TypeApplicationReceived, formMany, []string{varCount, varDateLocal},
		"{{.count}} postulaciones nuevas en {{.job_title}}", "{{.count}} postulaciones nuevas en {{.job_title}}", "Llegaron {{.count}} postulaciones nuevas el {{.date_local}}.", "Ver candidatos"},
	{"psychometric_completed.one", domain.TypePsychometricCompleted, formOne, nil,
		"Prueba psicométrica completada en {{.job_title}}", "Prueba psicométrica completada", "Un candidato de {{.job_title}} terminó su prueba psicométrica.", "Ver resultado"},
	{"psychometric_completed.many", domain.TypePsychometricCompleted, formMany, []string{varCount},
		"{{.count}} pruebas psicométricas completadas en {{.job_title}}", "{{.count}} pruebas psicométricas completadas", "{{.count}} candidatos de {{.job_title}} terminaron su prueba psicométrica.", "Ver candidatos"},
	{"psychometric_pending.one", domain.TypePsychometricPending, formOne, nil,
		"Prueba psicométrica pendiente en {{.job_title}}", "Prueba psicométrica pendiente", "Se envió una prueba psicométrica a un candidato de {{.job_title}} y aún no la responde.", "Ver candidato"},
	{"psychometric_pending.many", domain.TypePsychometricPending, formMany, []string{varCount},
		"{{.count}} pruebas psicométricas pendientes en {{.job_title}}", "{{.count}} pruebas psicométricas pendientes", "Se enviaron {{.count}} pruebas psicométricas a candidatos de {{.job_title}} y aún no las responden.", "Ver candidatos"},
	{"delivery_due_soon", domain.TypeDeliveryDueSoon, formSingle, []string{varCommitmentDate},
		"La entrega de {{.job_title}} vence pronto", "La entrega vence pronto", "La fecha compromiso de {{.job_title}} es el {{.commitment_date_local}}.", "Ver entrega"},
	{"delivery_overdue", domain.TypeDeliveryOverdue, formSingle, []string{varCommitmentDate},
		"La entrega de {{.job_title}} está vencida", "La entrega está vencida", "La fecha compromiso de {{.job_title}} era el {{.commitment_date_local}}.", "Ver entrega"},
	{"assignment_deadline_due_soon", domain.TypeAssignmentDeadlineDueSoon, formSingle, []string{varCommitmentDate, varFunction},
		"Tu fecha límite en {{.job_title}} se acerca", "Tu fecha límite se acerca", "Como {{.function}} de {{.job_title}}, tu entrega vence el {{.commitment_date_local}}.", "Ver entrega"},
	{"assignment_deadline_overdue", domain.TypeAssignmentDeadlineOverdue, formSingle, []string{varCommitmentDate, varFunction},
		"Venció tu fecha límite en {{.job_title}}", "Venció tu fecha límite", "Tu entrega como {{.function}} de {{.job_title}} era el {{.commitment_date_local}}.", "Ver entrega"},
	{"vacancy_assigned", domain.TypeVacancyAssigned, formSingle, nil,
		"Te asignaron {{.job_title}}", "Te asignaron una vacante", "Ahora eres responsable de {{.job_title}} en {{.company_name}}.", "Abrir vacante"},
	{"vacancy_reassigned", domain.TypeVacancyReassigned, formSingle, []string{varReason},
		"Ahora eres responsable de {{.job_title}}", "Te reasignaron una vacante", "Ahora eres responsable de {{.job_title}}. Motivo: {{.reason}}.", "Abrir vacante"},
	{"vacancy_unassigned", domain.TypeVacancyUnassigned, formSingle, []string{varReason},
		"Ya no eres responsable de {{.job_title}}", "Se reasignó una vacante", "Otra persona quedó a cargo de {{.job_title}}. Motivo: {{.reason}}.", "Ir a PeopleFlow"},
	{"vacancy_team_added", domain.TypeVacancyTeamAdded, formSingle, []string{varFunction},
		"Te agregaron al equipo de {{.job_title}}", "Te agregaron a un equipo", "Formas parte del equipo de {{.job_title}} como {{.function}}.", "Abrir vacante"},
	{"candidate_status_changed", domain.TypeCandidateStatusChanged, formSingle, []string{varStatus},
		"Tu postulación a {{.job_title}} cambió de estado", "Tu postulación ahora está «{{.status}}»", "{{.company_name}} actualizó tu proceso para {{.job_title}}.", "Ver postulación"},
	{"candidate_message_received", domain.TypeCandidateMessageReceived, formSingle, nil,
		"{{.company_name}} te dejó un mensaje", "Tienes un mensaje sobre tu postulación", "{{.company_name}} te escribió sobre {{.job_title}}. Por privacidad no lo incluimos aquí; léelo en PeopleFlow.", "Leer mensaje"},
	{"candidate_test_pending", domain.TypeCandidateTestPending, formSingle, nil,
		"Tienes una prueba psicométrica pendiente", "Tienes una prueba pendiente", "{{.company_name}} te envió una prueba psicométrica para {{.job_title}}.", "Empezar prueba"},
}

// Footers F1 / F2 (§Footers, verbatim).
const (
	footerOptional         = "Recibes este correo porque este aviso está activado en tus preferencias."
	footerMandatory        = "Este aviso es obligatorio y no se puede desactivar."
	labelPreferences       = "Mis preferencias"
	labelUnsubscribeByType = "Dejar de recibir este tipo de correo"
)

// Fallbacks (§Fallbacks, verbatim).
const (
	fallbackJobTitle    = "una vacante"
	fallbackCompanyName = "una empresa"
)

// Label maps (§Labels, verbatim): code value → label. An unknown code fails
// the render instead of reaching the email.
var (
	functionLabels = map[string]string{"responsible": "responsable", "collaborator": "colaborador", "member": "integrante"}
	reasonLabels   = map[string]string{
		"workload": "carga de trabajo", "recruiter_departure": "salida del reclutador", "performance": "desempeño",
		"client_request": "solicitud del cliente", "other": "otro motivo",
	}
	statusLabels = map[string]string{"submitted": "Enviada", "in_process": "En proceso", "closed": "Cerrada"}
)

// compiledCopy holds the four parsed copy fields of a template.
type compiledCopy struct {
	spec                           templateSpec
	subject, heading, line, button *template.Template
}

type specKey struct {
	typ  domain.Type
	form form
}

var compiledSpecs = func() map[specKey]compiledCopy {
	out := make(map[specKey]compiledCopy, len(templateSpecs))
	parse := func(id, field, text string) *template.Template {
		return template.Must(template.New(id + "." + field).Option("missingkey=error").Parse(text))
	}
	for _, s := range templateSpecs {
		k := specKey{s.typ, s.form}
		if _, dup := out[k]; dup {
			panic("email: duplicate template " + s.id)
		}
		out[k] = compiledCopy{
			spec:    s,
			subject: parse(s.id, "subject", s.subject),
			heading: parse(s.id, "heading", s.heading),
			line:    parse(s.id, "line", s.line),
			button:  parse(s.id, "button", s.button),
		}
	}
	return out
}()

// TemplateIDs lists the template ids in §Template map order.
func TemplateIDs() []string {
	ids := make([]string, len(templateSpecs))
	for i, s := range templateSpecs {
		ids[i] = s.id
	}
	return ids
}
