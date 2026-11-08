import type { Metadata } from "next"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardWorkspace } from "@/features/employer-dashboard/workspace"

export const metadata: Metadata = { title: "Panel de empresa" }

/** `/empresa/dashboard` (artboard 09): the workspace owns its greeting header and loads each section on its own. */
export default function Page() {
  return (
    <>
      <SiteHeader />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="min-w-0">
          <DashboardWorkspace />
        </DashboardPageContent>
      </div>
    </>
  )
}
