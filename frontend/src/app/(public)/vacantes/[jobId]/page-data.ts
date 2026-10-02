import { QueryClient } from "@tanstack/react-query";

import {
   getJob,
   getJobQueryOptions,
} from "../../../../features/jobs/api/getJob";
import type { JobItem } from "../../../../features/jobs/types";

/** Validated detail failure shape, derived without importing the transport façade. */
type GetJobResult = Awaited<ReturnType<typeof getJob>>;
type GetJobError = Extract<GetJobResult, { ok: false }>["error"];

/**
 * Request-scoped detail outcome union consumed by the route: `found` renders
 * the article, `notFound` is the branded 404, and every retryable service or
 * schema failure stays in `unavailable` so the page can hand it to the route
 * error boundary instead of ever presenting it as not found.
 */
export type VacanteDetailResult =
   | { kind: "found"; job: JobItem }
   | { kind: "notFound" }
   | { kind: "unavailable"; error: GetJobError };

/**
 * One fresh request-scoped detail scope: a new server `QueryClient` plus the
 * `read`/`metadata` accessors that share it. Identical concurrent reads dedupe
 * through `fetchQuery`, so a render's metadata generation and page read issue
 * exactly one `no-store` API read; a new scope means a new request with a new
 * client, so no data ever crosses requests.
 */
export function createVacanteDetailScope() {
   const queryClient = new QueryClient();

   const read = async (jobId: string): Promise<VacanteDetailResult> => {
      const result = await queryClient.fetchQuery(getJobQueryOptions(jobId));
      if (result.ok) {
         return { kind: "found", job: result.data };
      }
      // Malformed identifiers are short-circuited inside `getJob` before any
      // transport access, so a `not_found` outcome covers both the local
      // rejection and a backend 404.
      if (result.error.kind === "not_found") {
         return { kind: "notFound" };
      }
      return { kind: "unavailable", error: result.error };
   };

   return {
      read,
      metadata: (jobId: string) => read(jobId),
   };
}
