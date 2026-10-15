import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { isValidJobId } from "@/features/jobs/jobId";
import { DraftEditLoader } from "@/features/jobs/drafts/reopen/draft-edit-loader";

// Keep this private workspace dynamic; the RSC itself reads no private data.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {title:"Editar borrador"};

export default async function Page({params}:{params:Promise<{draftId:string}>}) {
  const {draftId} = await params;
  if (!isValidJobId(draftId)) notFound();
  return (
    <>
      <SiteHeader title="Editar borrador" parent={{label:"Borradores",href:"/empresa/vacantes/borradores"}} />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent data-pf-draft-vacante-content="" width="7xl" className="gap-5 md:gap-6">
          <DraftEditLoader draftId={draftId} />
        </DashboardPageContent>
      </div>
    </>
  );
}
