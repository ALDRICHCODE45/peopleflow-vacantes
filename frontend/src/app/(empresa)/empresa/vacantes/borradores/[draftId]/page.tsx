import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
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
      <SiteHeader title="Editar borrador" parent={{label:"Vacantes",href:"/empresa/vacantes"}} />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent data-pf-draft-vacante-content="" width="7xl" className="gap-5 md:gap-6">
          <Button nativeButton={false} role="link" variant="outline" className="min-h-10 self-start" render={<Link href={`/empresa/vacantes/${draftId}/pipeline`} />}>
            <GitBranch aria-hidden="true" data-icon="inline-start" />Configurar pipeline
          </Button>
          <DraftEditLoader draftId={draftId} />
        </DashboardPageContent>
      </div>
    </>
  );
}
