/** Shared loaded/loading geometry. Native Card spacing remains the source of gutters. */
export const PUBLIC_VACANCY_CARD = "grid min-w-0 [overflow-wrap:anywhere] md:grid-cols-[minmax(0,1fr)_14rem] md:grid-rows-[auto_1fr]";
export const PUBLIC_VACANCY_HEADER = "min-w-0 md:col-start-1";
export const PUBLIC_VACANCY_TITLE = "flex min-w-0 items-start gap-3";
export const PUBLIC_VACANCY_DESCRIPTION = "flex min-w-0 flex-col gap-2 pl-15";
export const PUBLIC_VACANCY_META = "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground";
export const PUBLIC_VACANCY_CONTENT = "flex min-w-0 flex-col gap-4 md:col-start-1";
export const PUBLIC_VACANCY_CHIPS = "flex min-w-0 flex-wrap gap-2";
export const PUBLIC_VACANCY_RAIL = "min-w-0 flex-col items-stretch justify-center gap-4 border-t md:col-start-2 md:row-span-2 md:row-start-1 md:-my-(--card-spacing) md:border-t-0 md:border-l md:py-(--card-spacing)";

/** Optional presentation data, never inferred from source, title or hidden detail fields. */
export type PublicVacancyCardExtras = {
  excerpt?: string;
  benefits?: readonly string[];
  skills?: readonly string[];
  /** Only pass true when a future public contract explicitly guarantees quick apply. */
  quickApply?: boolean;
};
