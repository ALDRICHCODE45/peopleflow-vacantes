import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { MetricsDetailPage } from "@/features/company-metrics/detail/detail-page"

/**
 * The records behind a figure of «Métricas» (artboard 08, `design/system.md`
 * rule 16). The client page reads its filters from the URL and resolves the
 * membership role before reading anything; this route has no fetch or
 * credential concern of its own.
 */
export const metadata: Metadata = {
  title: "Detalle · Métricas",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Métricas" />
      <div className="@container/main flex flex-1 flex-col">
        <MetricsDetailPage />
      </div>
    </>
  )
}
