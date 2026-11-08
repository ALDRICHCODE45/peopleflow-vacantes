import { STAGE_KINDS, UUID_PATTERN } from "@/features/company-metrics/model";
import { DASHBOARD_DETAIL_PATH, type DashboardListKind } from "../drilldown";
import { parseWindow, type DashboardWindow } from "../model";

/**
 * The dashboard detail page's query (contract `company-dashboard-v2` §5): the window plus the kind's own filters, in the
 * API's names, so the board's drill-down URL (`drilldown.ts`) is the API query. Validated per kind like the backend's
 * strict parser (`parseDashboardList`): an unknown or malformed parameter is dropped here instead of travelling as a
 * guaranteed 422. Bounds that depend on the snapshot's window (`on`, `from`, `to`) stay the server's to check.
 */
export const DASHBOARD_LIST_KINDS = ["candidates", "deliveries", "vacancies", "applications"] as const satisfies readonly DashboardListKind[];
export const isDashboardListKind = (kind: unknown): kind is DashboardListKind => (DASHBOARD_LIST_KINDS as readonly unknown[]).includes(kind);

export type DashboardDetailParams = Record<string, string>;
/** The window is kept apart from the filters: the page keeps the one it receives and never offers to change it. */
export type DashboardDetailState = { kind: DashboardListKind; window: DashboardWindow; params: DashboardDetailParams };

type Rule = { multi?: readonly string[]; one?: readonly string[]; date?: true };
export const ORGANIC_CHANNELS = "portal,careers_site,unknown";
const CHANNELS = ["portal", "careers_site", "manual", "unknown"] as const;
/** Each kind's filters in the order they are sent; `vacancy_id`, `sort` and `order` follow for every list. */
const KIND_RULES: Record<DashboardListKind, Record<string, Rule>> = {
  // Only true can be asked for; `on` is a day of the in-process series and needs in_process.
  candidates: { in_process: { one: ["true"] }, on: { date: true }, stage_kind: { multi: STAGE_KINDS }, stalled: { one: ["true"] } },
  deliveries: { state: { one: ["overdue", "due_this_week"] } },
  // Only the published vacancies can be asked for (§3.1).
  vacancies: { status: { one: ["published"] } },
  applications: { from: { date: true }, to: { date: true }, channel: { multi: CHANNELS } },
};
/** Sort keys per list (backend `sorts`), the default first. */
export const SORTS: Record<DashboardListKind, readonly string[]> = {
  candidates: ["business_days_in_stage", "candidate", "title", "entered_stage_at"],
  deliveries: ["commitment_date", "business_days_late", "business_days_overdue", "target_reached_at", "delivered", "title"],
  vacancies: ["published_at", "title", "positions_open", "in_process"],
  applications: ["total", "title"],
};
/** The filter the status switch of each kind rewrites (its facet). */
export const FACET_PARAM: Record<DashboardListKind, string> = { candidates: "stage_kind", deliveries: "state", vacancies: "status", applications: "channel" };

/** A real calendar day, `YYYY-MM-DD`. */
function validDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
}
function readRule(values: string[], rule: Rule): string | undefined {
  if (rule.multi) {
    const kept = [...new Set(values.flatMap(value => value.split(",")).filter(value => rule.multi!.includes(value)))];
    return kept.length ? kept.join(",") : undefined;
  }
  const value = values[0];
  if (value === undefined) return undefined;
  if (rule.one) return rule.one.includes(value) ? value : undefined;
  return validDate(value) ? value : undefined;
}

type Source = { get(key: string): string | null; getAll(key: string): string[] };
function normalize(kind: DashboardListKind, source: Source): DashboardDetailParams {
  const params: DashboardDetailParams = {};
  for (const [key, rule] of Object.entries(KIND_RULES[kind])) {
    const value = readRule(source.getAll(key), rule);
    if (value !== undefined) params[key] = value;
  }
  // The backend answers `on` without in_process with 422 required, and from after to with 422 range.
  if (params.on && !params.in_process) delete params.on;
  if (params.from && params.to && params.from > params.to) { delete params.from; delete params.to; }
  const vacancy = source.get("vacancy_id");
  if (vacancy && UUID_PATTERN.test(vacancy)) params.vacancy_id = vacancy;
  const sort = source.get("sort");
  if (sort && SORTS[kind].includes(sort)) params.sort = sort;
  const order = source.get("order");
  if (order === "asc" || order === "desc") params.order = order;
  return params;
}

/** Null without a known kind. */
export function parseDashboardDetail(search: Source): DashboardDetailState | null {
  const kind = search.get("kind");
  if (!isDashboardListKind(kind)) return null;
  return { kind, window: parseWindow(search.get("window")), params: normalize(kind, search) };
}

/** One filter set or removed (`undefined`); validated again, so a patch never adds an invalid value or a new window. */
export function withParams(state: DashboardDetailState, patch: Record<string, string | undefined>): DashboardDetailState {
  const next = new URLSearchParams(state.params);
  for (const [key, value] of Object.entries(patch)) if (value === undefined) next.delete(key); else next.set(key, value);
  return { kind: state.kind, window: state.window, params: normalize(state.kind, next) };
}

export const detailHref = (state: DashboardDetailState) =>
  `${DASHBOARD_DETAIL_PATH}?${new URLSearchParams({ kind: state.kind, window: String(state.window), ...state.params })}`;
/** The API query: every dashboard list request carries its window (on/from/to are checked against it). */
export const dashboardApiQuery = (state: DashboardDetailState) => new URLSearchParams({ window: String(state.window), ...state.params });
/** Back to the board with the same window. */
export const boardHref = (state: DashboardDetailState) => `/empresa/dashboard?window=${state.window}`;
