import type { ProcessKind } from "@/features/vacancy-lifecycle/model";
import { UUID_PATTERN } from "./model";
import { defaultPeriod, isIsoDay, periodIssues, type Period } from "./period";

/** Query filters of contract §3.0; the URL keeps the view shareable. Cursors are page state, never URL state. */
export type MetricsFilters = {
  from?: string; to?: string; recruiter_id?: string;
  requester_kind?: "client" | "internal_area";
  /** A requester id, or `none`: alone «sin solicitante», with a kind that kind «sin especificar» (M6). */
  requester_id?: string;
  /** replacement-processes-v1 «Metrics»: `original` = roots only, `replacement` = replacements only; absent = all. */
  process_kind?: ProcessKind;
};
export const NO_REQUESTER = "none";
const KEYS = ["from", "to", "recruiter_id", "requester_kind", "requester_id", "process_kind"] as const;
export const PROCESS_KIND_LABEL: Record<ProcessKind, string> = { original: "Originales", replacement: "Reemplazos" };
export const isProcessKind = (value: unknown): value is ProcessKind => value === "original" || value === "replacement";

/** Keeps only well-formed values: a hand-edited URL never reaches the API as a guaranteed 422. */
export function normalizeFilters(filters: MetricsFilters): MetricsFilters {
  const result: MetricsFilters = {};
  for (const key of ["from", "to"] as const) if (filters[key] && isIsoDay(filters[key]!)) result[key] = filters[key];
  if (filters.recruiter_id && UUID_PATTERN.test(filters.recruiter_id)) result.recruiter_id = filters.recruiter_id;
  // `none` without a kind is «sin solicitante»; a real id without its kind is a 422, so it never travels (M6).
  if (filters.requester_kind === "client" || filters.requester_kind === "internal_area") {
    result.requester_kind = filters.requester_kind;
    if (filters.requester_id === NO_REQUESTER || (filters.requester_id && UUID_PATTERN.test(filters.requester_id))) result.requester_id = filters.requester_id;
  } else if (filters.requester_id === NO_REQUESTER) result.requester_id = NO_REQUESTER;
  if (isProcessKind(filters.process_kind)) result.process_kind = filters.process_kind;
  return result;
}
export function parseFilters(params: Pick<URLSearchParams, "get">): MetricsFilters {
  return normalizeFilters(Object.fromEntries(KEYS.map(key => [key, params.get(key) ?? undefined])) as MetricsFilters);
}
export function serializeFilters(filters: MetricsFilters): URLSearchParams {
  const normalized = normalizeFilters(filters);
  const params = new URLSearchParams();
  for (const key of KEYS) if (normalized[key]) params.set(key, normalized[key]!);
  return params;
}

/** The period the API reads: the URL one when valid, else the default, so an invalid draft keeps the last valid view. */
export function effectivePeriod(filters: MetricsFilters, today: string): Period {
  const period = { from: filters.from ?? "", to: filters.to ?? "" };
  return periodIssues(period).length ? defaultPeriod(today) : period;
}
export function apiQuery(filters: MetricsFilters, today: string): URLSearchParams {
  return serializeFilters({ ...normalizeFilters(filters), ...effectivePeriod(filters, today) });
}
