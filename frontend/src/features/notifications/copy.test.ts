import { describe, expect, it } from "vitest";
import {
  bellBadge, bellLabel, dayKey, dayLabel, describeNotification, inboxSummary, notificationTarget, participationHref, sampleToggleLabel,
} from "./copy";
import { NOTIFICATION_TYPES, type NotificationGroup } from "./model";
import { anaParticipation, applicationsGroup, carmenId, jobId, luisParticipation, olgaId, overdueGroup, reassignedGroup } from "./test-fixtures";

// 2026-11-26 14:00 in Mexico City.
const now = new Date("2026-11-26T20:00:00Z");
const olga = { user_id: olgaId, name: "Olga Owner" };
const carmen = { user_id: carmenId, name: "Carmen Colleague" };
const p3 = "70000000-0000-4000-8000-000000000003";

/** A group of one of `type`, on the «Analista de nómina» vacancy. */
function single(type: string, payload: Record<string, unknown> = {}, overrides: Partial<NotificationGroup> = {}): NotificationGroup {
  return overdueGroup({
    type, urgency: "normal", count: 1, sample: [], link: { kind: "vacancy", job_id: jobId },
    latest: { id: "n1", created_at: "2026-11-26T18:00:00Z", actor: olga, payload },
    ...overrides,
  });
}
const copy = (group: NotificationGroup) => describeNotification(group, now);

describe("application_received", () => {
  it("one application names the vacancy and the candidate", () => {
    const c = copy(applicationsGroup({ count: 1, sample: [{ participation_id: anaParticipation, name: "Ana López" }] }));
    expect(c.title).toBe("Nueva postulación en Analista de nómina");
    expect(c.subtitle).toBe("Ana López");
    expect(c).toMatchObject({ icon: "application", tone: "primary", urgency: null });
  });

  it("a group counts them and lists the first names with the rest as «y N más»", () => {
    const c = copy(applicationsGroup({
      count: 5,
      sample: [{ participation_id: anaParticipation, name: "Ana López" }, { participation_id: luisParticipation, name: "Luis Pérez" }, { participation_id: p3, name: "Eva Ruiz" }],
    }));
    expect(c.title).toBe("5 postulaciones nuevas en Analista de nómina");
    expect(c.subtitle).toBe("Ana López, Luis Pérez y 3 más");
  });

  it("when the sample covers the group every name is listed", () => {
    expect(copy(applicationsGroup({ count: 2 })).subtitle).toBe("Ana López y Candidato");
    expect(copy(applicationsGroup({
      count: 3,
      sample: [{ participation_id: anaParticipation, name: "Ana López" }, { participation_id: luisParticipation, name: "Luis Pérez" }, { participation_id: p3, name: "Eva Ruiz" }],
    })).subtitle).toBe("Ana López, Luis Pérez y Eva Ruiz");
  });

  it("a missing vacancy title or empty sample degrades without failing", () => {
    const c = copy(applicationsGroup({ job: null, sample: [] }));
    expect(c.title).toBe("5 postulaciones nuevas en una vacante");
    expect(c.subtitle).toBeNull();
  });
});

describe("delivery deadlines", () => {
  it("due soon says today or tomorrow from the commitment date in Mexico City", () => {
    const today = copy(single("delivery_due_soon", { commitment_date: "2026-11-26" }, { urgency: "due_soon" }));
    expect(today.title).toBe("La entrega de Analista de nómina vence hoy");
    expect(today.subtitle).toBe("Fecha compromiso: jueves 26 de noviembre");
    expect(today.urgency).toEqual({ label: "Vence hoy", variant: "review" });
    expect(today).toMatchObject({ icon: "due-soon", tone: "review" });

    const tomorrow = copy(single("delivery_due_soon", { commitment_date: "2026-11-27" }, { urgency: "due_soon" }));
    expect(tomorrow.title).toBe("La entrega de Analista de nómina vence mañana");
    expect(tomorrow.urgency).toEqual({ label: "Vence mañana", variant: "review" });
  });

  it("uses the Mexico City date, not UTC, near midnight", () => {
    // 2026-11-27 03:00 UTC is still the 26th in Mexico City.
    const c = describeNotification(single("delivery_due_soon", { commitment_date: "2026-11-27" }, { urgency: "due_soon" }), new Date("2026-11-27T03:00:00Z"));
    expect(c.title).toBe("La entrega de Analista de nómina vence mañana");
  });

  it("overdue says it is overdue with the long commitment date", () => {
    const c = copy(overdueGroup());
    expect(c.title).toBe("La entrega de Analista de nómina está vencida");
    expect(c.subtitle).toBe("Fecha compromiso: miércoles 25 de noviembre");
    expect(c.urgency).toEqual({ label: "Vencida", variant: "danger" });
    expect(c).toMatchObject({ icon: "overdue", tone: "danger" });
  });

  it("a date from another year carries the year; a missing date drops the subtitle", () => {
    expect(copy(overdueGroup({ latest: { ...overdueGroup().latest, payload: { commitment_date: "2025-12-30" } } })).subtitle)
      .toBe("Fecha compromiso: martes 30 de diciembre de 2025");
    expect(copy(overdueGroup({ latest: { ...overdueGroup().latest, payload: {} } })).subtitle).toBeNull();
  });
});

describe("assignment deadlines", () => {
  it("due soon names the function and the date", () => {
    const c = copy(single("assignment_deadline_due_soon", { function: "collaborator", commitment_date: "2026-11-27" }, { urgency: "due_soon" }));
    expect(c.title).toBe("Tu fecha límite en Analista de nómina es mañana");
    expect(c.subtitle).toBe("Como colaborador, tu entrega vence el viernes 27 de noviembre.");
    expect(c.urgency).toEqual({ label: "Vence mañana", variant: "review" });
  });

  it("overdue says it passed", () => {
    const c = copy(single("assignment_deadline_overdue", { function: "responsible", commitment_date: "2026-11-24" }, { urgency: "overdue" }));
    expect(c.title).toBe("Venció tu fecha límite en Analista de nómina");
    expect(c.subtitle).toBe("Tu entrega como responsable era el martes 24 de noviembre.");
    expect(c.urgency).toEqual({ label: "Vencida", variant: "danger" });
  });

  it("member function and a missing function both read naturally", () => {
    expect(copy(single("assignment_deadline_due_soon", { function: "member", commitment_date: "2026-11-26" })).subtitle)
      .toBe("Como integrante, tu entrega vence el jueves 26 de noviembre.");
    expect(copy(single("assignment_deadline_overdue", { commitment_date: "2026-11-24" })).subtitle)
      .toBe("Tu entrega era el martes 24 de noviembre.");
  });
});

describe("vacancy assignment and team", () => {
  it("assigned names the actor", () => {
    const c = copy(single("vacancy_assigned"));
    expect(c.title).toBe("Te asignaron Analista de nómina");
    expect(c.subtitle).toBe("Olga Owner te hizo responsable.");
    expect(c).toMatchObject({ icon: "assignment", tone: "info" });
  });

  it("reassigned names the actor, the previous responsible and the reason", () => {
    const c = copy(reassignedGroup());
    expect(c.title).toBe("Ahora eres responsable de Ejecutivo de ventas");
    expect(c.subtitle).toBe("Olga Owner te la reasignó desde Carmen Colleague. Motivo: carga de trabajo.");
  });

  it("reassigned without a previous user or reason keeps only what is known", () => {
    const c = copy(reassignedGroup({ from_user: undefined, latest: { ...reassignedGroup().latest, actor: null, payload: {} } }));
    expect(c.subtitle).toBe("Alguien te la reasignó.");
  });

  it("unassigned names who took it and why", () => {
    const c = copy(single("vacancy_unassigned", { reason: "recruiter_departure" }, { to_user: carmen, link: null }));
    expect(c.title).toBe("Ya no eres responsable de Analista de nómina");
    expect(c.subtitle).toBe("Olga Owner reasignó la vacante a Carmen Colleague. Motivo: salida del reclutador.");
  });

  it("every reason has wording", () => {
    const reasons = { workload: "carga de trabajo", recruiter_departure: "salida del reclutador", performance: "desempeño", client_request: "solicitud del cliente", other: "otro motivo" };
    for (const [reason, text] of Object.entries(reasons)) {
      expect(copy(single("vacancy_unassigned", { reason }, { to_user: carmen })).subtitle).toContain(`Motivo: ${text}.`);
    }
  });

  it("team added names the function", () => {
    const c = copy(single("vacancy_team_added", { function: "member" }));
    expect(c.title).toBe("Te agregaron al equipo de Analista de nómina");
    expect(c.subtitle).toBe("Como integrante.");
    expect(c).toMatchObject({ icon: "team", tone: "info" });
    expect(copy(single("vacancy_team_added")).subtitle).toBeNull();
  });

  it("a missing actor or vacancy title has a fallback", () => {
    const c = copy(single("vacancy_assigned", {}, { job: null, latest: { id: "n", created_at: "2026-11-26T18:00:00Z", actor: { user_id: olgaId, name: null }, payload: {} } }));
    expect(c.title).toBe("Te asignaron una vacante");
    expect(c.subtitle).toBe("Alguien te hizo responsable.");
  });
});

describe("psychometric tests", () => {
  const two = [{ participation_id: anaParticipation, name: "Ana López" }, { participation_id: luisParticipation, name: "Luis Pérez" }];

  it("completed: one names the candidate, a group counts them", () => {
    const one = copy(single("psychometric_completed", {}, { sample: [two[0]] }));
    expect(one.title).toBe("Ana López completó su prueba psicométrica");
    expect(one.subtitle).toBe("Analista de nómina");
    expect(one).toMatchObject({ icon: "psychometric-done", tone: "success" });
    const many = copy(single("psychometric_completed", {}, { count: 2, sample: two }));
    expect(many.title).toBe("2 pruebas psicométricas completadas en Analista de nómina");
    expect(many.subtitle).toBe("Ana López y Luis Pérez");
  });

  it("pending: one names the candidate, a group counts them", () => {
    const one = copy(single("psychometric_pending", {}, { sample: [{ participation_id: anaParticipation, name: null }] }));
    expect(one.title).toBe("Prueba psicométrica pendiente de Candidato");
    expect(one).toMatchObject({ icon: "psychometric-pending", tone: "muted" });
    const many = copy(single("psychometric_pending", {}, { count: 4, sample: two }));
    expect(many.title).toBe("4 pruebas psicométricas pendientes en Analista de nómina");
    expect(many.subtitle).toBe("Ana López, Luis Pérez y 2 más");
  });
});

describe("generic types", () => {
  it("an unknown type renders a generic notification", () => {
    expect(copy(single("something_new"))).toEqual({ title: "Nueva notificación", subtitle: null, icon: "generic", tone: "muted", urgency: null });
  });

  it("candidate-side types stay generic until T3.6", () => {
    for (const type of ["candidate_status_changed", "candidate_message_received", "candidate_test_pending"]) {
      expect(copy(single(type))).toMatchObject({ title: "Nueva notificación", subtitle: null });
    }
  });

  it("every stage-1 type has a non-empty title", () => {
    for (const type of NOTIFICATION_TYPES) expect(copy(single(type, { commitment_date: "2026-11-26" })).title).not.toBe("");
  });
});

describe("links", () => {
  const pid = anaParticipation;
  it("maps every link kind to its route and destination", () => {
    expect(notificationTarget({ kind: "vacancy", job_id: jobId })).toEqual({ href: `/empresa/vacantes/${jobId}/pipeline`, destination: "Pipeline" });
    expect(notificationTarget({ kind: "vacancy_candidates", job_id: jobId })).toEqual({ href: `/empresa/vacantes/${jobId}/pipeline`, destination: "Pipeline" });
    expect(notificationTarget({ kind: "participation", job_id: jobId, participation_id: pid })).toEqual({ href: `/empresa/vacantes/${jobId}/pipeline?candidato=${pid}`, destination: "Candidato" });
    expect(notificationTarget({ kind: "vacancy_delivery", job_id: jobId })).toEqual({ href: `/empresa/vacantes/${jobId}/configuracion/entrega`, destination: "Entrega" });
    expect(notificationTarget({ kind: "application", job_id: jobId, participation_id: pid })).toEqual({ href: `/candidato/postulaciones?postulacion=${pid}`, destination: "Postulación" });
    expect(notificationTarget({ kind: "assessment", invitation_id: pid })).toEqual({ href: `/candidato/evaluaciones/${pid}`, destination: "Evaluación" });
  });

  it("a null link is not clickable", () => {
    expect(notificationTarget(null)).toBeNull();
  });

  it("sample candidates link to the participation", () => {
    expect(participationHref(jobId, pid)).toBe(`/empresa/vacantes/${jobId}/pipeline?candidato=${pid}`);
  });
});

describe("days", () => {
  it("labels today, yesterday and older days in Mexico City", () => {
    expect(dayLabel(dayKey("2026-11-26T18:00:00Z"), now)).toBe("Hoy");
    // 05:00 UTC on the 26th is still the 25th in Mexico City.
    expect(dayLabel(dayKey("2026-11-26T05:00:00Z"), now)).toBe("Ayer");
    expect(dayLabel(dayKey("2026-11-23T18:00:00Z"), now)).toBe("Lunes 23 de noviembre");
    expect(dayLabel(dayKey("2025-11-23T18:00:00Z"), now)).toBe("Domingo 23 de noviembre de 2025");
  });
});

describe("bell and summary", () => {
  it("names the bell with the unread count", () => {
    expect(bellLabel(3)).toBe("Notificaciones, 3 sin leer");
    expect(bellLabel(0)).toBe("Notificaciones, todo leído");
    expect(bellLabel(null)).toBe("Notificaciones");
  });

  it("caps the badge at 9+ and hides it when there is nothing unread", () => {
    expect(bellBadge(1)).toBe("1");
    expect(bellBadge(9)).toBe("9");
    expect(bellBadge(10)).toBe("9+");
    expect(bellBadge(0)).toBeNull();
    expect(bellBadge(null)).toBeNull();
  });

  it("summarises the inbox state", () => {
    expect(inboxSummary({ loading: true, unread: 3, attention: 1 })).toBe("Cargando…");
    expect(inboxSummary({ loading: false, unread: 3, attention: 1 })).toBe("3 sin leer · 1 requiere atención");
    expect(inboxSummary({ loading: false, unread: 6, attention: 2 })).toBe("6 sin leer · 2 requieren atención");
    expect(inboxSummary({ loading: false, unread: 2, attention: 0 })).toBe("2 sin leer");
    expect(inboxSummary({ loading: false, unread: 0, attention: 0 })).toBe("Todo leído");
    expect(inboxSummary({ loading: false, unread: null, attention: null })).toBe("");
  });

  it("labels the sample toggle", () => {
    expect(sampleToggleLabel({ count: 2, shown: 2 }, false)).toBe("Ver los 2");
    expect(sampleToggleLabel({ count: 5, shown: 3 }, false)).toBe("Ver los últimos 3");
    expect(sampleToggleLabel({ count: 5, shown: 3 }, true)).toBe("Ocultar");
  });
});
