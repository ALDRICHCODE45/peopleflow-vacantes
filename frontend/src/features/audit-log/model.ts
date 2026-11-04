import { z } from "zod";

/** Decoders and es-MX copy for `docs/contracts/audit-log-v1.md` §8 (agreed 2026-11-04). */
const uuid = z.string().uuid();
const text = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Event types and categories are identifiers; anything else never travels to the API. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

export const auditActorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("system") }).strict(),
  // name/email are null for a deleted user (read-time resolution, §7).
  z.object({ type: z.literal("user"), user_id: uuid, name: z.string().nullable(), email: z.string().nullable(), is_current_member: z.boolean() }).strict(),
]);
/** `event_type` and `category` stay open strings: a type added later must render with a generic label, never fail. */
export const auditEventSchema = z.object({
  id: text,
  occurred_at: timestamp,
  event_type: text,
  category: text,
  actor: auditActorSchema,
  entity: z.object({ type: text, id: text, label: z.string().nullable() }).strict(),
  vacancy: z.object({ id: uuid, title: z.string().nullable() }).strict().nullable(),
  metadata: z.record(z.unknown()),
  ip: z.string().nullable(),
  ip_source: z.enum(["bff", "peer"]).nullable(),
  user_agent: z.string().nullable(),
}).strict();
export const auditEventPageSchema = z.object({ items: z.array(auditEventSchema).max(100), total: count, next_cursor: z.string().nullable() }).strict();
export const auditTypesSchema = z.object({ items: z.array(z.object({ event_type: text, category: text }).strict()) }).strict();
export const actorsSchema = z.object({ items: z.array(z.object({ user_id: uuid, name: z.string().nullable(), email: z.string().nullable(), is_current_member: z.boolean() }).strict()) }).strict();
export const auditVacanciesSchema = z.object({ items: z.array(z.object({ vacancy_id: uuid, title: z.string().nullable() }).strict()) }).strict();
/** Standard envelope plus the 422 counters of `audit_export_too_large`; leniently decoded, never shown verbatim. */
export const errorEnvelopeSchema = z.object({
  error: text, code: text,
  fields: z.array(z.object({ field: text, code: text })).optional(),
  row_count: count.optional(), limit: count.optional(),
});

export type AuditEvent = z.infer<typeof auditEventSchema>;
export type AuditActorRef = z.infer<typeof auditActorSchema>;
export type AuditEventPage = z.infer<typeof auditEventPageSchema>;
export type AuditType = z.infer<typeof auditTypesSchema>["items"][number];
export type AuditActor = z.infer<typeof actorsSchema>["items"][number];
export type AuditVacancy = z.infer<typeof auditVacanciesSchema>["items"][number];
export type AuditErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type FilterIssue = { field: string; code: string };

export type AuditFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "invalid_filter" | "invalid_cursor" | "server_error" | "no_response" | "unrecognized_response";
  fields?: FilterIssue[];
  reference: { status?: number; code?: string };
};
export type AuditListResult = { ok: true; data: AuditEventPage } | AuditFailure;
export type AuditOptions = { types: AuditType[]; actors: AuditActor[]; vacancies: AuditVacancy[] };
export type AuditOptionsResult = ({ ok: true } & AuditOptions) | AuditFailure;
/** What the export route answers on failure (JSON, never the backend's text). */
export type ExportError = { status?: number; code?: string; row_count?: number; limit?: number };

/** The contract Annex catalog (backend 00ddbe97), in catalog order. A type added later gets a generic label. */
const ANNEX: readonly (readonly [string, string, string])[] = [
  ["SessionStarted", "session", "Inició sesión"],
  ["SessionEnded", "session", "Cerró sesión"],
  ["CompanyCandidateViewed", "sensitive_read", "Vio el detalle de un candidato"],
  ["CompanyCandidateCVDownloaded", "sensitive_read", "Inició la descarga de un CV"],
  ["CompanyCandidateContactsRevealed", "sensitive_read", "Consultó datos de contacto"],
  ["ParticipationViewed", "sensitive_read", "Vio un candidato de la vacante"],
  ["ParticipationCVDownloaded", "sensitive_read", "Inició la descarga de un CV de la vacante"],
  ["PsychometricResultViewed", "sensitive_read", "Vio un resultado psicométrico"],
  ["CandidateAccountCreated", "candidate", "Creó su cuenta de candidato"],
  ["CompanyCandidateEdited", "candidate", "Editó los datos de un candidato"],
  ["CompanyCandidateCVCorrected", "candidate", "Corrigió el CV de un candidato"],
  ["VacancyCandidateAddedManually", "candidate", "Agregó un candidato a una vacante"],
  ["VacancyApplicationSubmitted", "candidate", "Se postuló a una vacante"],
  ["ApplicationSubmitted", "candidate", "Envió una postulación"],
  ["ApplicationTransitioned", "candidate", "Cambió el estado de una postulación"],
  ["PsychometricInvitationCreated", "candidate", "Creó una invitación psicométrica"],
  ["PsychometricInvitationRevoked", "candidate", "Revocó una invitación psicométrica"],
  ["PsychometricReminderRecorded", "candidate", "Registró un recordatorio psicométrico"],
  ["PsychometricLinkIssued", "candidate", "Generó un enlace psicométrico"],
  ["PsychometricConsentGiven", "candidate", "Aceptó el consentimiento psicométrico"],
  ["PsychometricAssessmentFinished", "candidate", "Terminó una evaluación psicométrica"],
  ["PsychometricComparisonCreated", "candidate", "Generó una comparación psicométrica"],
  ["JobDraftCreated", "vacancy", "Creó una vacante"],
  ["JobDraftSaved", "vacancy", "Guardó cambios en una vacante"],
  ["JobDraftRequesterCreated", "vacancy", "Agregó un solicitante al catálogo"],
  ["JobDraftManagementConfigured", "vacancy", "Configuró la gestión de una vacante"],
  ["JobDraftDeliveryConfigured", "vacancy", "Configuró la entrega de una vacante"],
  ["JobDraftChecklistConfigured", "vacancy", "Configuró los criterios de revisión de una vacante"],
  ["JobDraftPsychometricProfileConfigured", "vacancy", "Configuró el perfil psicométrico de una vacante"],
  ["VacancyPublished", "vacancy", "Publicó una vacante"],
  ["VacancyPaused", "vacancy", "Pausó una vacante"],
  ["VacancyResumed", "vacancy", "Reanudó una vacante"],
  ["VacancyClosed", "vacancy", "Cerró una vacante"],
  ["VacancyProcessFinished", "vacancy", "Terminó el proceso de una vacante"],
  ["VacancyReopened", "vacancy", "Reabrió una vacante"],
  ["VacancyCommitmentRenegotiated", "vacancy", "Renegoció la fecha de compromiso de una vacante"],
  ["VacancyDeliveryFulfilled", "vacancy", "Cumplió la entrega de una vacante"],
  ["VacancyPlacementCredited", "vacancy", "Acreditó una colocación"],
  ["VacancyPlacementCreditChanged", "vacancy", "Cambió el estado de un crédito de colocación"],
  ["JobDraftPipelineConfigured", "pipeline", "Configuró las etapas de una vacante"],
  ["JobDraftSubstatesConfigured", "pipeline", "Configuró los subestados de una vacante"],
  ["ParticipationMoved", "pipeline", "Movió a un candidato de etapa"],
  ["ParticipationDiscarded", "pipeline", "Descartó a un candidato"],
  ["ParticipationRecovered", "pipeline", "Recuperó a un candidato descartado"],
  ["ParticipationSubstateChanged", "pipeline", "Cambió el subestado de un candidato"],
  ["ParticipationChecklistMarked", "pipeline", "Marcó un criterio de revisión"],
  ["VacancyTeamCreated", "team", "Creó el equipo de una vacante"],
  ["VacancyTeamModeChanged", "team", "Cambió el modo del equipo de una vacante"],
  ["VacancyTeamMemberAdded", "team", "Agregó a una persona al equipo de una vacante"],
  ["VacancyTeamMemberRemoved", "team", "Quitó a una persona del equipo de una vacante"],
  ["VacancyTeamMemberLeft", "team", "Salió del equipo de una vacante"],
  ["VacancyResponsibleReassigned", "team", "Reasignó al responsable de una vacante"],
  ["VacancyAssignmentDeadlineChanged", "team", "Cambió la fecha límite de una persona del equipo"],
  ["VacancyAssignmentEndedByMembership", "team", "Terminó una asignación por la baja de un miembro"],
  ["CompanyUpdated", "company", "Actualizó los datos de la empresa"],
  ["CompanyDeleted", "company", "Eliminó la empresa"],
  ["CompanySitePublished", "company", "Publicó el sitio de la empresa"],
  ["CompanySiteUnpublished", "company", "Despublicó el sitio de la empresa"],
  ["TalentBaseVisibilityChanged", "company", "Cambió quién ve la Base de talento"],
  ["CompanyMemberAdded", "members", "Agregó a un miembro"],
  ["CompanyMemberRoleChanged", "members", "Cambió el rol de un miembro"],
  ["CompanyMemberOffboarded", "members", "Dio de baja a un miembro"],
  ["AuditLogExported", "audit", "Exportó la auditoría"],
];
const EVENT_LABELS = new Map(ANNEX.map(([type, , label]) => [type, label]));
export const KNOWN_EVENT_TYPES: AuditType[] = ANNEX.map(([event_type, category]) => ({ event_type, category }));
export const UNKNOWN_EVENT_LABEL = "Otra acción";
export const eventLabel = (type: string): string => EVENT_LABELS.get(type) ?? UNKNOWN_EVENT_LABEL;
export const isKnownEventType = (type: string): boolean => EVENT_LABELS.has(type);

const CATEGORY_LABELS = new Map([
  ["session", "Sesiones"], ["sensitive_read", "Consultas sensibles"], ["candidate", "Candidatos"], ["vacancy", "Vacantes"],
  ["pipeline", "Proceso de selección"], ["team", "Equipo de la vacante"], ["company", "Empresa"], ["members", "Miembros y roles"], ["audit", "Auditoría"],
]);
export const categoryLabel = (category: string): string => CATEGORY_LABELS.get(category) ?? "Otras acciones";

export const MX_TIME_ZONE = "America/Mexico_City";
const momentFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, dateStyle: "medium", timeStyle: "medium" });
export function formatOccurredAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : momentFormat.format(date);
}

export function describeActor(actor: AuditActorRef): { name: string; email: string | null; former: boolean; system: boolean } {
  if (actor.type === "system") return { name: "Sistema", email: null, former: false, system: true };
  return { name: actor.name ?? "Usuario eliminado", email: actor.email, former: !actor.is_current_member, system: false };
}

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, "Edge"], [/OPR\/|Opera/, "Opera"], [/Firefox\//, "Firefox"], [/Chrome\/|CriOS\//, "Chrome"], [/Safari\//, "Safari"],
];
// Android and iOS agents also say Linux / Mac OS X, so they come first.
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/Android/, "Android"], [/iPhone|iPad/, "iOS"], [/Windows/, "Windows"], [/Mac OS X|Macintosh/, "macOS"], [/Linux|X11/, "Linux"],
];
/** «Safari · macOS» from a User-Agent; unknown agents show their (truncated) raw value, never a guess. */
export function describeBrowser(userAgent: string | null): string {
  if (!userAgent) return "—";
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (!browser) return userAgent.length > 60 ? `${userAgent.slice(0, 60)}…` : userAgent;
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  return system ? `${browser} · ${system}` : browser;
}

export const EXPORT_MAX_DAYS = 366;
const DAY_MS = 86_400_000;
const dayStart = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Number.NaN;
/** A real calendar day as `YYYY-MM-DD` (the contract's date format). */
export const isIsoDay = (value: string): boolean => { const time = dayStart(value); return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value); };
/** Export needs both ends, ordered, spanning at most 366 inclusive days (D7). */
export function exportRangeError(from: string | undefined, to: string | undefined): "required" | "invalid" | "order" | "too_long" | undefined {
  if (!from || !to) return "required";
  if (!isIsoDay(from) || !isIsoDay(to)) return "invalid";
  const days = (dayStart(to) - dayStart(from)) / DAY_MS + 1;
  if (days < 1) return "order";
  return days > EXPORT_MAX_DAYS ? "too_long" : undefined;
}

export const RANGE_MESSAGE = "La fecha «Desde» debe ser anterior o igual a «Hasta».";
export const EXPORT_RANGE_MESSAGES = {
  required: "Elige las fechas «Desde» y «Hasta» para exportar.",
  invalid: "Revisa las fechas: usa días válidos.",
  order: RANGE_MESSAGE,
  too_long: `El rango no puede pasar de ${EXPORT_MAX_DAYS} días. Acórtalo para exportar.`,
} as const;

export function listFailureMessage(failure: AuditFailure): string {
  switch (failure.reason) {
    case "forbidden": return "Solo el owner de la empresa puede consultar la auditoría.";
    case "unauthenticated": return "Tu sesión expiró. Inicia sesión de nuevo para consultar la auditoría.";
    case "invalid_filter": return failure.fields?.some(issue => issue.code === "range") ? RANGE_MESSAGE
      : "No pudimos aplicar los filtros. Limpia los filtros para volver a consultar la auditoría.";
    case "invalid_cursor": return "La lista se actualizó. Volvimos a la primera página.";
    default: return "No pudimos consultar la auditoría. Puedes volver a intentarlo.";
  }
}

const number = new Intl.NumberFormat("es-MX");
export function exportErrorMessage(error: ExportError): string {
  if (error.code === "audit_export_too_large") {
    const size = error.row_count !== undefined && error.limit !== undefined
      ? `La exportación tiene ${number.format(error.row_count)} registros y el límite es ${number.format(error.limit)}.`
      : "La exportación supera el límite de registros.";
    return `${size} Acorta el rango de fechas o agrega filtros; no se descargó ningún archivo.`;
  }
  if (error.status === 403 || error.code === "forbidden") return "Solo el owner de la empresa puede exportar la auditoría.";
  if (error.status === 401 || error.code === "unauthenticated") return "Tu sesión expiró. Inicia sesión de nuevo e inténtalo otra vez.";
  if (error.status === 422 || error.code === "invalid_filter") return `Revisa las fechas: elige «Desde» y «Hasta», con un máximo de ${EXPORT_MAX_DAYS} días.`;
  return "No pudimos generar la exportación. No se descargó ningún archivo; inténtalo de nuevo.";
}

const exportShape = z.object({
  actor_id: uuid.optional(), event_types: z.array(z.string().regex(TOKEN_PATTERN)).max(50).optional(),
  category: z.string().regex(TOKEN_PATTERN).optional(), vacancy_id: uuid.optional(),
  from: z.string().optional(), to: z.string().optional(),
}).strict();
export type ExportBody = z.infer<typeof exportShape>;
const unique = (issues: FilterIssue[]) => issues.filter((issue, index) => issues.findIndex(other => other.field === issue.field && other.code === issue.code) === index);

/** Contract §8.5 body: the list filters, with `from`/`to` required and at most 366 days. Rejections use the §8.1 field codes. */
export function parseExportBody(value: unknown): { ok: true; data: ExportBody } | { ok: false; fields: FilterIssue[] } {
  const parsed = exportShape.safeParse(value);
  if (!parsed.success) return { ok: false, fields: unique(parsed.error.issues.flatMap((issue): FilterIssue[] =>
    issue.code === "unrecognized_keys" ? issue.keys.map(field => ({ field, code: "unknown" })) : [{ field: String(issue.path[0] ?? "body"), code: "invalid" }])) };
  const { from, to } = parsed.data;
  const ends = [["from", from], ["to", to]] as const;
  const missing = ends.filter(([, day]) => !day).map(([field]) => ({ field, code: "required" }));
  if (missing.length) return { ok: false, fields: missing };
  const invalid = ends.filter(([, day]) => !isIsoDay(day!)).map(([field]) => ({ field, code: "invalid" }));
  if (invalid.length) return { ok: false, fields: invalid };
  return exportRangeError(from, to) ? { ok: false, fields: [{ field: "from", code: "range" }] } : { ok: true, data: parsed.data };
}
