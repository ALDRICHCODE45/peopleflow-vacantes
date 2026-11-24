import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { isValidJobId } from "@/features/jobs/jobId";
import { DraftEditLoader } from "@/features/jobs/drafts/reopen/draft-edit-loader";
import { DraftColumnsLink, DraftPageChromeProvider, DraftPageHeader } from "@/features/jobs/drafts/ui/draft-page-chrome";

// Keep this private workspace dynamic; the RSC itself reads no private data.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {title:"Editar vacante"};

export default async function Page({params}:{params:Promise<{draftId:string}>}) {
  const {draftId} = await params;
  if (!isValidJobId(draftId)) notFound();
  return (
    <DraftPageChromeProvider>
      <DraftPageHeader />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent data-pf-draft-vacante-content="" width="editor" className="gap-5 md:gap-6">
          <DraftColumnsLink draftId={draftId} />
          <DraftEditLoader draftId={draftId} />
        </DashboardPageContent>
      </div>
    </DraftPageChromeProvider>
  );
}
