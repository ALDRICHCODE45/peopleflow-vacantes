import { z } from "zod";

/**
 * Decoders and es-MX presentation for `docs/contracts/stakeholder-metrics-v1.md` §3 (backend `39669aa5`).
 * Counts are integers and never null; medians and rate values are null without a sample (F3–F5).
 */
export const MX_TIME_ZONE = "America/Mexico_City";
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const count = z.number().int().nonnegative().safe();
const median = z.number().nonnegative().finite().nullable();
const text = z.string().min(1);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const month = z.string().regex(/^\d{4}-\d{2}$/);
const timestamp = z.string().datetime({ offset: true });

/** A rate always arrives as an object; only `value` is null, without a sample or with denominator 0. */
export const rateSchema = z.object({ value: z.number().min(0).max(1).nullable(), numerator: count, denominator: count }).strict();
export const personSchema = z.object({ user_id: text, name: z.string().nullable(), former_member: z.boolean() }).strict();
const requesterKind = z.enum(["client", "internal_area"]);
/** `id` and `name` null for «sin especificar»; the whole object null for «sin solicitante». */
export const requesterSchema = z.object({ kind: requesterKind, id: z.string().nullable(), name: z.string().nullable() }).strict().nullable();
const envelope = { definitions_version: text, period: z.object({ from: day, to: day, time_zone: text }).strict() };
const closedReasons = { filled: count, cancelled: count, other: count, no_reason: count };

export const summarySchema = z.object({
  ...envelope,
  vacancies: z.object({
    assigned: count, closed: z.object(closedReasons).strict(), median_business_days_to_close: median,
    closing_target: z.object({ on_time: count, late: count, no_target: count }).strict(),
  }).strict(),
  delivery: z.object({
    on_time: count, late: count, overdue: count, pending: count, not_configured: count, configured: count, total: count,
    on_time_rate: rateSchema, configured_rate: rateSchema, median_business_days_to_target: median, delivered: count,
  }).strict(),
  placements: z.object({ credits: count, did_not_hold: count, positions_covered: count, positions_required: count }).strict(),
  origin: z.object({ portal: count, careers_site: count, manual: count, unknown: count }).strict(),
  closed_by_month: z.array(z.object({ month, ...closedReasons }).strict()),
  reassignments: z.object({
    total: count,
    by_reason: z.object({ workload: count, recruiter_departure: count, performance: count, client_request: count, other: count }).strict(),
  }).strict(),
  // «Sin solicitante» is `requester: null`; «sin especificar» is `{ kind, id: null, name: null }` (M5).
  by_requester: z.array(z.object({ requester: requesterSchema, vacancies: count, filled: count }).strict()),
}).strict();

const cardShape = {
  user_id: text, name: z.string().nullable(), former_member: z.boolean(),
  vacancies: z.object({ assigned: count, as_responsible: count, as_collaborator: count, as_member: count, started_in_period: count }).strict(),
  delivery: z.object({ on_time: count, late: count, overdue: count, median_business_days_to_target: median, delivered_in_tramo: count }).strict(),
  placements: z.object({ direct: count, participant: count, shared: count, did_not_hold: count, closed_assigned: count, conversion: rateSchema }).strict(),
  reassignments: z.object({ received: count, lost: count }).strict(),
  business_days_in_tramos: count,
};
export const recruiterCardSchema = z.object(cardShape).strict();
export const recruiterPageSchema = z.object({ ...envelope, items: z.array(recruiterCardSchema).max(100), next_cursor: z.string().nullable() }).strict();
export const recruiterDetailSchema = z.object({
  ...envelope, ...cardShape,
  by_month: z.array(z.object({ month, assigned: count, delivery: z.object({ on_time: count, late: count, overdue: count }).strict(), placements: count }).strict()),
}).strict();

/**
 * §3.4 and §3.5 rows decode only what the screen reads and ignore other keys, so an extra key never blanks the list.
 * Names confirmed by the backend (M1–M4): `responsible`, `closes[].reason` (null for legacy closes),
 * `delivered_by` (null for an organic application landing in the cutoff stage), `recipients[{ person, kind }]`.
 */
export const deliveryResultSchema = z.enum(["on_time", "late", "overdue", "pending", "not_configured"]);
export const vacancyRowSchema = z.object({
  draft_id: text, title: z.string().nullable(), requester: requesterSchema, responsible: personSchema.nullable(),
  first_published_at: timestamp.nullable(),
  closes: z.array(z.object({ date: day, reason: z.enum(["filled", "cancelled", "other"]).nullable() })),
  delivery: z.object({
    result: deliveryResultSchema, target: count.nullable(), delivered: count, target_reached_at: timestamp.nullable(),
    commitment_date: day.nullable(), original_commitment_date: day.nullable(), renegotiations: count,
    // Set only when the result is `late` (§3.7.8).
    business_days_late: count.nullable(),
  }),
  placements: z.object({ covered: count, required: count }),
  reassignments: count,
});
export const vacancyPageSchema = z.object({ ...envelope, items: z.array(vacancyRowSchema).max(100), next_cursor: z.string().nullable() });
export const reassignmentReasonSchema = z.enum(["workload", "recruiter_departure", "performance", "client_request", "other"]);
export const reassignmentRowSchema = z.object({
  id: text, performed_at: timestamp, vacancy: z.object({ draft_id: text, title: z.string().nullable() }),
  from: personSchema.nullable(), to: personSchema, reason: reassignmentReasonSchema, note: z.string().nullable(),
  performed_by: personSchema.nullable(), outgoing_tramo_business_days: count.nullable(),
});
export const reassignmentPageSchema = z.object({ ...envelope, items: z.array(reassignmentRowSchema).max(100), next_cursor: z.string().nullable() });
/** The candidate with the company's name correction applied (§3.7.9). */
const candidateSchema = z.object({ id: text, full_name: z.string() });
export const deliveriesSchema = z.object({ items: z.array(z.object({ candidate: candidateSchema, reached_at: timestamp, delivered_by: personSchema.nullable() })) });
export const placementsSchema = z.object({
  items: z.array(z.object({
    // Voided credits never appear (M3).
    candidate: candidateSchema, hired_at: timestamp, status: z.enum(["active", "did_not_hold"]),
    recipients: z.array(z.object({ person: personSchema, kind: z.enum(["direct", "participant", "shared"]) })),
  })),
});
/** Narrow read of `GET /me/company`: only the role decides this screen. Follow-up: unify with employer-company once it parses `stakeholder` (T4). */
export const companyAccessSchema = z.object({ role: z.enum(["owner", "recruiter", "stakeholder"]) });
export const errorEnvelopeSchema = z.object({ error: z.string(), code: text, fields: z.array(z.object({ field: text, code: text })).optional() });

export type Rate = z.infer<typeof rateSchema>;
export type Person = z.infer<typeof personSchema>;
export type Requester = z.infer<typeof requesterSchema>;
export type MetricsSummary = z.infer<typeof summarySchema>;
export type RecruiterCard = z.infer<typeof recruiterCardSchema>;
export type RecruiterPage = z.infer<typeof recruiterPageSchema>;
export type RecruiterDetail = z.infer<typeof recruiterDetailSchema>;
export type VacancyRow = z.infer<typeof vacancyRowSchema>;
export type VacancyPage = z.infer<typeof vacancyPageSchema>;
export type ReassignmentRow = z.infer<typeof reassignmentRowSchema>;
export type ReassignmentPage = z.infer<typeof reassignmentPageSchema>;
export type DeliveriesDetail = z.infer<typeof deliveriesSchema>;
export type PlacementsDetail = z.infer<typeof placementsSchema>;
export type CompanyRole = z.infer<typeof companyAccessSchema>["role"];
export type MetricsErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type FilterIssue = { field: string; code: string };

export type MetricsFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "invalid_filter" | "invalid_cursor" | "not_found" | "server_error" | "no_response" | "unrecognized_response";
  fields?: FilterIssue[];
  reference: { status?: number; code?: string };
};
export type MetricsResult<T> = { ok: true; data: T } | MetricsFailure;
export type MetricsAccess = { kind: "allowed"; role: "owner" | "stakeholder" } | { kind: "restricted" } | MetricsFailure;

/** Owner and stakeholder see the company metrics (D2); recruiters keep «Mi rendimiento». */
export const metricsAllowed = (role: CompanyRole): role is "owner" | "stakeholder" => role === "owner" || role === "stakeholder";

export const NO_SAMPLE = "Sin datos suficientes";
const percent = new Intl.NumberFormat("es-MX", { style: "percent", maximumFractionDigits: 0 });
export const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
/** Spanish count agreement: singular for exactly one, plural otherwise. */
export const plural = (value: number, singular: string, pluralForm: string) => `${number.format(value)} ${value === 1 ? singular : pluralForm}`;

/** «67%» next to «20 de 30»; a missing value is «Sin datos suficientes», never 0%. */
export function formatRate(rate: Rate): { value: string; detail: string } {
  return { value: rate.value === null ? NO_SAMPLE : percent.format(rate.value), detail: `${number.format(rate.numerator)} de ${number.format(rate.denominator)}` };
}
export const formatMedian = (value: number | null) => value === null ? NO_SAMPLE : plural(value, "día hábil", "días hábiles");
/** A share of a count total, or null when the total is 0. */
export const share = (part: number, total: number) => total > 0 ? percent.format(part / total) : null;

/** The three recipient kinds already include did_not_hold credits (P3). */
export const placementTotal = (placements: RecruiterCard["placements"]) => placements.direct + placements.participant + placements.shared;

export const personName = (person: Pick<Person, "name">) => person.name?.trim() || "Persona sin nombre";
export function requesterLabel(requester: Requester): string {
  if (!requester) return "Sin solicitante";
  if (requester.name?.trim()) return requester.name;
  return requester.kind === "client" ? "Cliente sin especificar" : "Área sin especificar";
}
export const requesterKindLabel = (kind: "client" | "internal_area" | null) => kind === "client" ? "Cliente" : kind === "internal_area" ? "Área interna" : "No aplica";

export const DELIVERY_RESULT_LABEL: Record<z.infer<typeof deliveryResultSchema>, string> = {
  on_time: "A tiempo", late: "Tarde", overdue: "Vencida", pending: "Pendiente", not_configured: "Sin entrega configurada",
};
export const CLOSE_REASON_LABEL = { filled: "Cubierta", cancelled: "Cancelada", other: "Otro motivo", no_reason: "Sin motivo" } as const;
export const REASSIGNMENT_REASON_LABEL: Record<z.infer<typeof reassignmentReasonSchema>, string> = {
  workload: "Carga de trabajo", recruiter_departure: "Salida del reclutador", performance: "Desempeño", client_request: "Petición del cliente", other: "Otro motivo",
};

const monthFormat = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonthFormat = new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const momentFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
/** «Agosto de 2026» from `2026-08`. */
export const monthLabel = (value: string) => capitalize(monthFormat.format(new Date(`${value}-01T12:00:00Z`)));
export const shortMonthLabel = (value: string) => capitalize(shortMonthFormat.format(new Date(`${value}-01T12:00:00Z`)).replace(".", ""));
/** A civil date (`YYYY-MM-DD`) printed as is, never shifted by the browser's zone. */
export const dayLabel = (value: string) => dayFormat.format(new Date(`${value}T12:00:00Z`));
export const momentLabel = (value: string | Date) => momentFormat.format(typeof value === "string" ? new Date(value) : value);
