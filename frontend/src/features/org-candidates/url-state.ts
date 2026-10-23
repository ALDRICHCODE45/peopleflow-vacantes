export const repeatableKeys = ["vacancy", "country", "state", "municipality", "seniority", "years", "language"] as const;
export const singleKeys = ["q", "origin", "active_process", "language_min_level", "education_level", "education_in_progress"] as const;
export type CandidateFilters = Partial<Record<typeof repeatableKeys[number], string[]> & Record<typeof singleKeys[number], string>>;
export type CandidateQuery = { filters?: CandidateFilters; cursor?: string; limit?: number };
export type UrlState = { filters: CandidateFilters; view: "table" | "cards"; cursor?: string };

/** Preserve opaque catalog ids. The server is authoritative for filter validity. */
export function normalizeFilters(filters: CandidateFilters): CandidateFilters {
  const result: CandidateFilters = {};
  for (const key of repeatableKeys) {
    const values = [...new Set(filters[key]?.filter(Boolean) ?? [])];
    if (values.length) result[key] = values;
  }
  for (const key of singleKeys) {
    const value = filters[key]?.trim();
    if (value) result[key] = value;
  }
  if (!result.language?.length) delete result.language_min_level;
  if (!result.education_level) delete result.education_in_progress;
  return result;
}
export function parseUrlState(params: Pick<URLSearchParams, "get" | "getAll">): UrlState {
  const filters: CandidateFilters = {};
  for (const key of repeatableKeys) filters[key] = params.getAll(key);
  for (const key of singleKeys) filters[key] = params.get(key) ?? undefined;
  const cursor = params.get("cursor");
  return { filters: normalizeFilters(filters), view: params.get("view") === "cards" ? "cards" : "table", ...(cursor ? { cursor } : {}) };
}
export function serializeFilters(filters: CandidateFilters): URLSearchParams {
  const params = new URLSearchParams();
  const normalized = normalizeFilters(filters);
  for (const key of singleKeys) if (normalized[key]) params.set(key, normalized[key]!);
  for (const key of repeatableKeys) for (const value of normalized[key] ?? []) params.append(key, value);
  return params;
}
export function serializeUrlState(state: UrlState): URLSearchParams {
  const params = serializeFilters(state.filters);
  if (state.view === "cards") params.set("view", "cards");
  if (state.cursor) params.set("cursor", state.cursor);
  return params;
}
export function changeFilters(state: UrlState, patch: CandidateFilters): UrlState {
  return { view: state.view, filters: normalizeFilters({ ...state.filters, ...patch }) };
}
export function changeView(state: UrlState, view: UrlState["view"]): UrlState { return { ...state, view }; }
export function toListQuery(state: UrlState): CandidateQuery { return { filters: normalizeFilters(state.filters), ...(state.cursor ? { cursor: state.cursor } : {}) }; }
