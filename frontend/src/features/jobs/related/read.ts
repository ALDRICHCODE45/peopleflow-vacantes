import "server-only";
import { getCompanyProfile } from "@/features/company-site/api/client";
import { validateSlug } from "@/features/company-site/slug";
import { listRelatedJobs, type RelatedJobsQuery } from "../api/listRelatedJobs";
import type { PublicJobDetail, PublicJobItem } from "../types";

/** A failed optional read has no renderable data: omit that section, not the detail. */
export type RelatedResult<T> = { ok: true; data: T } | { ok: false };
export type RelatedCompany = PublicJobDetail["company"] & {
  description: string | null;
  sector: string | null;
  size: string | null;
  careersHref: string | null;
};

export async function readCompanyVacancies(job: PublicJobDetail): Promise<RelatedResult<PublicJobItem[]>> {
  try {
    const result = await listRelatedJobs({ company_id: job.company.id, limit: 4 });
    if (!result.ok) return { ok: false };
    return { ok: true, data: result.data.items.filter(item => item.id !== job.id).slice(0, 3) };
  } catch { return { ok: false }; }
}

export async function readSimilarVacancies(job: PublicJobDetail): Promise<RelatedResult<PublicJobItem[]>> {
  if (!job.professional_area) return { ok: true, data: [] };
  try {
    const state = job.location?.state?.id;
    const query = { professional_area: job.professional_area, limit: 7 };
    const items: PublicJobItem[] = [];
    const seen = new Set<string>();
    const append = (candidates: PublicJobItem[]) => {
      for (const item of candidates) {
        if (item.id === job.id || item.company.id === job.company.id || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
        if (items.length === 3) break;
      }
    };
    const readPages = async (filters: RelatedJobsQuery): Promise<boolean> => {
      let cursor: string | undefined;
      for (let page = 0; page < 3 && items.length < 3; page++) {
        const result = await listRelatedJobs({ ...filters, ...(cursor ? { cursor } : {}) });
        if (!result.ok) return false;
        append(result.data.items);
        if (!result.data.next_cursor) break;
        cursor = result.data.next_cursor;
      }
      return true;
    };
    if (!await readPages({ ...query, ...(state ? { state } : {}) })) return { ok: false };
    if (state && items.length < 3 && !await readPages(query)) return { ok: false };
    return { ok: true, data: items };
  } catch { return { ok: false }; }
}

/** Reuses the anonymous profile projection; absent public metadata stays absent. */
export async function readRelatedCompany(job: PublicJobDetail): Promise<RelatedResult<RelatedCompany>> {
  try {
    const { serverEnv } = await import("@/lib/env/server");
    const absent = { description: null, sector: null, size: null, careersHref: null };
    if (serverEnv.sampleJobs) return { ok: true, data: { ...job.company, ...absent } };
    const result = await getCompanyProfile(job.company.id);
    if (!result.ok) return { ok: false };
    // Only the published locator proves a careers site exists, never the website.
    const { id, name, logo_url, description, site_slug } = result.company;
    const careersHref = typeof site_slug === "string" && site_slug === site_slug.trim() && validateSlug(site_slug) === null
      ? `/empresas/${site_slug}` : null;
    return { ok: true, data: { ...absent, id, name, logo_url, description, careersHref } };
  } catch { return { ok: false }; }
}
