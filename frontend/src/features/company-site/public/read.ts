import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { publicJobsListSchema } from "@/features/jobs/schemas";
import { validateSlug } from "../slug";
import { publicSiteSchema, type PublicSite } from "./schema";

export type PublicSiteResult = { kind: "found"; data: PublicSite } | { kind: "moved"; slug: string } | { kind: "notFound" | "unavailable" };
export async function getPublicSite(slug: string): Promise<PublicSiteResult> {
  if (validateSlug(slug) !== null) return { kind: "notFound" };
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`/v2/company-sites/${slug}`, serverEnv.apiBaseUrl).toString(), {
    expectedStatus: 200, redirect: "error", timeoutMs: serverEnv.apiTimeoutMs,
    decoder: value => publicSiteSchema.parse(value),
    errorDecoder: value => z.object({ code: z.literal("site_not_found") }).parse(value),
    maxErrorBodyBytes: 8192,
  });
  if (!result.ok) return { kind: result.error.kind === "status" && result.error.status === 404 && result.envelope?.code === "site_not_found" ? "notFound" : "unavailable" };
  return result.data.slug === slug ? { kind: "found", data: result.data } : { kind: "moved", slug: result.data.slug };
}
export async function listCompanyJobs(companyId: string) {
  const { serverEnv } = await import("@/lib/env/server");
  const url = new URL("/v2/jobs", serverEnv.apiBaseUrl);
  url.searchParams.set("company_id", companyId);
  const items: z.output<typeof publicJobsListSchema>["items"] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 10; page += 1) {
    const result = await requestJson(url.toString(), {
      expectedStatus: 200, redirect: "error", timeoutMs: serverEnv.apiTimeoutMs,
      decoder: value => publicJobsListSchema.parse(value),
    });
    // Never expose a partial list: filters must describe the full company catalog.
    if (!result.ok) return result;
    items.push(...result.data.items);
    const cursor = result.data.next_cursor;
    if (!cursor) return { ok: true as const, data: { items, next_cursor: null } };
    if (seen.has(cursor)) break;
    seen.add(cursor);
    url.searchParams.set("cursor", cursor);
  }
  return { ok: false as const, error: "unavailable" as const };
}
