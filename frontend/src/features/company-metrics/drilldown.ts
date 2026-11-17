import type { Period } from "./period";
import { parseFilters, serializeFilters, type MetricsFilters } from "./url-state";

/** The detail page every figure opens (`design/system.md` rule 16, artboard 08). */
export const DETAIL_PATH = "/empresa/metricas/detalle";
/** The board a detail page returns to. */
export const BOARD_PATH = "/empresa/metricas";
/** The board with its filters (period, recruiter, requester), as the detail page's «back». */
export function boardPath(filters: MetricsFilters): string {
  const query = serializeFilters(filters).toString();
  return query ? `${BOARD_PATH}?${query}` : BOARD_PATH;
}
/**
 * A `back` value read from a URL: only a same-origin path to the board, rebuilt from its normalized filters, so it can
 * never point to another origin, another page or carry anything but the board's own query. Null otherwise.
 */
export function safeBoardPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(`${BOARD_PATH}`) || value.includes("\\")) return null;
  const base = "https://board.invalid";
  let url: URL;
  try { url = new URL(value, base); } catch { return null; }
  if (url.origin !== base || url.pathname !== BOARD_PATH) return null;
  return boardPath(parseFilters(url.searchParams));
}
/** The detail page shipped with T10b; a figure stays plain text only when it is 0. */
export const DETAIL_PAGE_ENABLED = true;

export type DrilldownKind = "deliveries" | "vacancies" | "placements" | "reassignments" | "candidates" | "applications";
/**
 * The list (contract v2 §5) and the exact query that reproduces a figure (the «Opens» tables of §4). `period` replaces
 * the board period, for previous values (N1).
 */
export type Drilldown = { kind: DrilldownKind; params: Record<string, string>; period?: Period };

/**
 * The detail URL for a figure: the board period and filters, then the figure's own query, which wins on a shared name,
 * and `back`, the board as it is, so «Volver» returns there even when the figure overrides the recruiter or the period.
 * Null when the page is off or the figure is 0 (a 0 is never a link).
 */
export function drilldownHref(target: Drilldown, filters: MetricsFilters, options: { enabled?: boolean; count?: number } = {}): string | null {
  if (!(options.enabled ?? DETAIL_PAGE_ENABLED) || options.count === 0) return null;
  const params = new URLSearchParams({ kind: target.kind });
  for (const [key, value] of serializeFilters({ ...filters, ...target.period })) params.set(key, value);
  for (const [key, value] of Object.entries(target.params)) params.set(key, value);
  params.set("back", boardPath(filters));
  return `${DETAIL_PATH}?${params}`;
}
