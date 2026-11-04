import { isIsoDay, TOKEN_PATTERN, UUID_PATTERN } from "./model";

/** Filters of `GET /v2/me/company/audit-events` (contract §8.1). The cursor is page state, not URL state. */
export type AuditFilters = { actor_id?: string; event_type?: string[]; category?: string; vacancy_id?: string; from?: string; to?: string };
export type AuditUrlState = { filters: AuditFilters };
export type AuditQuery = { filters?: AuditFilters; limit?: number; cursor?: string };
/** Body of `POST …/export` (contract §8.5). */
export type AuditExportBody = { actor_id?: string; event_types?: string[]; category?: string; vacancy_id?: string; from?: string; to?: string };

/** Keeps only well-formed values: a hand-edited URL never reaches the API as a guaranteed 422. */
export function normalizeFilters(filters: AuditFilters): AuditFilters {
  const result: AuditFilters = {};
  const types = [...new Set((filters.event_type ?? []).filter(value => TOKEN_PATTERN.test(value)))];
  if (types.length) result.event_type = types;
  const category = filters.category?.trim();
  if (category && TOKEN_PATTERN.test(category)) result.category = category;
  for (const key of ["actor_id", "vacancy_id"] as const) {
    const value = filters[key]?.trim();
    if (value && UUID_PATTERN.test(value)) result[key] = value;
  }
  for (const key of ["from", "to"] as const) {
    const value = filters[key]?.trim();
    if (value && isIsoDay(value)) result[key] = value;
  }
  return result;
}
export function parseUrlState(params: Pick<URLSearchParams, "get" | "getAll">): AuditUrlState {
  return { filters: normalizeFilters({
    event_type: params.getAll("event_type"),
    ...Object.fromEntries((["actor_id", "category", "vacancy_id", "from", "to"] as const).map(key => [key, params.get(key) ?? undefined])),
  }) };
}
export function serializeFilters(filters: AuditFilters): URLSearchParams {
  const params = new URLSearchParams();
  const normalized = normalizeFilters(filters);
  for (const value of normalized.event_type ?? []) params.append("event_type", value);
  for (const key of ["actor_id", "category", "vacancy_id", "from", "to"] as const) if (normalized[key]) params.set(key, normalized[key]!);
  return params;
}
export const serializeUrlState = (state: AuditUrlState): URLSearchParams => serializeFilters(state.filters);
export const changeFilters = (state: AuditUrlState, patch: AuditFilters): AuditUrlState => ({ filters: normalizeFilters({ ...state.filters, ...patch }) });
export function toExportBody(filters: AuditFilters): AuditExportBody {
  const { event_type, ...rest } = normalizeFilters(filters);
  return { ...rest, ...(event_type ? { event_types: event_type } : {}) };
}
