import type { PublicJobItem } from "@/features/jobs/types";
import type { PublicSite, PublicSiteV2 } from "./schema";

/** Serializable across the server/client boundary (React supports Map). */
export type CompanySitePreviewData = {
  company: PublicSite["company"];
  jobs: PublicJobItem[];
  jobsAvailable?: boolean;
  officeLabels: Map<string, string>;
};
export type CompanySitePresentationProps = CompanySitePreviewData & {
  /** A sections v2 document (the editor's `SiteDraftV2`, the public v2 read); a legacy
   * v1 document still renders, as its v2 read (default style and hero buttons). */
  site: PublicSiteV2["site"] | PublicSite["site"];
  selectedBlockId?: string | null;
  onSelectBlock?: (id: string) => void;
};
