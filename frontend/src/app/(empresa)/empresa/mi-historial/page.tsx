import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/company-dashboard/site-header";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { AssignmentHistoryPage } from "@/features/vacancy-assignments/page";
import { prototypeEnabled } from "@/features/vacancy-team/model";

export const metadata: Metadata = { title: "Mi historial de vacantes" };

export default function Page() {
  if (!prototypeEnabled(process.env.NODE_ENV, process.env.NEXT_PUBLIC_VACANCY_TEAM_PROTOTYPE)) notFound();
  return <>
    <SiteHeader title="Mi historial de vacantes" />
    <div className="@container/main flex flex-1 flex-col">
      <DashboardPageContent width="screen-2xl" className="gap-5 md:gap-6">
        <section aria-label="Presentación de tu historial" className="flex flex-col gap-1.5"><p className="max-w-prose text-[13.5px] text-muted-foreground">Consulta las vacantes en las que has trabajado y lo que aportaste en cada una.</p></section>
        <AssignmentHistoryPage />
      </DashboardPageContent>
    </div>
  </>;
}
