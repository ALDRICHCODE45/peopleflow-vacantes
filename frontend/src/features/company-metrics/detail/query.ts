import { DETAIL_PATH, type DrilldownKind } from "../drilldown";
import { UUID_PATTERN } from "../model";
import { periodIssues } from "../period";
import { effectivePeriod, normalizeFilters, serializeFilters, type MetricsFilters } from "../url-state";

/**
 * The detail page's query (contract v2 §5): the board filters plus the kind's own filters, in the API's names, so the
 * board's drill-down URL (`drilldown.ts`) is the API query. Validated per kind, like the backend's strict parser: an
 * unknown or malformed parameter is dropped here instead of travelling as a guaranteed 422.
 */
export const LIST_KINDS = ["deliveries", "vacancies", "placements", "reassignments"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
const DETAIL_KINDS: readonly DrilldownKind[] = [...LIST_KINDS, "candidates", "applications"];
export const isListKind = (kind: string): kind is ListKind => (LIST_KINDS as readonly string[]).includes(kind);

export type DetailParams = Record<string, string>;
export type DetailState = { kind: DrilldownKind; params: DetailParams };

type Rule = { multi?: readonly string[]; one?: readonly string[]; uuid?: true; month?: true };
const DELIVERY_RESULTS = ["on_time", "late", "overdue", "pending", "not_configured"] as const;
const CLOSE_REASONS = ["filled", "cancelled", "other", "no_reason"] as const;
const REASSIGNMENT_REASONS = ["workload", "recruiter_departure", "performance", "client_request", "other"] as const;
/** Each kind's filters in the order they are sent; `vacancy_id`, `sort` and `order` follow for every list. */
const KIND_RULES: Record<ListKind, Record<string, Rule>> = {
  deliveries: { result: { multi: DELIVERY_RESULTS }, late_bucket: { one: ["up_to_2", "from_3_to_5", "over_5"] }, commitment_month: { month: true }, attributed_to: { uuid: true } },
  vacancies: {
    scope: { one: ["activity", "assigned", "closed", "closed_assigned"] }, closed_month: { month: true }, close_reason: { multi: CLOSE_REASONS },
    closing_target: { one: ["on_time", "late", "no_target"] }, credited_to: { uuid: true },
  },
  placements: { recipient: { uuid: true }, held: { one: ["true", "false"] } },
  reassignments: { direction: { one: ["received", "lost"] }, reason: { multi: REASSIGNMENT_REASONS } },
};
/** Sort keys per list (§5.1–§5.4), the default first. */
export const SORTS: Record<ListKind, readonly string[]> = {
  deliveries: ["commitment_date", "business_days_late", "business_days_overdue", "target_reached_at", "delivered", "title"],
  vacancies: ["opened_at", "last_close_date", "business_days_to_close", "title"],
  placements: ["hired_at", "title", "candidate"],
  reassignments: ["performed_at", "reason", "title"],
};
const TEXT_SORTS = ["title", "candidate", "reason"];
/** The backend's default order: asc on text columns, desc on the rest. */
export const defaultOrder = (sort: string): "asc" | "desc" => TEXT_SORTS.includes(sort) ? "asc" : "desc";
/** The filter the status switch of each kind rewrites (its facet). */
export const FACET_PARAM: Record<ListKind, string> = { deliveries: "result", vacancies: "close_reason", placements: "held", reassignments: "reason" };

const validMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
function readRule(values: string[], rule: Rule): string | undefined {
  if (rule.multi) {
    const kept = [...new Set(values.flatMap(value => value.split(",")).filter(value => rule.multi!.includes(value)))];
    return kept.length ? kept.join(",") : undefined;
  }
  const value = values[0];
  if (value === undefined) return undefined;
  if (rule.one) return rule.one.includes(value) ? value : undefined;
  if (rule.uuid) return UUID_PATTERN.test(value) ? value : undefined;
  return validMonth(value) ? value : undefined;
}

type Source = { get(key: string): string | null; getAll(key: string): string[] };
function normalize(kind: DrilldownKind, source: Source): DetailParams {
  // Candidates and applications arrive with v2c; until then their page sends nothing.
  if (!isListKind(kind)) return {};
  const board = normalizeFilters({
    from: source.get("from") ?? undefined, to: source.get("to") ?? undefined, recruiter_id: source.get("recruiter_id") ?? undefined,
    requester_kind: (source.get("requester_kind") ?? undefined) as MetricsFilters["requester_kind"], requester_id: source.get("requester_id") ?? undefined,
  });
  // Both ends or neither: a half or invalid period falls back to the default one.
  if (!board.from || !board.to || periodIssues({ from: board.from, to: board.to }).length) { delete board.from; delete board.to; }
  const params: DetailParams = Object.fromEntries(serializeFilters(board));
  for (const [key, rule] of Object.entries(KIND_RULES[kind])) {
    const value = readRule(source.getAll(key), rule);
    if (value !== undefined) params[key] = value;
  }
  // A direction is relative to a recruiter (§5.4).
  if (params.direction && !params.recruiter_id) delete params.direction;
  const vacancy = source.get("vacancy_id");
  if (vacancy && UUID_PATTERN.test(vacancy)) params.vacancy_id = vacancy;
  const sort = source.get("sort");
  if (sort && SORTS[kind].includes(sort)) params.sort = sort;
  const order = source.get("order");
  if (order === "asc" || order === "desc") params.order = order;
  return params;
}

/** Null without a known kind. */
export function parseDetail(search: Source): DetailState | null {
  const kind = search.get("kind");
  if (!kind || !(DETAIL_KINDS as readonly string[]).includes(kind)) return null;
  return { kind: kind as DrilldownKind, params: normalize(kind as DrilldownKind, search) };
}

/** One filter set or removed (`undefined`); the result is validated again, so a patch never adds an invalid value. */
export function withParams(state: DetailState, patch: Record<string, string | undefined>): DetailState {
  const next = new URLSearchParams(state.params);
  for (const [key, value] of Object.entries(patch)) if (value === undefined) next.delete(key); else next.set(key, value);
  return { kind: state.kind, params: normalize(state.kind, next) };
}

export const detailHref = (state: DetailState) => `${DETAIL_PATH}?${new URLSearchParams({ kind: state.kind, ...state.params })}`;
/** The API query: the validated filters with the applied period (the URL one when valid, else the default). */
export function detailApiQuery(state: DetailState, today: string): URLSearchParams {
  const { from, to } = effectivePeriod(state.params, today);
  return new URLSearchParams({ from, to, ...state.params });
}
/** Back to the board with the board filters only (period, recruiter, requester). */
export function boardHref(state: DetailState): string {
  const query = serializeFilters(state.params).toString();
  return `/empresa/metricas${query ? `?${query}` : ""}`;
}
