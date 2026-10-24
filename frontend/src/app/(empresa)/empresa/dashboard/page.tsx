import type { Metadata } from "next"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardWorkspace } from "@/features/employer-dashboard/workspace"

export const metadata: Metadata = { title: "Panel de empresa" }
export default function Page() {
  return (
    <>
      <SiteHeader />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="gap-4 md:gap-6">
          <section aria-label="Presentación del dashboard" className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-1.5">
              <h2 className="font-heading text-[22px] font-semibold text-foreground">Tu dashboard</h2>
              <p className="max-w-prose text-[13.5px] text-muted-foreground">Revisa tus vacantes, el origen de las postulaciones y las incorporaciones recientes.</p>
            </div>
          </section>
          <DashboardWorkspace />
        </DashboardPageContent>
      </div>
    </>
  )
}
