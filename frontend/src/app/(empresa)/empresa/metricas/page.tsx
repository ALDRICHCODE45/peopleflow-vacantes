import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { CompanyMetricsPage } from "@/features/company-metrics/company-metrics-page"

/**
 * Owner and stakeholder metrics route: «Métricas».
 *
 * The shared `(empresa)` layout owns the single EmployerShell, so this route
 * contributes its header and the mounted client page, which resolves the
 * membership role before reading anything. It stays a server component with
 * no fetch or credential concern of its own.
 */
export const metadata: Metadata = {
  title: "Métricas",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Métricas" />
      <div className="@container/main flex flex-1 flex-col">
        <CompanyMetricsPage />
      </div>
    </>
  )
}
