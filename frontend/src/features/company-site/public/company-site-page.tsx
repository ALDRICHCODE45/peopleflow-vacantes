import type { PublicJobItem } from "@/features/jobs/types";
import type { PublicSite } from "./schema";
import { CompanySitePresentation } from "./company-site-presentation";
import { resolveOfficeLabels } from "./preview-data";

/** Server read/geo boundary; props stay compatible with the existing public route. */
export async function CompanySitePage({ data, jobs }: { data: PublicSite; jobs: PublicJobItem[] }) {
  const officeLabels = await resolveOfficeLabels(data.site.blocks.filter(block => !block.hidden));
  return <CompanySitePresentation site={data.site} company={data.company} jobs={jobs} officeLabels={officeLabels} />;
}
