import { queryOptions } from "@tanstack/react-query";

import { requestJson } from "../../../lib/api/server";
import type { RequestJsonResult } from "../../../lib/api/server";
import { isValidJobId } from "../jobId";
import { jobItemSchema } from "../schemas";
import type { JobItem } from "../types";

const NOT_FOUND_STATUS = 404;

/**
 * Feature-owned TanStack Query options for the job detail read.
 *
 * The array query key is JSON-serializable and contains the exact `jobId`, so
 * a fresh request-scoped server `QueryClient` dedupes identical detail reads
 * within one render. The `queryFn` is the only application-facing caller of
 * the server-only transport; no retry semantics are configured here.
 */
export function getJobQueryOptions(jobId: string) {
 return queryOptions({
  queryKey: ["jobs", "detail", jobId],
  queryFn: () => getJob(jobId),
 });
}

/**
 * Server-only query function for the job detail read.
 *
 * Malformed identifiers are rejected locally before any URL, environment, or
 * transport access, so a malformed detail UUID can never reach the backend.
 */
export async function getJob(
 jobId: string,
): Promise<RequestJsonResult<JobItem>> {
 if (!isValidJobId(jobId)) {
  return {
   ok: false,
   error: { kind: "not_found", retryable: false, status: NOT_FOUND_STATUS },
  };
 }

 // Loaded lazily so the malformed short-circuit above never triggers the
 // eager environment validation or the server-only import resolution.
 const { serverEnv } = await import("../../../lib/env/server");

 const url = new URL(`/jobs/${jobId}`, serverEnv.apiBaseUrl);

 return requestJson(url.toString(), {
  decoder: (value: unknown) => jobItemSchema.parse(value),
  notFoundStatus: NOT_FOUND_STATUS,
  timeoutMs: serverEnv.apiTimeoutMs,
 });
}
