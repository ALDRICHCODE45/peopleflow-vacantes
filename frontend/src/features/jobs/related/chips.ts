import { PROFESSIONAL_AREA_OPTIONS } from "../drafts/ui/draft-labels";
import { seniorityLabel } from "../formatters";
import type { PublicJobDetail } from "../types";
import { buildJobsUrl, type JobsQuery } from "../url";

export type RelatedSearchChip = { label: string; href: string };
export type RelatedSearchSource = Pick<PublicJobDetail, "professional_area" | "location" | "work_mode" | "seniority">;

/** Only filters present on the vacancy; expanded geography already owns state names. */
export function deriveRelatedSearches(job: RelatedSearchSource): RelatedSearchChip[] {
  const chips: RelatedSearchChip[] = [];
  const add = (label: string, query: JobsQuery) => chips.push({ label, href: buildJobsUrl(query) });
  const state = job.location?.state;
  const area = PROFESSIONAL_AREA_OPTIONS.find(option => option.value === job.professional_area)?.label;
  if (area && job.professional_area) {
    const professional_area = job.professional_area;
    if (state) add(`${area} en ${state.name}`, { professional_area, state: state.id });
    if (job.work_mode === "remote") add(`${area} remoto`, { professional_area, work_mode: "remote" });
    if (job.seniority) add(`${area} · ${seniorityLabel(job.seniority)}`, { professional_area, seniority: job.seniority });
  }
  if (state) add(`Vacantes en ${state.name}`, { state: state.id });
  return chips;
}
