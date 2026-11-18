import { z } from "zod";
import { personSchema, requesterSchema, STAGE_KINDS } from "@/features/company-metrics/model";

/**
 * Decoders for `docs/contracts/company-dashboard-v2.md` §3 (backend d2a, `feat/stakeholder-metrics-v2-backend`
 * `569f75f1`): one route per section under `/v2/me/company/dashboard/…`, owner and recruiter only, the scope taken from
 * the session (DD1). Every response carries the d2 header: definitions version, window, `as_of` and scope.
 */
export const WINDOWS = [7, 30, 90] as const;
export type DashboardWindow = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: DashboardWindow = 30;
/** `window` from the URL or a caller: exactly 7, 30 or 90; anything else is the contract default (30). */
export function parseWindow(value: unknown): DashboardWindow {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  return WINDOWS.find(window => String(window) === text) ?? DEFAULT_WINDOW;
}

const count = z.number().int().nonnegative().safe();
const uuid = z.string().uuid();
const day = z.string().date();
const timestamp = z.string().datetime({ offset: true });
const DAY_MS = 86_400_000;
const consecutive = (dates: string[]) => dates.every((date, i) => i === 0 || Date.parse(date) - Date.parse(dates[i - 1]) === DAY_MS);

const headerShape = {
  definitions_version: z.string().min(1),
  window: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]), from: day, to: day, previous_from: day, previous_to: day }).strict(),
  as_of: timestamp,
  scope: z.enum(["company", "own_vacancies"]),
};
const delta = z.object({ current: count, previous: count }).strict();
const positions = z.object({ covered: count, required: count }).strict();
const vacancyRef = z.object({ draft_id: uuid, title: z.string() }).strict();

/** §3.1 Resumen. The series is the previous window's last day, then every window day, oldest first. */
export const summarySchema = z.object({
  ...headerShape,
  in_process: z.object({ current: count, previous: count, series: z.array(z.object({ date: day, value: count }).strict()) }).strict(),
  published_vacancies: delta,
  /** null without talent-base access (talent-base-visibility). */
  pool_added: delta.nullable(),
  positions,
}).strict().refine(({ in_process: { series }, window }) => series.length === window.days + 1 && series[0]?.date === window.previous_to
  && series.at(-1)?.date === window.to && consecutive(series.map(point => point.date)), "Expected one point per window day plus the previous window's last day");

const deliveryRow = { vacancy: vacancyRef, requester: requesterSchema, responsible: personSchema.nullable(), commitment_date: day, delivered: count, target: count };
const group = <T extends z.ZodTypeAny>(row: T) => z.object({ total: count, top: z.array(row).max(5) }).strict();
/** §3.2 Necesita atención: state now, not window-bound; up to five rows per group. */
export const attentionSchema = z.object({
  ...headerShape,
  overdue: group(z.object({ ...deliveryRow, business_days_overdue: count }).strict()),
  due_this_week: group(z.object(deliveryRow).strict()),
  stalled: z.object({
    total: count, threshold_business_days: count,
    top: z.array(z.object({
      participation_id: uuid, candidate: z.object({ id: uuid, full_name: z.string() }).strict(), vacancy: vacancyRef,
      stage: z.object({ kind: z.enum(STAGE_KINDS), name: z.string() }).strict(), business_days_in_stage: count,
    }).strict()).max(5),
  }).strict(),
}).strict().refine(value => [value.overdue, value.due_this_week, value.stalled].every(item => item.top.length <= item.total), "Rows beyond the total");

/** §3.3 Pipeline por etapa: metrics §4.4 stages, scoped by role, no top vacancies. */
export const pipelineSchema = z.object({
  ...headerShape,
  stalled_threshold_business_days: count,
  stages: z.array(z.object({ kind: z.enum(STAGE_KINDS), candidates: count, median_business_days_in_stage: z.number().nonnegative().finite().nullable(), stalled: count }).strict()),
}).strict();

/** §3.4 Vacantes activas: the five published vacancies in scope with most «en proceso» (DD2), 0 included. */
export const vacanciesSchema = z.object({
  ...headerShape,
  top: z.array(z.object({ vacancy: vacancyRef, requester: requesterSchema, responsible: personSchema.nullable(), in_process: count, positions }).strict()).max(5),
}).strict();

const recentPerson = z.object({ id: uuid, name: z.string() }).strict();
export const recentRowSchema = z.object({
  participation_id: uuid,
  candidate: z.object({ kind: z.enum(["organic", "manual"]), id: uuid, name: z.string(), professional_title: z.string().nullable() }).strict(),
  vacancy: z.object({ id: uuid, title: z.string() }).strict(),
  stage: recentPerson.extend({ kind: z.enum(["new", "screening", "screening_ok", "in_process", "placement", "discarded", "custom"]) }).strict(),
  source: z.enum(["organic", "manual"]),
  applied_at: timestamp,
  added_by: recentPerson.nullable(),
}).strict().refine(row => row.source === "organic" ? row.added_by === null : row.added_by !== null, "Source and added_by must agree");
/** §3.5 recent: the five newest participations in scope (the old dashboard's row shape). */
export const recentSchema = z.object({ ...headerShape, recent: z.array(recentRowSchema).max(5) }).strict();

/** §3.5 origin: one point per window day, oldest first; organic = portal, careers site and unknown channels. */
export const originSchema = z.object({
  ...headerShape,
  by_day: z.array(z.object({ date: day, organic: count, manual: count }).strict()),
}).strict().refine(({ by_day, window }) => by_day.length === window.days && by_day[0]?.date === window.from && by_day.at(-1)?.date === window.to
  && consecutive(by_day.map(point => point.date)), "Expected one point per window day");

export const errorEnvelopeSchema = z.object({ error: z.string(), code: z.string().min(1), fields: z.array(z.object({ field: z.string(), code: z.string() })).optional() });

export type DashboardHeader = { [K in keyof typeof headerShape]: z.infer<(typeof headerShape)[K]> };
export type SummarySection = z.infer<typeof summarySchema>;
export type AttentionSection = z.infer<typeof attentionSchema>;
export type PipelineSection = z.infer<typeof pipelineSchema>;
export type VacanciesSection = z.infer<typeof vacanciesSchema>;
export type RecentRow = z.infer<typeof recentRowSchema>;
export type RecentSection = z.infer<typeof recentSchema>;
export type OriginSection = z.infer<typeof originSchema>;
export type DashboardErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
export type DashboardSectionName = "summary" | "attention" | "pipeline" | "vacancies" | "recent" | "origin";
