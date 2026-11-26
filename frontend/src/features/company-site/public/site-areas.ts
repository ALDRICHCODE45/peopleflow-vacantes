import { PROFESSIONAL_AREA_OPTIONS } from "@/features/jobs/drafts/ui/draft-labels";
import type { PROFESSIONAL_AREAS } from "@/features/jobs/drafts/scalars";
import type { PublicJobItem } from "@/features/jobs/types";
import type { ICONS } from "../model";

export type ProfessionalArea = (typeof PROFESSIONAL_AREAS)[number];
export type SiteArea = { key: ProfessionalArea; label: string; count: number };

/** Catalog icon shown for an area unless the «Áreas de trabajo» block overrides it. */
export const DEFAULT_AREA_ICONS = {
  technology_systems: "code", engineering: "wrench", product: "package", design_creative: "palette",
  sales_business_development: "trending-up", marketing_communications: "megaphone", administration_finance: "banknote",
  human_resources: "users", operations_production: "factory", logistics_transport: "truck",
  customer_service_support: "headphones", healthcare: "stethoscope", education_training: "graduation-cap",
  legal: "scale", construction_maintenance: "hard-hat", tourism_hospitality_gastronomy: "utensils",
} as const satisfies Record<ProfessionalArea, (typeof ICONS)[number]>;

const collator = new Intl.Collator("es-MX");
/** «Áreas de trabajo» cards come from the published vacancies' `professional_area`
 * (no new data): one per area with at least one vacancy, most vacancies first. */
export function deriveSiteAreas(jobs: readonly PublicJobItem[]): SiteArea[] {
  const counts = new Map<ProfessionalArea, number>();
  for (const job of jobs) if (job.professional_area) counts.set(job.professional_area, (counts.get(job.professional_area) ?? 0) + 1);
  return PROFESSIONAL_AREA_OPTIONS.flatMap(option => {
    const count = counts.get(option.value as ProfessionalArea);
    return count ? [{ key: option.value as ProfessionalArea, label: option.label, count }] : [];
  }).sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
}
