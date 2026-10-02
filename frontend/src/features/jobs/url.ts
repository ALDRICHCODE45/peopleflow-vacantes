/**
 * Canonical `/vacantes` query state.
 *
 * The URL is the only durable list state. Supported keys are exactly
 * `q`, `seniority`, `work_mode`, `employment_type`, `location`, `currency`,
 * and the opaque forward `cursor`. Every key is scalar; unknown, empty,
 * invalid, and repeated values are omitted rather than given hidden
 * multi-value semantics. Cursors are transported untouched: never decoded,
 * normalized, logged, or interpreted.
 */

const FILTER_KEYS = [
  "q",
  "seniority",
  "work_mode",
  "employment_type",
  "location",
  "currency",
] as const;

const CURSOR_KEY = "cursor";

const ALL_KEYS = [...FILTER_KEYS, CURSOR_KEY] as const;

type FilterKey = (typeof FILTER_KEYS)[number];

export type JobsQueryKey = (typeof ALL_KEYS)[number];

/** Scalar canonical query model; absent keys are simply not present. */
export type JobsQuery = Partial<Record<JobsQueryKey, string>>;

/** Exact backend wire values; no case or spelling tolerance. */
const ENUM_VALUES = {
  seniority: ["intern", "junior", "mid", "senior", "lead"],
  work_mode: ["onsite", "remote", "hybrid"],
  employment_type: ["full_time", "part_time", "contract", "internship"],
  currency: ["MXN", "USD"],
} as const satisfies Record<
  Exclude<FilterKey, "q" | "location">,
  readonly string[]
>;

/** Canonical serialization order: the six filters first, then the cursor. */
const SERIALIZATION_ORDER: readonly JobsQueryKey[] = ALL_KEYS;

function queryOf(url: string): string {
  const questionMark = url.indexOf("?");
  return questionMark === -1 ? "" : url.slice(questionMark + 1);
}

/** Validates one raw value or returns `undefined` when the key must be omitted. */
function canonicalValue(key: JobsQueryKey, value: string): string | undefined {
  if (key === "q" || key === "location") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (key === CURSOR_KEY) {
    return value === "" ? undefined : value;
  }
  return (ENUM_VALUES[key] as readonly string[]).includes(value)
    ? value
    : undefined;
}

/** Counts occurrences of supported keys so repeated values can be dropped. */
function supportedKeyCounts(query: string): Map<JobsQueryKey, number> {
  const counts = new Map<JobsQueryKey, number>(ALL_KEYS.map((key) => [key, 0]));
  for (const key of new URLSearchParams(query).keys()) {
    const count = counts.get(key as JobsQueryKey);
    if (count !== undefined) counts.set(key as JobsQueryKey, count + 1);
  }
  return counts;
}

/** Parses raw `/vacantes` query text into the canonical scalar model. */
export function parseJobsQuery(query: string): JobsQuery {
  const parsed: JobsQuery = {};
  const counts = supportedKeyCounts(query);
  const params = new URLSearchParams(query);
  for (const key of SERIALIZATION_ORDER) {
    if (counts.get(key) !== 1) continue;
    const value = canonicalValue(key, params.get(key)!);
    if (value !== undefined) parsed[key] = value;
  }
  return parsed;
}

/** Serializes the canonical model into a shareable `/vacantes` URL. */
export function buildJobsUrl(query: JobsQuery): string {
  const params = new URLSearchParams();
  for (const key of SERIALIZATION_ORDER) {
    const value = query[key];
    if (value === undefined) continue;
    const canonical = canonicalValue(key, value);
    if (canonical !== undefined) params.append(key, canonical);
  }
  const serialized = params.toString();
  return serialized === "" ? "/vacantes" : `/vacantes?${serialized}`;
}

/** Whether the raw query already equals its canonical supported state. */
export function isCanonicalJobsQuery(query: string): boolean {
  const seen = new Set<JobsQueryKey>();
  for (const [key, value] of new URLSearchParams(query)) {
    if (!ALL_KEYS.includes(key as JobsQueryKey)) return false;
    if (seen.has(key as JobsQueryKey)) return false;
    seen.add(key as JobsQueryKey);
    if (canonicalValue(key as JobsQueryKey, value) !== value) return false;
  }
  return true;
}

/**
 * Serializes a search/filter commit: the six filter values with any patch
 * applied, and the cursor always omitted — every filter add, change, or
 * clear starts a fresh, unpaginated result set.
 */
export function buildFilterCommitUrl(
  currentUrl: string,
  patch: Partial<Record<FilterKey, string>>,
): string {
  const parsed = parseJobsQuery(queryOf(currentUrl));
  const filters: JobsQuery = {};
  for (const key of FILTER_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      const value = canonicalValue(key, patch[key]!);
      if (value !== undefined) filters[key] = value;
    } else if (parsed[key] !== undefined) {
      filters[key] = parsed[key]!;
    }
  }
  return buildJobsUrl(filters);
}

/**
 * Builds the next-results destination: the current canonical filters with
 * the backend `next_cursor` appended unchanged as an opaque cursor value.
 */
export function buildNextJobsUrl(currentUrl: string, cursor: string): string {
  const parsed = parseJobsQuery(queryOf(currentUrl));
  const nextCursor = canonicalValue(CURSOR_KEY, cursor);
  return buildJobsUrl({ ...parsed, cursor: nextCursor });
}
