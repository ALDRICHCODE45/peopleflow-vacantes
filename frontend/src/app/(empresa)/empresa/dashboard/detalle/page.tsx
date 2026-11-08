import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardDetailPage } from "@/features/employer-dashboard/detail/detail-page"

/**
 * The records behind a figure of the company dashboard (artboard 08 anatomy,
 * `design/system.md` rule 16). The client page reads its kind, filters and
 * window from the URL; the API forces the scope by role. This route has no
 * fetch or credential concern of its own.
 */
export const metadata: Metadata = {
  title: "Detalle · Panel de empresa",
}

export default function Page() {
  return (
    <>
      <SiteHeader />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardDetailPage />
      </div>
    </>
  )
}
