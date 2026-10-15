import type { Metadata } from "next";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { DraftList } from "@/features/jobs/drafts/list/draft-list";

export const metadata: Metadata = { title: "Borradores" };

export default function Page() {
  return <>
    <SiteHeader title="Borradores" parent={{ label: "Vacantes", href: "/empresa/vacantes" }} />
    <div className="@container/main flex flex-1 flex-col">
      <DashboardPageContent width="7xl" className="gap-5 md:gap-6">
        <DraftList />
      </DashboardPageContent>
    </div>
  </>;
}
