import type { z } from "zod";

import { requestJson } from "../../../lib/api/requestJson";
import type { RequestJsonResult } from "../../../lib/api/requestJson";
import { isValidJobId } from "../jobId";
import { jobItemSchema } from "../schemas";

type JobItem = z.infer<typeof jobItemSchema>;

const NOT_FOUND_STATUS = 404;

/**
 * Feature query function for the job detail read.
 *
 * Malformed identifiers are rejected locally before any URL, environment, or
 * transport access, so a malformed detail UUID can never reach the backend.
 * The application-facing server-only orchestration boundary is restored by
 * the later TanStack Query `queryOptions` work.
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
