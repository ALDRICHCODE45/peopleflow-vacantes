import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import type { RequestJsonResult } from "@/lib/api/server";
import { publicJobsListSchema } from "../schemas";
import { listSampleJobs } from "../sample-jobs";
import type { PublicJobsList } from "../types";
import { buildJobsUrl, type JobsQuery } from "../url";

/** Internal catalog controls deliberately do not extend the public URL grammar. */
export type RelatedJobsQuery = Pick<JobsQuery, "professional_area" | "state" | "seniority" | "work_mode" | "cursor"> & {
  company_id?: string;
  limit: number;
};
const controls = z.object({
  company_id: z.string().uuid().regex(/^[0-9a-f-]+$/).optional(),
  limit: z.number().int().min(1).max(50),
});

/** Preserve backend relevance/publication order; never sort a live catalog response. */
export async function listRelatedJobs(query: RelatedJobsQuery): Promise<RequestJsonResult<PublicJobsList>> {
  const parsed = controls.safeParse(query);
  if (!parsed.success) return { ok: false, error: { kind: "invalid_response", retryable: false } };
  try {
    const { serverEnv } = await import("@/lib/env/server");
    if (serverEnv.sampleJobs) {
      // Reuse the canonical sample filter/decoder. Its fixed ten rows fit one page;
      // no metadata, companies or public counts are fabricated for this region.
      const page = listSampleJobs(query);
      const items = page.items.filter(job => !query.company_id || job.company.id === query.company_id)
        .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
        .slice(0, query.limit);
      return { ok: true, data: { items, next_cursor: null } };
    }
    const url = new URL("/v2/jobs", serverEnv.apiBaseUrl);
    url.search = buildJobsUrl(query).slice("/vacantes".length);
    if (query.company_id !== undefined) url.searchParams.set("company_id", query.company_id);
    url.searchParams.set("limit", String(query.limit));
    return await requestJson(url.toString(), {
      decoder: value => publicJobsListSchema.parse(value),
      timeoutMs: serverEnv.apiTimeoutMs,
    });
  } catch {
    return { ok: false, error: { kind: "network", retryable: true } };
  }
}
