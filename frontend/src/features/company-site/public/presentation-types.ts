import type { PublicJobItem } from "@/features/jobs/types";
import type { PublicSite } from "./schema";

/** Serializable across the server/client boundary (React supports Map). */
export type CompanySitePreviewData = {
  company: PublicSite["company"];
  jobs: PublicJobItem[];
  jobsAvailable?: boolean;
  officeLabels: Map<string, string>;
};
export type CompanySitePresentationProps = CompanySitePreviewData & {
  site: PublicSite["site"];
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
};
