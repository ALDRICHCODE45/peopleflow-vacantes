import "server-only";
import { getCompanyProfile } from "@/features/company-site/api/client";
import { listRelatedJobs } from "../api/listRelatedJobs";
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
    const first = await listRelatedJobs({ ...query, ...(state ? { state } : {}) });
    if (!first.ok) return { ok: false };
    const items: PublicJobItem[] = [];
    const seen = new Set<string>();
    const append = (candidates: PublicJobItem[]) => {
      for (const item of candidates) {
        if (item.id === job.id || item.company.id === job.company.id || seen.has(item.id)) continue;
        seen.add(item.id);
        items.push(item);
      }
    };
    append(first.data.items);
    if (state && items.length < 3) {
      const fill = await listRelatedJobs(query);
      if (!fill.ok) return { ok: false };
      append(fill.data.items);
    }
    return { ok: true, data: items.slice(0, 3) };
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
    // The existing public read has no sector, size or published-site locator.
    // A company website is not proof that a careers site is published.
    const { id, name, logo_url, description } = result.company;
    return { ok: true, data: { ...absent, id, name, logo_url, description } };
  } catch { return { ok: false }; }
}
