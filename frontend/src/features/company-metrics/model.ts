import { z } from "zod";
import { processKindSchema } from "@/features/vacancy-lifecycle/model";
import { STAGE_KIND_LABELS } from "@/features/jobs/drafts/pipeline/editor-model";

/**
 * Decoders and es-MX presentation for `docs/contracts/stakeholder-metrics-v1.md` §3 (backend `39669aa5`) and the
 * additive v2 (`stakeholder-metrics-v2.md`, backend branch `feat/stakeholder-metrics-v2-backend`): every v2 response adds
 * `as_of`, and v1 routes keep their fields, so the v1 decoders accept v2 answers too.
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
/** v2 §3: every response carries `as_of`, the instant of the snapshot it was computed from; v1 answers have none. */
const envelope = { definitions_version: text, period: z.object({ from: day, to: day, time_zone: text }).strict(), as_of: timestamp.optional() };
const closedReasons = { filled: count, cancelled: count, other: count, no_reason: count };
const reassignmentReasons = { workload: count, recruiter_departure: count, performance: count, client_request: count, other: count };
const comparison = <T extends z.ZodTypeAny>(value: T) => z.object({ current: value, previous: value }).strict();
const monthRateSchema = z.object({ month, rate: rateSchema }).strict();

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
    by_reason: z.object(reassignmentReasons).strict(),
  }).strict(),
  // «Sin solicitante» is `requester: null`; «sin especificar» is `{ kind, id: null, name: null }` (M5).
  by_requester: z.array(z.object({ requester: requesterSchema, vacancies: count, filled: count }).strict()),
  // v2 §4.1: the previous window of the same length (N1) and the monthly on-time rate (N2); absent in v1 answers.
  previous_period: z.object({ from: day, to: day }).strict().optional(),
  headline: z.object({
    on_time_rate: comparison(rateSchema),
    assigned: comparison(count),
    median_business_days_to_close: comparison(median),
    placements: comparison(count),
    reassignments: comparison(count),
  }).strict().optional(),
  on_time_by_month: z.array(monthRateSchema).optional(),
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
/**
 * replacement-processes-v1 «Metrics» (R6b): the flat `vacancies` rows (roots only) carry `replacements` — how many the logical
 * vacancy started and the one still active — and the per-vacancy detail reads carry `process` beside `draft_id`. Both stay
 * OPTIONAL (an old backend sends neither); a detail asked with another `process_kind` answers `items: []`.
 */
const replacementsSummarySchema = z.object({ count, active_draft_id: text.nullable() });
const detailProcessSchema = z.object({ kind: processKindSchema, root_draft_id: text, sequence: z.number().int().positive().nullable() });
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
  replacements: replacementsSummarySchema.optional(),
});
export const vacancyPageSchema = z.object({ ...envelope, items: z.array(vacancyRowSchema).max(100), next_cursor: z.string().nullable() });
/**
 * replacement-processes-v1 «Metrics»: the shared Go `VacancyRef` gains these keys. They stay OPTIONAL until the backend that
 * emits them is deployed (contract «Deployment order» step 1); `sequence` is `null` for an original.
 */
const replacementRefKeys = { kind: processKindSchema.optional(), root_draft_id: text.optional(), sequence: z.number().int().positive().nullable().optional() };
export const reassignmentReasonSchema = z.enum(["workload", "recruiter_departure", "performance", "client_request", "other"]);
export const reassignmentRowSchema = z.object({
  id: text, performed_at: timestamp, vacancy: z.object({ draft_id: text, title: z.string().nullable(), ...replacementRefKeys }),
  from: personSchema.nullable(), to: personSchema, reason: reassignmentReasonSchema, note: z.string().nullable(),
  performed_by: personSchema.nullable(), outgoing_tramo_business_days: count.nullable(),
});
export const reassignmentPageSchema = z.object({ ...envelope, items: z.array(reassignmentRowSchema).max(100), next_cursor: z.string().nullable() });
/** The candidate with the company's name correction applied (§3.7.9). */
const candidateSchema = z.object({ id: text, full_name: z.string() });
export const deliveriesSchema = z.object({ process: detailProcessSchema.optional(), items: z.array(z.object({ candidate: candidateSchema, reached_at: timestamp, delivered_by: personSchema.nullable() })) });
export const placementsSchema = z.object({
  process: detailProcessSchema.optional(),
  items: z.array(z.object({
    // Voided credits never appear (M3).
    candidate: candidateSchema, hired_at: timestamp, status: z.enum(["active", "did_not_hold"]),
    recipients: z.array(z.object({ person: personSchema, kind: z.enum(["direct", "participant", "shared"]) })),
  })),
});
/** v2 §4.2 Cierres y entregas: `closed` counts distinct vacancies; the reasons split it and add up to it. */
export const closuresSchema = z.object({
  ...envelope,
  closed_by_month: z.array(z.object({ month, closed: count, ...closedReasons }).strict()),
  delivery_status: z.object({ on_time: count, late: count, overdue: count, pending: count, not_configured: count }).strict(),
}).strict();
/** v2 §4.3 Cumplimiento: late deliveries split by business days late (0–2, 3–5, more than 5); they add up to `late`. */
export const complianceSchema = z.object({
  ...envelope,
  late_buckets: z.object({ up_to_2: count, from_3_to_5: count, over_5: count }).strict(),
  on_time_by_month: z.array(monthRateSchema),
}).strict();
/**
 * v2 §4.5 Retrasos. `overdue.top` (N4) holds at most 4 rows, most business days overdue first; `requester` and
 * `attributed_to` (the responsible, or every member when shared) arrive with v2b, so they are optional here.
 */
export const delaysSchema = z.object({
  ...envelope,
  closing_target: z.object({ on_time: count, late: count, no_target: count }).strict(),
  overdue: z.object({
    total: count,
    top: z.array(z.object({
      vacancy: z.object({ draft_id: text, title: z.string().nullable(), ...replacementRefKeys }).strict(),
      commitment_date: day, business_days_overdue: count, delivered: count, target: count,
      requester: requesterSchema.optional(), attributed_to: z.array(personSchema).optional(),
    }).strict()).max(4),
  }).strict(),
  reassignments_by_reason: z.object(reassignmentReasons).strict(),
}).strict();
/** v2 §4.6: applications created in the period by channel. */
export const originSchema = z.object({
  ...envelope,
  by_channel: z.object({ portal: count, careers_site: count, manual: count, unknown: count }).strict(),
}).strict();

/** v2 §4.4 stage kinds in the contract order; every vacancy's custom stages fold into `custom`, `retired` only when > 0. */
export const STAGE_KINDS = ["new", "screening", "screening_ok", "in_process", "custom", "placement", "retired"] as const;
const stageKindSchema = z.enum(STAGE_KINDS);
export type StageKind = (typeof STAGE_KINDS)[number];
/**
 * v2 §4.4 Pipeline por etapa (N3): a picture of now (`as_of`), not of the period, so `as_of` is required. Medians are
 * business days in the current stage; `stalled` never counts in placement.
 */
export const pipelineSchema = z.object({
  ...envelope, as_of: timestamp,
  stalled_threshold_business_days: count,
  stages: z.array(z.object({ kind: stageKindSchema, candidates: count, median_business_days_in_stage: median, stalled: count }).strict()),
  top_vacancies: z.array(z.object({
    vacancy: z.object({ draft_id: text, title: z.string().nullable(), ...replacementRefKeys }).strict(), requester: requesterSchema, responsible: personSchema.nullable(), in_process: count,
  }).strict()).max(5),
}).strict();

/**
 * v2 §5 detail lists: `total` is the exact count for the filters, `facets` count the tabs (each ignoring only its own
 * filter, every enum value present), `applied_filters` echo the request with names resolved (null names for ids of
 * another company). Rows decode only what the page reads, like the v1 lists.
 */
const vacancyRefSchema = z.object({ draft_id: text, title: z.string().nullable(), ...replacementRefKeys });
const detailRequesterSchema = z.object({ kind: requesterKind, id: z.string().nullable(), name: z.string().nullable() });
export const appliedFiltersSchema = z.object({
  recruiter: personSchema.optional(), attributed_to: personSchema.optional(), recipient: personSchema.optional(), credited_to: personSchema.optional(),
  // «Sin solicitante» echoes as "none"; a kind sent alone echoes as `requester_kind`, never as a requester (v2b note).
  requester: z.union([z.literal("none"), detailRequesterSchema]).optional(),
  requester_kind: requesterKind.optional(),
  vacancy: vacancyRefSchema.optional(),
  result: z.array(z.string()).optional(), close_reason: z.array(z.string()).optional(), reason: z.array(z.string()).optional(),
  late_bucket: z.string().optional(), commitment_month: z.string().optional(), scope: z.string().optional(), closed_month: z.string().optional(),
  closing_target: z.string().optional(), direction: z.string().optional(), held: z.boolean().optional(),
  // replacement-processes-v1 «Metrics»: echoed by every list; absent on an old backend and when the view is «Todos».
  process_kind: z.string().optional(),
  stage_kind: z.array(z.string()).optional(), stalled: z.boolean().optional(), channel: z.array(z.string()).optional(),
});
const detailList = <R extends z.ZodTypeAny, F extends z.ZodTypeAny>(row: R, facets: F) => z.object({
  ...envelope, total: count, facets, applied_filters: appliedFiltersSchema, items: z.array(row).max(100), next_cursor: z.string().nullable(),
});
export const deliveryListRowSchema = z.object({
  vacancy: vacancyRefSchema, requester: requesterSchema, attributed_to: z.array(personSchema),
  commitment_date: day.nullable(), target_reached_at: timestamp.nullable(), result: deliveryResultSchema,
  business_days_late: count.nullable(), business_days_overdue: count.nullable(), delivered: count, target: count.nullable(),
});
export const vacancyListRowSchema = z.object({
  draft_id: text, title: z.string().nullable(), requester: requesterSchema, responsible: personSchema.nullable(), opened_at: timestamp.nullable(),
  last_close: z.object({ date: day, reason: z.enum(["filled", "cancelled", "other"]).nullable() }).nullable(),
  business_days_to_close: count.nullable(), closing_target: z.enum(["on_time", "late", "no_target"]).nullable(),
  replacements: replacementsSummarySchema.optional(),
});
export const placementListRowSchema = z.object({
  credit_id: text, candidate: candidateSchema, vacancy: vacancyRefSchema, requester: requesterSchema,
  recipients: z.array(z.object({ person: personSchema, kind: z.enum(["direct", "participant", "shared"]) })),
  status: z.enum(["active", "did_not_hold"]), hired_at: timestamp,
});
/** §5.5: one active participation of an open vacancy; `stage.name` is empty when unknown. */
export const candidateListRowSchema = z.object({
  participation_id: text, candidate: candidateSchema, vacancy: vacancyRefSchema, stage: z.object({ kind: stageKindSchema, name: z.string() }),
  business_days_in_stage: count, stalled: z.boolean(), entered_stage_at: timestamp,
});
/** §5.6: one vacancy with applications in the period; `total` sums only the chosen channels. */
export const applicationListRowSchema = z.object({
  vacancy: vacancyRefSchema, requester: requesterSchema, portal: count, careers_site: count, manual: count, unknown: count, total: count,
});
const channels = { portal: count, careers_site: count, manual: count, unknown: count };
export const deliveryListSchema = detailList(deliveryListRowSchema, z.object({ result: z.object({ on_time: count, late: count, overdue: count, pending: count, not_configured: count }) }));
export const vacancyListSchema = detailList(vacancyListRowSchema, z.object({ close_reason: z.object(closedReasons) }));
export const placementListSchema = detailList(placementListRowSchema, z.object({ held: z.object({ true: count, false: count }) }));
export const reassignmentListSchema = detailList(reassignmentRowSchema, z.object({ reason: z.object(reassignmentReasons) }));
export const candidateListSchema = detailList(candidateListRowSchema, z.object({
  stage_kind: z.object({ new: count, screening: count, screening_ok: count, in_process: count, custom: count, placement: count, retired: count.optional() }),
  stalled: count,
}));
/** Its `total` is the sum of applications in the chosen channels (the origin figure), not the row count. */
export const applicationListSchema = detailList(applicationListRowSchema, z.object({ channel: z.object(channels) }));

/** Narrow read of `GET /me/company`: only the role decides this screen. Follow-up: unify with employer-company once it parses `stakeholder` (T4). */
export const companyAccessSchema = z.object({ role: z.enum(["owner", "recruiter", "stakeholder"]) });
export const errorEnvelopeSchema = z.object({
  error: z.string(), code: text, fields: z.array(z.object({ field: text, code: text })).optional(),
  // v2 §8: a too-large export says how many rows it would have and the limit.
  row_count: count.optional(), limit: count.optional(),
});

export type Rate = z.infer<typeof rateSchema>;
export type Person = z.infer<typeof personSchema>;
export type Requester = z.infer<typeof requesterSchema>;
export type MetricsSummary = z.infer<typeof summarySchema>;
export type MonthRate = z.infer<typeof monthRateSchema>;
export type ClosuresSection = z.infer<typeof closuresSchema>;
export type ComplianceSection = z.infer<typeof complianceSchema>;
export type DelaysSection = z.infer<typeof delaysSchema>;
export type OriginSection = z.infer<typeof originSchema>;
export type PipelineSection = z.infer<typeof pipelineSchema>;
export type RecruiterCard = z.infer<typeof recruiterCardSchema>;
export type RecruiterPage = z.infer<typeof recruiterPageSchema>;
/** Every card of the period (all pages) with the snapshot instant and the definitions version they were computed with. */
export type RecruiterList = Pick<RecruiterPage, "items" | "as_of" | "definitions_version">;
export type RecruiterDetail = z.infer<typeof recruiterDetailSchema>;
export type VacancyRow = z.infer<typeof vacancyRowSchema>;
export type VacancyPage = z.infer<typeof vacancyPageSchema>;
export type ReassignmentRow = z.infer<typeof reassignmentRowSchema>;
export type ReassignmentPage = z.infer<typeof reassignmentPageSchema>;
export type DeliveriesDetail = z.infer<typeof deliveriesSchema>;
export type PlacementsDetail = z.infer<typeof placementsSchema>;
export type AppliedFilters = z.infer<typeof appliedFiltersSchema>;
export type DeliveryListRow = z.infer<typeof deliveryListRowSchema>;
export type VacancyListRow = z.infer<typeof vacancyListRowSchema>;
export type PlacementListRow = z.infer<typeof placementListRowSchema>;
export type DeliveryList = z.infer<typeof deliveryListSchema>;
export type VacancyList = z.infer<typeof vacancyListSchema>;
export type PlacementList = z.infer<typeof placementListSchema>;
export type ReassignmentList = z.infer<typeof reassignmentListSchema>;
export type CandidateListRow = z.infer<typeof candidateListRowSchema>;
export type ApplicationListRow = z.infer<typeof applicationListRowSchema>;
export type CandidateList = z.infer<typeof candidateListSchema>;
export type ApplicationList = z.infer<typeof applicationListSchema>;
/** One page of a detail list, tagged with its kind (the response itself carries none). */
export type DetailPage =
  | { kind: "deliveries"; page: DeliveryList } | { kind: "vacancies"; page: VacancyList }
  | { kind: "placements"; page: PlacementList } | { kind: "reassignments"; page: ReassignmentList }
  | { kind: "candidates"; page: CandidateList } | { kind: "applications"; page: ApplicationList };
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
/** Delivery rate of a card (v1 2.3): on time among the deliveries already judged; no sample without any. */
export function onTimeRate(card: RecruiterCard): Rate {
  const denominator = card.delivery.on_time + card.delivery.late + card.delivery.overdue;
  return { value: denominator > 0 ? card.delivery.on_time / denominator : null, numerator: card.delivery.on_time, denominator };
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

/** The pipeline's own stage words (`STAGE_KIND_LABELS`); custom and retired fold every vacancy's columns, so plural. */
export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  new: STAGE_KIND_LABELS.new, screening: STAGE_KIND_LABELS.screening, screening_ok: STAGE_KIND_LABELS.screening_ok, in_process: STAGE_KIND_LABELS.in_process,
  custom: "Columnas propias", placement: STAGE_KIND_LABELS.placement, retired: "Columnas retiradas",
};
export type Channel = keyof typeof channels;
/** Same words as the origin section (§4.6). */
export const CHANNEL_LABEL: Record<Channel, string> = {
  portal: "Portal de vacantes", careers_site: "Sitio de carreras", manual: "Registro manual", unknown: "Portal o sitio, sin distinguir",
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
