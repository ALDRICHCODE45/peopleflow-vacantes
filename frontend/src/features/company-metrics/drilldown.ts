import type { Period } from "./period";
import { serializeFilters, type MetricsFilters } from "./url-state";

/** The detail page every figure opens (`design/system.md` rule 16, artboard 08). */
export const DETAIL_PATH = "/empresa/metricas/detalle";
/** Off until the detail page ships (T10b): a link to a missing page is worse than a plain number. */
export const DETAIL_PAGE_ENABLED = false;

export type DrilldownKind = "deliveries" | "vacancies" | "placements" | "reassignments" | "candidates" | "applications";
/**
 * The list (contract v2 §5) and the exact query that reproduces a figure (the «Opens» tables of §4). `period` replaces
 * the board period, for previous values (N1).
 */
export type Drilldown = { kind: DrilldownKind; params: Record<string, string>; period?: Period };

/**
 * The detail URL for a figure: the board period and filters, then the figure's own query, which wins on a shared name.
 * Null when the page is off or the figure is 0 (a 0 is never a link).
 */
export function drilldownHref(target: Drilldown, filters: MetricsFilters, options: { enabled?: boolean; count?: number } = {}): string | null {
  if (!(options.enabled ?? DETAIL_PAGE_ENABLED) || options.count === 0) return null;
  const params = new URLSearchParams({ kind: target.kind });
  for (const [key, value] of serializeFilters({ ...filters, ...target.period })) params.set(key, value);
  for (const [key, value] of Object.entries(target.params)) params.set(key, value);
  return `${DETAIL_PATH}?${params}`;
}
