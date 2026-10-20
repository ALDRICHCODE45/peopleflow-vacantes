import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
const listErrorSchema = z.object({ code: z.enum(["invalid_filter", "invalid_request"]), error: z.string() }).strict().transform(({ code }) => ({ code }));
export type ListJobsError = z.output<typeof listErrorSchema>;

import { requestJson } from "../../../lib/api/server";
import type { RequestJsonResult } from "../../../lib/api/server";
import { publicJobsListSchema } from "../schemas";
import { listSampleJobs } from "../sample-jobs";
import type { PublicJobsList } from "../types";
import { buildJobsUrl, parseJobsQuery } from "../url";
import type { JobsQuery } from "../url";

/** Canonical search text (`""` or `"?..."`), reused from the URL helpers. */
function canonicalSearch(query: JobsQuery): string {
 return buildJobsUrl(query).slice("/vacantes".length);
}

/** One canonical, frozen snapshot: trims text, deduplicates repeated dimensions,
 * and drops malformed values, empty selections and unknown keys. */
function canonicalSnapshot(query: JobsQuery): JobsQuery {
 const snapshot = parseJobsQuery(canonicalSearch(query));
 for (const value of Object.values(snapshot)) if (Array.isArray(value)) Object.freeze(value);
 return Object.freeze(snapshot);
}

/** Feature-owned TanStack Query options for the public v2 list read. */
export function listJobsQueryOptions(query: JobsQuery) {
 // One canonical, frozen snapshot shared verbatim by the key state and the
 // `queryFn`: later mutation of the caller-owned input can never change the
 // request issued under an old key, and no re-canonicalization pass is needed
 // because `canonicalSnapshot` already emits canonical values in canonical
 // serialization order. Retries require an explicit user action.
 const snapshot = canonicalSnapshot(query);
 return queryOptions({
  queryKey: ["jobs", "list", snapshot],
  retry: false,
  queryFn: () => listJobs(snapshot),
 });
}

/**
 * Server-only query function for `GET /v2/jobs`: direct
 * calls are canonicalized at runtime before forwarding, the cursor stays an
 * opaque value, payloads decode through `publicJobsListSchema`, and no list status
 * ever maps to not-found (no detail-only `notFoundStatus`).
 */
export async function listJobs(
 query: JobsQuery,
): Promise<RequestJsonResult<PublicJobsList, ListJobsError>> {
 // Loaded lazily so canonicalization and key building never trigger the
 // eager environment validation or the server-only import resolution.
 const { serverEnv } = await import("../../../lib/env/server");

 // Sample mode answers before any URL or transport work: when enabled, the
 // read never reaches the network, and when disabled the API path is byte-for-
 // byte the one below.
 if (serverEnv.sampleJobs) {
  return { ok: true, data: listSampleJobs(query) };
 }

 const url = new URL("/v2/jobs", serverEnv.apiBaseUrl);
 url.search = canonicalSearch(query);

 return requestJson(url.toString(), {
  decoder: (payload: unknown) => publicJobsListSchema.parse(payload),
  errorDecoder: (payload: unknown) => listErrorSchema.parse(payload),
  timeoutMs: serverEnv.apiTimeoutMs,
 });
}
