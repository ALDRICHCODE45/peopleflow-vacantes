import { queryOptions } from "@tanstack/react-query";

import { requestJson } from "../../../lib/api/server";
import type { RequestJsonResult } from "../../../lib/api/server";
import { jobsListSchema } from "../schemas";
import type { JobsList } from "../types";
import { buildJobsUrl, parseJobsQuery } from "../url";
import type { JobsQuery } from "../url";

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

/** Feature-owned TanStack Query options for the root-level job list read. */
export function listJobsQueryOptions(query: JobsQuery) {
 // One canonical, frozen snapshot shared verbatim by the key state and the
 // `queryFn`: later mutation of the caller-owned input can never change the
 // request issued under an old key, and no re-canonicalization pass is needed
 // because `canonicalSnapshot` already emits canonical values in canonical
 // serialization order. No retry semantics are configured here.
 const snapshot = canonicalSnapshot(query);
 return queryOptions({
  queryKey: ["jobs", "list", snapshot],
  queryFn: () => listJobs(snapshot),
 });
}

/**
 * Server-only query function for the root-level `GET /jobs` read: direct
 * calls are canonicalized at runtime before forwarding, the cursor stays an
 * opaque value, payloads decode through `jobsListSchema`, and no list status
 * ever maps to not-found (no detail-only `notFoundStatus`).
 */
export async function listJobs(
 query: JobsQuery,
): Promise<RequestJsonResult<JobsList>> {
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
