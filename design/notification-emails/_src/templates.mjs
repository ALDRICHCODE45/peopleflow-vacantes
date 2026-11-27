// Sample data. Subject, heading, body line and button are verbatim from
// odd/tasks/notifications-stage2-email-copy.md with the variables filled in.
// Markers in body: **x** = emphasis (variable value), !!x!! = urgency emphasis. They never change wording.
// No candidate or member names (L18).
const APP = "https://app.peopleflow.mx";

export const TEMPLATES = {
  t8: {
    id: "T8", kind: "mandatory", tone: "danger", urgency: "Vencida", eyebrow: "Entrega", glyph: "!",
    audience: "member", company: "Grupo Altavista", time: "8:00", footer: "F2",
    subject: "La entrega de Supervisor de Almacén está vencida",
    heading: "La entrega está vencida",
    body: "La fecha compromiso de **Supervisor de Almacén** era el !!24 de noviembre de 2026!!.",
    button: "Ver entrega", url: `${APP}/empresa/vacantes/4821/configuracion/entrega`,
  },
  t2: {
    id: "T2", kind: "operational", tone: "primary", eyebrow: "Postulaciones", glyph: "5",
    audience: "member", company: "Grupo Altavista", time: "19:30", footer: "F1",
    subject: "5 postulaciones nuevas en Analista de Nómina",
    heading: "5 postulaciones nuevas en Analista de Nómina",
    body: "Llegaron **5 postulaciones nuevas** el 25 de noviembre de 2026.",
    button: "Ver candidatos", url: `${APP}/empresa/vacantes/4790/pipeline`,
  },
  t12: {
    id: "T12", kind: "mandatory", tone: "info", eyebrow: "Asignación", glyph: "→",
    audience: "member", company: "Grupo Altavista", time: "11:42", footer: "F2",
    subject: "Ahora eres responsable de Coordinador de Logística",
    heading: "Te reasignaron una vacante",
    body: "Ahora eres responsable de **Coordinador de Logística**. Motivo: **carga de trabajo**.",
    button: "Abrir vacante", url: `${APP}/empresa/vacantes/4833/pipeline`,
  },
  t15: {
    id: "T15", kind: "candidate", tone: "primary", audience: "candidate",
    company: "Grupo Altavista", initials: "GA", time: "13:05", footer: "F1",
    subject: "Tu postulación a Analista de Nómina cambió de estado",
    heading: "Tu postulación ahora está «En proceso»",
    body: "**Grupo Altavista** actualizó tu proceso para **Analista de Nómina**.",
    button: "Ver postulación", url: `${APP}/candidato/postulaciones?postulacion=91207`,
  },
  t17: {
    id: "T17", kind: "candidate", tone: "primary", audience: "candidate",
    company: "Constructora Sierra Madre", initials: "CS", time: "9:15", footer: "F1",
    subject: "Tienes una prueba psicométrica pendiente",
    heading: "Tienes una prueba pendiente",
    body: "**Constructora Sierra Madre** te envió una prueba psicométrica para **Auxiliar Contable**.",
    button: "Empezar prueba", url: `${APP}/candidato/evaluaciones/55310`,
  },
};

export const ROWS = [
  { label: "T8 · Obligatorio y urgente · entrega vencida", desktop: "t8", phone: "t8" },
  { label: "T2 · Operativo agrupado · postulaciones nuevas", desktop: "t2", phone: "t2" },
  { label: "T12 · Obligatorio · reasignación con motivo", desktop: "t12", phone: "t12" },
  { label: "Candidato · T15 cambio de estado (escritorio) y T17 prueba pendiente (teléfono)", desktop: "t15", phone: "t17" },
];

// T1–T17 matrix for the shared spec (kind, tone, glyph, eyebrow, urgency, footer).
export const MATRIX = [
  ["T1", "Nueva postulación en {{job_title}}", "Operativo", "primary", "+", "Postulaciones", "", "F1"],
  ["T2", "{{count}} postulaciones nuevas en {{job_title}}", "Operativo agrupado", "primary", "{{count}}", "Postulaciones", "", "F1"],
  ["T3", "Prueba psicométrica completada en {{job_title}}", "Operativo", "success", "✓", "Pruebas", "", "F1"],
  ["T4", "{{count}} pruebas psicométricas completadas en {{job_title}}", "Operativo agrupado", "success", "{{count}}", "Pruebas", "", "F1"],
  ["T5", "Prueba psicométrica pendiente en {{job_title}}", "Operativo", "primary", "…", "Pruebas", "", "F1"],
  ["T6", "{{count}} pruebas psicométricas pendientes en {{job_title}}", "Operativo agrupado", "primary", "{{count}}", "Pruebas", "", "F1"],
  ["T7", "La entrega de {{job_title}} vence pronto", "Operativo con urgencia", "review", "!", "Entrega", "Vence pronto", "F1"],
  ["T8", "La entrega de {{job_title}} está vencida", "Obligatorio y urgente", "danger", "!", "Entrega", "Vencida", "F2"],
  ["T9", "Tu fecha límite en {{job_title}} se acerca", "Operativo con urgencia", "review", "!", "Entrega", "Vence pronto", "F1"],
  ["T10", "Venció tu fecha límite en {{job_title}}", "Obligatorio y urgente", "danger", "!", "Entrega", "Vencida", "F2"],
  ["T11", "Te asignaron {{job_title}}", "Obligatorio", "info", "→", "Asignación", "", "F2"],
  ["T12", "Ahora eres responsable de {{job_title}}", "Obligatorio", "info", "→", "Asignación", "", "F2"],
  ["T13", "Ya no eres responsable de {{job_title}}", "Obligatorio", "info", "→", "Asignación", "", "F2"],
  ["T14", "Te agregaron al equipo de {{job_title}}", "Obligatorio", "info", "+", "Equipo", "", "F2"],
  ["T15", "Tu postulación a {{job_title}} cambió de estado", "Candidato", "primary", "{{company_initials}}", "{{company_name}}", "", "F1"],
  ["T16", "{{company_name}} te dejó un mensaje", "Candidato", "primary", "{{company_initials}}", "{{company_name}}", "", "F1"],
  ["T17", "Tienes una prueba psicométrica pendiente", "Candidato", "primary", "{{company_initials}}", "{{company_name}}", "", "F1"],
];
