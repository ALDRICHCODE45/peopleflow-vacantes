import { queryOptions } from "@tanstack/react-query";

import { requestJson } from "../../../lib/api/server";
import type { RequestJsonResult } from "../../../lib/api/server";
import { jobsListSchema } from "../schemas";
import type { JobsList } from "../types";
import { buildJobsUrl, parseJobsQuery } from "../url";
import type { JobsQuery, JobsQueryKey } from "../url";

/** Canonical search text (`""` or `"?..."`), reused from the URL helpers. */
function canonicalSearch(query: JobsQuery): string {
 return buildJobsUrl(query).slice("/vacantes".length);
}

/** One canonical, frozen snapshot: trims `q`/`location`, drops invalid
 * enum/currency and empty cursor values, and drops unknown keys. */
function canonicalSnapshot(query: JobsQuery): JobsQuery {
 const raw = new URLSearchParams();
 for (const [key, value] of Object.entries(query)) {
  if (value !== undefined) raw.append(key, value);
 }
 return Object.freeze(parseJobsQuery(raw.toString()));
}

/** Query-key state object rebuilt in canonical order from the canonical URL. */
function canonicalKeyState(query: JobsQuery) {
 const state: Partial<Record<JobsQueryKey, string>> = {};
 for (const [key, value] of new URLSearchParams(canonicalSearch(query))) {
  state[key as JobsQueryKey] = value;
 }
 return state;
}

/**
 * Feature-owned TanStack Query options for the root-level job list read.
 *
 * The snapshot taken at construction is shared by both the JSON-serializable
 * hierarchical key (`jobs` → `list` → state) and the `queryFn`, so later
 * mutation of the caller-owned input can never change the request issued
 * under an old key. No retry semantics are configured here.
 */
export function listJobsQueryOptions(query: JobsQuery) {
 const snapshot = canonicalSnapshot(query);
 return queryOptions({
  queryKey: ["jobs", "list", canonicalKeyState(snapshot)],
  queryFn: () => listJobs(snapshot),
 });
}

/**
 * Server-only query function for the root-level `GET /jobs` read: direct
 * calls are canonicalized at runtime before forwarding, the cursor stays an
 * opaque value, payloads decode through `jobsListSchema`, and no list status
 * ever maps to not-found (no detail-only `notFoundStatus`).
 */
export async function listJobs(query: JobsQuery): Promise<RequestJsonResult<JobsList>> {
 // Loaded lazily so canonicalization and key building never trigger the
 // eager environment validation or the server-only import resolution.
 const { serverEnv } = await import("../../../lib/env/server");

 const url = new URL("/jobs", serverEnv.apiBaseUrl);
 url.search = canonicalSearch(query);

 return requestJson(url.toString(), {
  decoder: (payload: unknown) => jobsListSchema.parse(payload),
  timeoutMs: serverEnv.apiTimeoutMs,
 });
}
