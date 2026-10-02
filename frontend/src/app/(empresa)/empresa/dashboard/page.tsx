import type { Metadata } from "next"

import { ActiveVacancies } from "@/components/company-dashboard/active-vacancies"
import { ChartAreaInteractive } from "@/components/company-dashboard/chart-area-interactive"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { DataTable } from "@/components/company-dashboard/data-table"
import { SectionCards } from "@/components/company-dashboard/section-cards"
import { SiteHeader } from "@/components/company-dashboard/site-header"
import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies"

import data from "./data.json"

export const metadata: Metadata = {
  title: "Panel de empresa",
}

/**
 * Employer dashboard route content: the shared `(empresa)` layout mounts the
 * employer shell, so this route owns only its header and body. The active
 * vacancies panel renders from the frozen NEXO fixtures between the chart and
 * the recent-applicants table; it stays a server component and never reconciles
 * the older KPI snapshot the cards still report.
 */
export default function Page() {
  return (
    <>
      <SiteHeader />
      <div className="@container/main flex flex-1 flex-col">
        {/* One outer padding owner: the shared page-content wrapper, so the KPI
            cards, chart, active vacancies and data table no longer each carry
            their own horizontal inset. */}
        <DashboardPageContent width="screen-2xl" className="gap-4 md:gap-6">
          <SectionCards />
          <ChartAreaInteractive />
          <ActiveVacancies vacancies={NEXO_VACANCIES} />
          <DataTable data={data} />
        </DashboardPageContent>
      </div>
    </>
  )
}
