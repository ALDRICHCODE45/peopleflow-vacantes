import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { RecruitersPage } from "@/features/company-metrics/recruiters-page"

/**
 * The full «Desempeño por reclutador» table (artboard `design/recruiter-table-redesign/01`): the page behind the board's
 * «Ver tabla completa». The client page reads period, filters, order and columns from the URL and resolves the
 * membership role before reading anything (owner and stakeholder; a recruiter gets «Métricas restringidas»); this route has no
 * fetch or credential concern of its own.
 */
export const metadata: Metadata = {
  title: "Desempeño por reclutador · Métricas",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Métricas" />
      <div className="@container/main flex flex-1 flex-col">
        <RecruitersPage />
      </div>
    </>
  )
}
