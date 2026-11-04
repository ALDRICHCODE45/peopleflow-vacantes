import type { AuditActor, AuditEvent, AuditEventPage, AuditType, AuditVacancy } from "./model";

export const anaId = "10000000-0000-4000-8000-000000000002";
export const luisId = "10000000-0000-4000-8000-000000000003";
export const vacancyId = "40000000-0000-4000-8000-000000000001";
export const deletedVacancyId = "40000000-0000-4000-8000-000000000002";

/** Row of `GET /v2/me/company/audit-events` (contract §8.1 example). */
export function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: "50000000-0000-4000-8000-000000000001",
    occurred_at: "2026-11-04T17:03:12.441Z",
    event_type: "CompanyCandidateCVDownloaded",
    category: "sensitive_read",
    actor: { type: "user", user_id: anaId, name: "Ana López", email: "ana@empresa.mx", is_current_member: true },
    entity: { type: "company_candidate", id: "60000000-0000-4000-8000-000000000001", label: "María Pérez" },
    vacancy: { id: vacancyId, title: "Ejecutivo de ventas" },
    metadata: { kind: "organic", participation_id: "70000000-0000-4000-8000-000000000001", variant: "original" },
    ip: "201.141.12.7",
    ip_source: "bff",
    user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    ...overrides,
  };
}

export function auditPage(items: AuditEvent[] = [auditEvent()], overrides: Partial<AuditEventPage> = {}): AuditEventPage {
  return { items, total: items.length, next_cursor: null, ...overrides };
}

export const auditTypes: AuditType[] = [
  { event_type: "SessionStarted", category: "session" },
  { event_type: "SessionEnded", category: "session" },
  { event_type: "CompanyCandidateCVDownloaded", category: "sensitive_read" },
  { event_type: "AuditLogExported", category: "audit" },
];
export const auditActors: AuditActor[] = [
  { user_id: anaId, name: "Ana López", email: "ana@empresa.mx", is_current_member: true },
  { user_id: luisId, name: "Luis Soto", email: "luis@empresa.mx", is_current_member: false },
];
export const auditVacancies: AuditVacancy[] = [
  { vacancy_id: vacancyId, title: "Ejecutivo de ventas" },
  { vacancy_id: deletedVacancyId, title: null },
];
