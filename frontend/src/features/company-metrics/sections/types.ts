import type { Period } from "../period";
import type { SectionState } from "../use-section";
import type { MetricsFilters } from "../url-state";

/**
 * What every board section receives from the workspace: its own loading state (`use-section.ts`), the active filters
 * and the applied period, so figures can build their drill-down links (`drilldown.ts`).
 */
export type SectionProps<T> = { state: SectionState<T>; filters: MetricsFilters; period: Period };
