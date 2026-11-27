import type { NotificationChannel, NotificationGroup, NotificationLink, NotificationScope, NotificationState, NotificationType, PreferenceItem } from "./model";

/**
 * Wording, icons and links for the company inbox (design 07) and the candidate inbox (design 04), contract
 * notifications-v1. Pure: the backend stores ids and enums only (D24) and every visible sentence is composed here from `type` + resolved names + payload.
 * Dates follow the backend rule: calendar days in America/Mexico_City.
 */

export type NotificationTone = "primary" | "review" | "danger" | "info" | "success" | "muted";
export type NotificationIcon =
  | "application" | "due-soon" | "overdue" | "assignment" | "team" | "psychometric-done" | "psychometric-pending"
  | "status" | "message" | "test" | "generic";
export type NotificationUrgency = { label: string; variant: "danger" | "review" };
/** Application status badge of a candidate row (design 04, T4.3); same words and paint as the applications list. */
export type NotificationStatusBadge = { label: string; variant: "info" | "review" | "neutral" };
export type NotificationCopy = {
  title: string;
  subtitle: string | null;
  icon: NotificationIcon;
  tone: NotificationTone;
  urgency: NotificationUrgency | null;
  /** Present only on `candidate_status_changed` with a known status; company rows never carry it. */
  badge?: NotificationStatusBadge;
};
export type NotificationTarget = { href: string; destination: string };

const TIME_ZONE = "America/Mexico_City";
const ymdFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const longFormat = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar day (`YYYY-MM-DD`) of an instant in Mexico City. */
export const dayKey = (value: string | Date) => ymdFormat.format(typeof value === "string" ? new Date(value) : value);

function parseDay(day: unknown): number | null {
  if (typeof day !== "string") return null;
  const match = YMD.exec(day);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : time;
}
const DAY_MS = 86_400_000;
const daysFromToday = (day: unknown, now: Date) => {
  const target = parseDay(day), today = parseDay(dayKey(now));
  return target === null || today === null ? null : Math.round((target - today) / DAY_MS);
};

/** «jueves 26 de noviembre», with « de 2025» when the year is not the current one. */
function longDate(day: unknown, now: Date): string | null {
  const time = parseDay(day);
  if (time === null) return null;
  const parts = Object.fromEntries(longFormat.formatToParts(new Date(time)).map(p => [p.type, p.value]));
  const year = String(day).slice(0, 4);
  return `${parts.weekday} ${parts.day} de ${parts.month}${year === dayKey(now).slice(0, 4) ? "" : ` de ${year}`}`;
}
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Day section heading: «Hoy», «Ayer» or «Lunes 23 de noviembre». */
export function dayLabel(key: string, now: Date = new Date()): string {
  const diff = daysFromToday(key, now);
  if (diff === 0) return "Hoy";
  if (diff === -1) return "Ayer";
  return capitalize(longDate(key, now) ?? key);
}

const FUNCTIONS: Record<string, string> = { responsible: "responsable", collaborator: "colaborador", member: "integrante" };
const REASONS: Record<string, string> = {
  workload: "carga de trabajo", recruiter_departure: "salida del reclutador", performance: "desempeño",
  client_request: "solicitud del cliente", other: "otro motivo",
};
/**
 * Candidate-facing status words of the applications list (`features/candidate/saved/application-status.ts`,
 * `features/candidate/dashboard/charts.tsx`); `closed` has its own sentence.
 */
const CANDIDATE_STATUSES: Record<string, string> = { submitted: "Enviada", in_process: "En proceso" };
/**
 * Status badges of design 04 with the words and variants of `applicationBadge`
 * (`features/candidate/saved/application-status.ts`). Design 04's «Vacante cerrada» needs the vacancy state, which the
 * payload does not carry; `closed` is the application status, «Cerrada».
 */
const STATUS_BADGES: Record<string, NotificationStatusBadge> = {
  submitted: { label: "Enviada", variant: "info" },
  in_process: { label: "En proceso", variant: "review" },
  closed: { label: "Cerrada", variant: "neutral" },
};
const lookup = (table: Record<string, string>, value: unknown) => typeof value === "string" && Object.hasOwn(table, value) ? table[value] : null;
const known = (name: string | null | undefined) => name?.trim() ? name.trim() : null;

/** «A», «A y B», «A, B y C», or the first two plus «y N más» when the sample does not cover the group. */
function namesLine(group: NotificationGroup): string | null {
  const names = group.sample.map(s => known(s.name) ?? "Candidato");
  if (names.length === 0) return null;
  if (group.count <= names.length) return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} y ${names.at(-1)}`;
  const shown = names.slice(0, 2);
  return `${shown.join(", ")} y ${group.count - shown.length} más`;
}

/** «hoy» / «mañana» for a due-soon date; «el {fecha}» otherwise; «pronto» when the payload has no date. */
function whenDue(day: unknown, now: Date): string {
  const diff = daysFromToday(day, now);
  if (diff === 0) return "hoy";
  if (diff === 1) return "mañana";
  const date = longDate(day, now);
  return date ? `el ${date}` : "pronto";
}

function urgencyOf(group: NotificationGroup, now: Date): NotificationUrgency | null {
  if (group.urgency === "overdue") return { label: "Vencida", variant: "danger" };
  if (group.urgency === "due_soon") return { label: capitalize(`vence ${whenDue(group.latest.payload.commitment_date, now)}`), variant: "review" };
  return null;
}

const generic = { title: "Nueva notificación", subtitle: null, icon: "generic", tone: "muted" } as const;

type Body = Omit<NotificationCopy, "urgency">;

function body(group: NotificationGroup, now: Date): Body {
  const vacancy = known(group.job?.title) ?? "una vacante";
  const payload = group.latest.payload;
  const actor = known(group.latest.actor?.name) ?? "Alguien";
  const fn = lookup(FUNCTIONS, payload.function);
  const reason = lookup(REASONS, payload.reason);
  const motive = reason ? ` Motivo: ${reason}.` : "";
  const date = longDate(payload.commitment_date, now);
  const firstName = known(group.sample[0]?.name) ?? "Candidato";
  const many = group.count > 1;

  switch (group.type) {
    case "application_received":
      return {
        title: many ? `${group.count} postulaciones nuevas en ${vacancy}` : `Nueva postulación en ${vacancy}`,
        subtitle: namesLine(group), icon: "application", tone: "primary",
      };
    case "delivery_due_soon":
      return {
        title: `La entrega de ${vacancy} vence ${whenDue(payload.commitment_date, now)}`,
        subtitle: date ? `Fecha compromiso: ${date}` : null, icon: "due-soon", tone: "review",
      };
    case "delivery_overdue":
      return { title: `La entrega de ${vacancy} está vencida`, subtitle: date ? `Fecha compromiso: ${date}` : null, icon: "overdue", tone: "danger" };
    case "assignment_deadline_due_soon":
      return {
        title: `Tu fecha límite en ${vacancy} es ${whenDue(payload.commitment_date, now)}`,
        subtitle: date ? (fn ? `Como ${fn}, tu entrega vence el ${date}.` : `Tu entrega vence el ${date}.`) : null,
        icon: "due-soon", tone: "review",
      };
    case "assignment_deadline_overdue":
      return {
        title: `Venció tu fecha límite en ${vacancy}`,
        subtitle: date ? (fn ? `Tu entrega como ${fn} era el ${date}.` : `Tu entrega era el ${date}.`) : null,
        icon: "overdue", tone: "danger",
      };
    case "vacancy_assigned":
      return { title: `Te asignaron ${vacancy}`, subtitle: `${actor} te hizo responsable.`, icon: "assignment", tone: "info" };
    case "vacancy_reassigned": {
      const from = known(group.from_user?.name);
      return {
        title: `Ahora eres responsable de ${vacancy}`,
        subtitle: `${actor} te la reasignó${from ? ` desde ${from}` : ""}.${motive}`, icon: "assignment", tone: "info",
      };
    }
    case "vacancy_unassigned": {
      const to = known(group.to_user?.name);
      return {
        title: `Ya no eres responsable de ${vacancy}`,
        subtitle: `${actor} reasignó la vacante${to ? ` a ${to}` : ""}.${motive}`, icon: "assignment", tone: "info",
      };
    }
    case "vacancy_team_added":
      return { title: `Te agregaron al equipo de ${vacancy}`, subtitle: fn ? `Como ${fn}.` : null, icon: "team", tone: "info" };
    case "psychometric_completed":
      return {
        title: many ? `${group.count} pruebas psicométricas completadas en ${vacancy}` : `${firstName} completó su prueba psicométrica`,
        subtitle: many ? namesLine(group) : known(group.job?.title), icon: "psychometric-done", tone: "success",
      };
    case "psychometric_pending":
      return {
        title: many ? `${group.count} pruebas psicométricas pendientes en ${vacancy}` : `Prueba psicométrica pendiente de ${firstName}`,
        subtitle: many ? namesLine(group) : known(group.job?.title), icon: "psychometric-pending", tone: "muted",
      };
    // Candidate inbox (T3.6, design 04): one item per notification; company resolved by the API or null (L14).
    // `candidate_test_pending` has no badge: design 04's due-date badge needs a date the payload ({invitation_id}) lacks.
    case "candidate_status_changed": {
      const label = lookup(CANDIDATE_STATUSES, payload.status);
      const badge = typeof payload.status === "string" && Object.hasOwn(STATUS_BADGES, payload.status) ? STATUS_BADGES[payload.status] : null;
      return {
        title: payload.status === "closed" ? `Tu postulación a ${vacancy} se cerró`
          : label ? `Tu postulación a ${vacancy} pasó a ${label}` : `Tu postulación a ${vacancy} cambió de estado`,
        subtitle: known(group.company?.name), icon: "status", tone: "info",
        ...(badge && { badge: { ...badge } }),
      };
    }
    case "candidate_message_received":
      return {
        title: `${known(group.company?.name) ?? "Una empresa"} te dejó un mensaje sobre ${vacancy}`,
        subtitle: "Abre tu postulación para leerlo.", icon: "message", tone: "primary",
      };
    case "candidate_test_pending":
      return {
        title: "Tienes una prueba psicométrica pendiente",
        subtitle: [known(group.job?.title), known(group.company?.name)].filter(Boolean).join(" · ") || null, icon: "test", tone: "review",
      };
    default:
      return generic;
  }
}

/** Title, subtitle, icon, tone, urgency badge and (candidate status rows only) status badge of one inbox row. */
export function describeNotification(group: NotificationGroup, now: Date = new Date()): NotificationCopy {
  const described = body(group, now);
  return { ...described, urgency: described === generic ? null : urgencyOf(group, now) };
}

export const participationHref = (jobId: string, participationId: string) =>
  `/empresa/vacantes/${jobId}/pipeline?candidato=${encodeURIComponent(participationId)}`;

/** Deep link of a row (L10); `null` keeps the row unclickable. */
export function notificationTarget(link: NotificationLink | null): NotificationTarget | null {
  if (!link) return null;
  switch (link.kind) {
    case "vacancy":
    case "vacancy_candidates":
      return { href: `/empresa/vacantes/${link.job_id}/pipeline`, destination: "Pipeline" };
    case "participation":
      return { href: participationHref(link.job_id, link.participation_id), destination: "Candidato" };
    case "vacancy_delivery":
      return { href: `/empresa/vacantes/${link.job_id}/configuracion/entrega`, destination: "Entrega" };
    case "application":
      return { href: `/candidato/postulaciones?postulacion=${encodeURIComponent(link.participation_id)}`, destination: "Postulación" };
    case "assessment":
      return { href: `/candidato/evaluaciones/${link.invitation_id}`, destination: "Evaluación" };
  }
}

/** Accessible name of the bell; `null` while the first count is unknown. */
export function bellLabel(unread: number | null): string {
  if (unread === null) return "Notificaciones";
  return unread > 0 ? `Notificaciones, ${unread} sin leer` : "Notificaciones, todo leído";
}

/** Visible counter on the bell, capped at «9+». */
export function bellBadge(unread: number | null): string | null {
  if (!unread || unread < 1) return null;
  return unread > 9 ? "9+" : String(unread);
}

/** Line under the sheet title. */
export function inboxSummary({ loading, unread, attention }: { loading: boolean; unread: number | null; attention: number | null }): string {
  if (loading) return "Cargando…";
  if (unread === null) return "";
  if (unread === 0) return "Todo leído";
  const attentionText = attention ? ` · ${attention} ${attention === 1 ? "requiere" : "requieren"} atención` : "";
  return `${unread} sin leer${attentionText}`;
}

/** «Ver los N» when the sample is the whole group, «Ver los últimos N» when it is only the newest ones. */
export function sampleToggleLabel({ count, shown }: { count: number; shown: number }, open: boolean): string {
  if (open) return "Ocultar";
  return count > shown ? `Ver los últimos ${shown}` : `Ver los ${shown}`;
}

/** Type groups of the «Filtrar» popover (design 07); an empty selection means every type («Todos»). */
export const FILTER_GROUPS = [
  { key: "applications", label: "Postulaciones", types: ["application_received"] },
  { key: "deliveries", label: "Entregas", types: ["delivery_due_soon", "delivery_overdue", "assignment_deadline_due_soon", "assignment_deadline_overdue"] },
  { key: "team", label: "Vacantes y equipo", types: ["vacancy_assigned", "vacancy_reassigned", "vacancy_unassigned", "vacancy_team_added"] },
  { key: "tests", label: "Pruebas", types: ["psychometric_completed", "psychometric_pending"] },
] as const satisfies readonly { key: string; label: string; types: readonly NotificationType[] }[];
export type FilterGroupKey = (typeof FILTER_GROUPS)[number]["key"];
export type FilterJob = { id: string; title: string | null };
/** Backend cap on `job_ids` per request. */
export const MAX_FILTER_JOBS = 20;

const filterGroup = (key: FilterGroupKey) => FILTER_GROUPS.find(group => group.key === key)!;

/** Backend `types` for the selected groups, in popover order. */
export const filterTypes = (keys: readonly FilterGroupKey[]): NotificationType[] =>
  FILTER_GROUPS.filter(group => keys.includes(group.key)).flatMap(group => [...group.types]);

/** Facet count of a group: the sum of its types' counts. */
export function filterGroupCount(types: readonly { type: string; count: number }[], key: FilterGroupKey): number {
  const members: readonly string[] = filterGroup(key).types;
  return types.reduce((sum, facet) => members.includes(facet.type) ? sum + facet.count : sum, 0);
}

export const jobTitle = (title: string | null) => title?.trim() ? title.trim() : "Vacante sin título";

/** One-line summary under the tabs: «Postulaciones · Analista de Nómina» or «2 tipos · 2 vacantes». */
export function filterSummary(groups: readonly FilterGroupKey[], jobs: readonly FilterJob[]): string {
  const parts: string[] = [];
  if (groups.length) parts.push(groups.length === 1 ? filterGroup(groups[0]).label : `${groups.length} tipos`);
  if (jobs.length) parts.push(jobs.length === 1 ? jobTitle(jobs[0].title) : `${jobs.length} vacantes`);
  return parts.join(" · ");
}

export const activeFiltersLabel = (n: number) => `, ${n} ${n === 1 ? "filtro activo" : "filtros activos"}`;

/** Popover footer button; `null` when the number of results is not known. */
export function showResultsLabel(n: number | null): string {
  if (n === null) return "Ver notificaciones";
  return `Ver ${n} ${n === 1 ? "notificación" : "notificaciones"}`;
}

export const jobsShownNote = (shown: number, total: number) => `Mostrando ${shown} de ${total} vacantes`;

export const noResultsDescription = (summary: string, tab: NotificationState) =>
  `Ninguna notificación${tab === "unread" ? " sin leer" : ""} coincide con ${summary}. Los filtros se conservan para que ajustes uno.`;

/** Status after «Marcar todo como leído»; N = affected notifications. */
export const markedAllStatus = (n: number) => n === 1 ? "1 marcada como leída" : `${n} marcadas como leídas`;

/* ---------- «Mis preferencias» (T4.2, design 05; contract notifications-v2 E2) ---------- */

/** The personal preferences page of each scope (contract v2 §Path map, `preferences_url`). */
export const preferencesHref = (scope: NotificationScope) =>
  scope === "candidate" ? "/candidato/configuracion/notificaciones" : "/empresa/configuracion/notificaciones";

export type PreferenceCopy = { title: string; description: string | null };

/** Row name and one-line explanation per type; wording from design 05 where it has the row. */
const PREFERENCE_COPY: Readonly<Record<NotificationType, PreferenceCopy>> = {
  application_received: { title: "Nueva postulación", description: "En las vacantes donde eres responsable o estás en el equipo. Se agrupan por vacante." },
  delivery_due_soon: { title: "Entrega por vencer", description: "Antes de la fecha de entrega de tus vacantes." },
  delivery_overdue: { title: "Entrega vencida", description: "Cuando pasa la fecha de entrega sin completar los candidatos." },
  assignment_deadline_due_soon: { title: "Tu fecha límite se acerca", description: "Antes de que venza tu entrega en una vacante donde participas." },
  assignment_deadline_overdue: { title: "Venció tu fecha límite", description: "Cuando pasa la fecha de tu entrega en una vacante." },
  vacancy_assigned: { title: "Te asignan una vacante", description: "Cuando quedas como responsable de una vacante." },
  vacancy_reassigned: { title: "Te reasignan una vacante", description: "Cuando una vacante pasa de otra persona a ti." },
  vacancy_unassigned: { title: "Dejas de ser responsable de una vacante", description: "Cuando otra persona queda a cargo de una vacante tuya." },
  vacancy_team_added: { title: "Te agregan al equipo de una vacante", description: "Desde ese momento recibes sus postulaciones y entregas." },
  psychometric_completed: { title: "Prueba completada", description: "Cuando un candidato de tus vacantes termina su prueba. Se agrupan por vacante." },
  psychometric_pending: { title: "Prueba pendiente del candidato", description: "Cuando un candidato de tus vacantes aún no responde su prueba." },
  candidate_status_changed: { title: "Cambios en tus postulaciones", description: "Cuando una empresa cambia el estado de tu postulación o cierra la vacante." },
  candidate_message_received: { title: "Mensajes de las empresas", description: "Cuando una empresa te escribe sobre una postulación." },
  candidate_test_pending: { title: "Pruebas pendientes", description: "Cuando una empresa te envía una prueba psicométrica." },
};
const isKnownType = (type: string): type is NotificationType => Object.hasOwn(PREFERENCE_COPY, type);

/** A type this build does not know yet is kept and labelled generically. */
export const preferenceCopy = (type: string): PreferenceCopy =>
  isKnownType(type) ? PREFERENCE_COPY[type] : { title: "Otro aviso", description: null };

export const CHANNEL_LABELS: Readonly<Record<NotificationChannel, string>> = { in_app: "En la app", email: "Correo" };

/** Groups of the page: the inbox filter groups for members, one group for candidates (design 05); unknown types last. */
const CANDIDATE_PREFERENCE_GROUPS = [
  { key: "applications", label: "Tus postulaciones", types: ["candidate_status_changed", "candidate_message_received", "candidate_test_pending"] },
] as const;
export type PreferenceGroup = { key: string; label: string; items: PreferenceItem[] };

export function preferenceGroups(scope: NotificationScope, items: readonly PreferenceItem[]): PreferenceGroup[] {
  const groups: readonly { key: string; label: string; types: readonly string[] }[] = scope === "candidate" ? CANDIDATE_PREFERENCE_GROUPS : FILTER_GROUPS;
  const grouped = groups.map(group => ({ key: group.key, label: group.label, items: items.filter(item => group.types.includes(item.type)) }));
  const others = items.filter(item => !groups.some(group => group.types.includes(item.type)));
  return [...grouped, { key: "others", label: "Otros avisos", items: others }].filter(group => group.items.length > 0);
}

export const unsavedChangesLabel = (n: number) => `${n} ${n === 1 ? "cambio sin guardar" : "cambios sin guardar"}`;

/** «Tu ajuste» badge (design 05): which channels differ from the recommended default, and what that default is. */
export function adjustmentLabel(item: PreferenceItem, value: Readonly<Record<NotificationChannel, boolean>>): string | null {
  const parts: string[] = [];
  if (value.in_app !== item.channels.in_app.default) parts.push(`en la app ${item.channels.in_app.default ? "encendido" : "apagado"}`);
  if (value.email !== item.channels.email.default) parts.push(`correo ${item.channels.email.default ? "encendido" : "apagado"}`);
  return parts.length ? `Tu ajuste · recomendado: ${parts.join(", ")}` : null;
}

/** Badge of a row with locked channels: «Obligatoria» when every channel is locked (design 05), else the locked one. */
export function lockedLabel(locked: readonly NotificationChannel[]): string | null {
  if (locked.length === 0) return null;
  if (locked.length > 1) return "Obligatoria";
  return locked[0] === "email" ? "Obligatoria por correo" : "Obligatoria en la app";
}
