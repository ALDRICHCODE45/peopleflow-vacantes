/** URL-owned public search. Codes are exact; catalog membership is server-owned. */
import { countryCodeSchema, municipalityCodeSchema, stateCodeSchema } from "../geo/model";
import { CONTRACT_TYPES, PROFESSIONAL_AREAS, WORK_MODES, WORK_SCHEDULES } from "./drafts/scalars";

export const MULTI_KEYS = ["state", "municipality", "work_mode"] as const;
type MultiKey = (typeof MULTI_KEYS)[number];
const SINGLE_KEYS = ["q", "applicant_country", "work_schedule", "contract_type", "professional_area", "cursor"] as const;
type SingleKey = (typeof SINGLE_KEYS)[number];
export type JobsQueryKey = MultiKey | SingleKey;
// Scalar inputs remain accepted for existing single-value links and callers.
export type JobsQuery = Partial<Record<SingleKey, string> & Record<MultiKey, string | readonly string[]>>;
export type JobsFilterPatch = Omit<JobsQuery, "cursor">;
const ORDER: readonly JobsQueryKey[] = ["q", ...MULTI_KEYS, "applicant_country", "work_schedule", "contract_type", "professional_area", "cursor"];
const ENUMS = { work_mode: WORK_MODES, work_schedule: WORK_SCHEDULES, contract_type: CONTRACT_TYPES, professional_area: PROFESSIONAL_AREAS };
export function selectedValues(value: string | readonly string[] | undefined): readonly string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : value;
}
function validState(value: string) { return stateCodeSchema.safeParse(value).success && Number(value) >= 1 && Number(value) <= 32; }
function canonicalValue(key: JobsQueryKey, value: string): string | undefined {
  if (key === "q") return value.trim() || undefined;
  if (key === "cursor") return value || undefined;
  if (key === "state") return validState(value) ? value : undefined;
  if (key === "municipality") return municipalityCodeSchema.safeParse(value).success && validState(value.slice(0, 2)) && Number(value.slice(2)) > 0 ? value : undefined;
  if (key === "applicant_country") return countryCodeSchema.safeParse(value).success ? value : undefined;
  return (ENUMS[key] as readonly string[]).includes(value) ? value : undefined;
}
export function parseJobsQuery(query: string): JobsQuery {
  const params = new URLSearchParams(query);
  const parsed: JobsQuery = {};
  for (const key of MULTI_KEYS) {
    const values = [...new Set(params.getAll(key).filter(value => canonicalValue(key, value) !== undefined))];
    if (values.length) parsed[key] = values;
  }
  for (const key of SINGLE_KEYS) {
    const values = params.getAll(key);
    if (values.length !== 1) continue;
    const value = canonicalValue(key, values[0]);
    if (value !== undefined) parsed[key] = value;
  }
  return parsed;
}
export function buildJobsUrl(query: JobsQuery): string {
  const params = new URLSearchParams();
  for (const key of ORDER) {
    const values = selectedValues(query[key]);
    if ((SINGLE_KEYS as readonly string[]).includes(key) && values.length !== 1) continue;
    for (const value of new Set(values)) {
      const canonical = canonicalValue(key, value);
      if (canonical !== undefined) params.append(key, canonical);
    }
  }
  return params.size ? `/vacantes?${params}` : "/vacantes";
}
export function isCanonicalJobsQuery(query: string): boolean {
  const raw = new URLSearchParams(query);
  const canonical = new URLSearchParams(buildJobsUrl(parseJobsQuery(query)).split("?")[1]);
  return raw.size === canonical.size && [...raw.keys()].every(key => JSON.stringify(raw.getAll(key)) === JSON.stringify(canonical.getAll(key)));
}
export function buildFilterCommitUrl(currentUrl: string, patch: JobsFilterPatch): string {
  const parsed = parseJobsQuery(currentUrl.split("?")[1] ?? "");
  return buildJobsUrl({ ...parsed, ...patch, cursor: undefined });
}
export function buildNextJobsUrl(currentUrl: string, cursor: string): string {
  return buildJobsUrl({ ...parseJobsQuery(currentUrl.split("?")[1] ?? ""), cursor });
}
