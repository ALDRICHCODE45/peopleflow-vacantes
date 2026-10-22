/** URL-owned public search. Codes are exact; catalog membership is server-owned. */
import { EDUCATION_LEVELS, SENIORITIES, yearsOfExperienceSchema } from "../candidate/model";
import { countryCodeSchema, municipalityCodeSchema, stateCodeSchema } from "../geo/model";
import { COMPENSATION_BASES, COMPENSATION_CURRENCIES, COMPENSATION_MONEY_PATTERN, COMPENSATION_PAY_PERIODS } from "./drafts/compensation";
import { CONTRACT_TYPES, PROFESSIONAL_AREAS, WORK_MODES, WORK_SCHEDULES } from "./drafts/scalars";

export const MULTI_KEYS = ["state", "municipality", "work_mode", "language", "seniority"] as const;
type MultiKey = (typeof MULTI_KEYS)[number];
export const SALARY_AMOUNT_KEYS = ["salary_min", "salary_max"] as const;
export const SALARY_UNIT_KEYS = ["salary_currency", "salary_period", "salary_basis"] as const;
const SALARY_KEYS = [...SALARY_AMOUNT_KEYS, ...SALARY_UNIT_KEYS] as const;
const SINGLE_KEYS = ["q", "applicant_country", "work_schedule", "contract_type", "professional_area", ...SALARY_KEYS, "years_of_experience", "education_level", "cursor"] as const;
type SingleKey = (typeof SINGLE_KEYS)[number];
export type JobsQueryKey = MultiKey | SingleKey;
// Scalar inputs remain accepted for existing single-value links and callers.
export type JobsQuery = Partial<Record<SingleKey, string> & Record<MultiKey, string | readonly string[]>>;
export type JobsFilterPatch = Omit<JobsQuery, "cursor">;
const ORDER: readonly JobsQueryKey[] = ["q", ...MULTI_KEYS, "applicant_country", "work_schedule", "contract_type", "professional_area", ...SALARY_KEYS, "years_of_experience", "education_level", "cursor"];
/** SAL-8: units a salary amount falls back to when the link omits them. */
export const DEFAULT_SALARY_UNITS = { salary_currency: "MXN", salary_period: "monthly", salary_basis: "gross" } as const;
// Salary units and amounts use the compensation catalogs and money grammar
// (contract §4.6), the same ones `GET /v2/jobs` validates.
const ENUMS = { seniority: SENIORITIES, education_level: EDUCATION_LEVELS, work_mode: WORK_MODES, work_schedule: WORK_SCHEDULES, contract_type: CONTRACT_TYPES, professional_area: PROFESSIONAL_AREAS, salary_currency: COMPENSATION_CURRENCIES, salary_period: COMPENSATION_PAY_PERIODS, salary_basis: COMPENSATION_BASES };
export function selectedValues(value: string | readonly string[] | undefined): readonly string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : value;
}
function validState(value: string) { return stateCodeSchema.safeParse(value).success && Number(value) >= 1 && Number(value) <= 32; }
function canonicalValue(key: JobsQueryKey, value: string): string | undefined {
  if (key === "q") return value.trim() || undefined;
  if (key === "cursor") return value || undefined;
  // Codes stay opaque; as with geography, catalog membership is server-owned.
  if (key === "language") return /^[a-z]{2,3}$/.test(value) ? value : undefined;
  if (key === "years_of_experience") return yearsOfExperienceSchema.safeParse(value).success ? value : undefined;
  if (key === "state") return validState(value) ? value : undefined;
  if (key === "municipality") return municipalityCodeSchema.safeParse(value).success && validState(value.slice(0, 2)) && Number(value.slice(2)) > 0 ? value : undefined;
  if (key === "applicant_country") return countryCodeSchema.safeParse(value).success ? value : undefined;
  if (key === "salary_min" || key === "salary_max") return COMPENSATION_MONEY_PATTERN.test(value) ? value : undefined;
  return (ENUMS[key] as readonly string[]).includes(value) ? value : undefined;
}
/**
 * The salary keys form one filter, from already-canonical single values:
 * without an amount the units mean nothing and are dropped; an amount gets the
 * default for each missing unit; a minimum above the maximum drops the whole
 * group, mirroring the server's `invalid_filter`.
 */
function canonicalSalary(query: JobsQuery): JobsQuery {
  const out: JobsQuery = { ...query };
  for (const key of SALARY_KEYS) delete out[key];
  const { salary_min: min, salary_max: max } = query;
  if (min === undefined && max === undefined) return out;
  if (min !== undefined && max !== undefined && Number(min) > Number(max)) return out;
  if (min !== undefined) out.salary_min = min;
  if (max !== undefined) out.salary_max = max;
  for (const key of SALARY_UNIT_KEYS) out[key] = query[key] ?? DEFAULT_SALARY_UNITS[key];
  return out;
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
  return canonicalSalary(parsed);
}
export function buildJobsUrl(query: JobsQuery): string {
  const params = new URLSearchParams();
  const salary: JobsQuery = {};
  for (const key of SALARY_KEYS) {
    const values = selectedValues(query[key]);
    const value = values.length === 1 ? canonicalValue(key, values[0]) : undefined;
    if (value !== undefined) salary[key] = value;
  }
  const canonical: JobsQuery = { ...query };
  for (const key of SALARY_KEYS) delete canonical[key];
  Object.assign(canonical, canonicalSalary(salary));
  for (const key of ORDER) {
    const values = selectedValues(canonical[key]);
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
