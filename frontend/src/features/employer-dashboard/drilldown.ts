import type { DashboardWindow } from "./model";

/** The page that will list the records behind a dashboard figure (`design/system.md` rule 16, contract §5). */
export const DASHBOARD_DETAIL_PATH = "/empresa/dashboard/detalle";
/**
 * The dashboard lists arrive with backend d2b and their page after it; until then every figure stays plain text (like
 * `company-metrics/drilldown.ts` before T10b). Vacancy titles and recent rows keep linking to the existing boards.
 */
export const DASHBOARD_DETAIL_ENABLED = false;

export type DashboardListKind = "candidates" | "deliveries" | "vacancies" | "applications";
/** Contract §5 lists (backend d2b): `GET /v2/me/company/dashboard/lists/{kind}`, the API route the detail page will read. */
export const dashboardListPath = (kind: DashboardListKind) => `/v2/me/company/dashboard/lists/${kind}`;
/**
 * A figure's records: one d2b list kind with the figure's filters (the same query the API list takes), or the talent
 * base with `added_from` / `added_to` for «Nuevos en la base».
 */
export type DashboardDrill = { kind: DashboardListKind | "talent_base"; params: Record<string, string> };

/** The link of a figure, or null while the lists are off or for a 0 (a 0 is never a link). */
export function dashboardDrillHref(target: DashboardDrill, window: DashboardWindow, options: { enabled?: boolean; count?: number } = {}): string | null {
  if (!(options.enabled ?? DASHBOARD_DETAIL_ENABLED) || options.count === 0) return null;
  if (target.kind === "talent_base") return `/empresa/talento?${new URLSearchParams(target.params)}`;
  const params = new URLSearchParams({ kind: target.kind, window: String(window) });
  for (const [key, value] of Object.entries(target.params)) if (key !== "kind" && key !== "window") params.set(key, value);
  // d2b validates `on`, `from` and `to` against the request window (422 otherwise), so the section's window always wins.
  return `${DASHBOARD_DETAIL_PATH}?${params}`;
}

/** A figure's link builder for the current window; sections receive it so a test can switch the lists on. */
export type Drill = (target: DashboardDrill, count?: number) => string | null;
export const drillFor = (window: DashboardWindow, enabled = DASHBOARD_DETAIL_ENABLED): Drill => (target, count) => dashboardDrillHref(target, window, { enabled, count });
