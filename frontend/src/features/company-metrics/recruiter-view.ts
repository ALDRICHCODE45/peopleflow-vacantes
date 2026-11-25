import type { Period } from "./period";
import { DEFAULT_SORT, SORT_KEYS, type RecruiterSort, type SortKey } from "./sorting";
import { parseFilters, serializeFilters, type MetricsFilters } from "./url-state";

/**
 * «Desempeño por reclutador» as its own page (`design/recruiter-table-redesign/01`, S2): period and filters travel in the
 * URL like the board's (`url-state.ts`), plus the table's own view, `sort` and `hide`, so a link, a reload and «volver» (S4)
 * restore the same table. Everything read from the URL is validated against known values, never echoed.
 */
export const TABLE_PATH = "/empresa/metricas/reclutadores";

/** The eight columns after «Reclutador», in table order; the groups are the sections of the recruiter page. */
export const COLUMN_IDS = ["assigned", "reassignments", "business_days", "on_time", "median", "delivered", "placements", "conversion"] as const satisfies readonly Exclude<SortKey, "name">[];
export type ColumnId = (typeof COLUMN_IDS)[number];
export const COLUMN_GROUPS = [
  { id: "load", label: "Carga de trabajo", columns: ["assigned", "reassignments", "business_days"] },
  { id: "delivery", label: "Entrega de candidatos", columns: ["on_time", "median", "delivered"] },
  { id: "hiring", label: "Contratación", columns: ["placements", "conversion"] },
] as const satisfies readonly { id: string; label: string; columns: readonly ColumnId[] }[];

export type TableView = { sort: RecruiterSort; hidden: ColumnId[] };
export const DEFAULT_VIEW: TableView = { sort: DEFAULT_SORT, hidden: [] };
export const isDefaultView = ({ sort, hidden }: TableView) => sort.key === DEFAULT_SORT.key && sort.direction === DEFAULT_SORT.direction && hidden.length === 0;

const isColumn = (value: string): value is ColumnId => (COLUMN_IDS as readonly string[]).includes(value);
const isSortKey = (value: string): value is SortKey => (SORT_KEYS as readonly string[]).includes(value);

export function parseTableView(params: Pick<URLSearchParams, "get">): TableView {
  const [key = "", direction = ""] = (params.get("sort") ?? "").split(":");
  const sort: RecruiterSort = isSortKey(key) && (direction === "ascending" || direction === "descending") ? { key, direction } : DEFAULT_SORT;
  const asked = new Set((params.get("hide") ?? "").split(",").filter(isColumn));
  return { sort, hidden: COLUMN_IDS.filter(id => asked.has(id)) };
}
/** Only what differs from the default view, columns in table order. */
export function serializeTableView({ sort, hidden }: TableView): URLSearchParams {
  const params = new URLSearchParams();
  if (sort.key !== DEFAULT_SORT.key || sort.direction !== DEFAULT_SORT.direction) params.set("sort", `${sort.key}:${sort.direction}`);
  const columns = COLUMN_IDS.filter(id => hidden.includes(id));
  if (columns.length) params.set("hide", columns.join(","));
  return params;
}

const query = (filters: MetricsFilters, view: TableView, extra: Record<string, string> = {}) => {
  const params = serializeFilters(filters);
  for (const [key, value] of [...serializeTableView(view), ...Object.entries(extra)]) params.set(key, value);
  return params.toString();
};
/** The table page with its period, filters, order and columns. */
export function tablePath(filters: MetricsFilters, view: TableView = DEFAULT_VIEW): string {
  const text = query(filters, view);
  return text ? `${TABLE_PATH}?${text}` : TABLE_PATH;
}

/**
 * S4: how a recruiter page knows it was opened from the table. `from` is already the period start of every metrics URL, so
 * the origin is `origin=table`; any other value (or none) means Métricas.
 */
export const ORIGIN_PARAM = "origin";
export const ORIGIN_TABLE = "table";
/** Params a recruiter page keeps through its own period changes so «volver» still finds the table. */
export const TABLE_PARAMS = ["sort", "hide", ORIGIN_PARAM] as const;
export const detailOrigin = (params: Pick<URLSearchParams, "get">): typeof ORIGIN_TABLE | null => params.get(ORIGIN_PARAM) === ORIGIN_TABLE ? ORIGIN_TABLE : null;

/** A row's recruiter page, remembering the table: its whole filter set and view travel with `origin=table`. */
export function recruiterFromTable(userId: string, filters: MetricsFilters, view: TableView): string {
  return `${TABLE_PATH}/${userId}?${query(filters, view, { [ORIGIN_PARAM]: ORIGIN_TABLE })}`;
}
/** The table a recruiter page returns to: the period it shows, the filters and the view it left, rebuilt from validated values. */
export function tableReturn(params: Pick<URLSearchParams, "get">, period: Period): string {
  return tablePath({ ...parseFilters(params), ...period }, parseTableView(params));
}
