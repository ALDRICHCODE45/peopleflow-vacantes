import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { StakeholderVacanciesPage } from "@/features/stakeholder-vacancies/stakeholder-vacancies-page"

/**
 * Stakeholder «Vacantes» route: `/empresa/stakeholder/vacantes` (`STAKEHOLDER_VACANCIES`, S12).
 *
 * The read-only list of the company's vacancies, each one opening its Documentos tab. The shared `(empresa)` layout owns the
 * employer shell and `EmployerGuard` the stakeholder gate; this server component reads nothing and owns no credential concern:
 * the mounted client page reads through its server action.
 */
export const metadata: Metadata = {
  title: "Vacantes",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Vacantes" />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent width="screen-2xl" className="gap-5 md:gap-6">
          <section aria-label="Presentación de vacantes" className="flex flex-col gap-1.5">
            <h2 className="font-heading text-[22px] font-semibold text-foreground">Vacantes de tu empresa</h2>
            <p className="max-w-prose text-[13.5px] text-muted-foreground">
              Consulta los documentos de cada vacante, incluso los de borradores. Es solo lectura: puedes ver y descargar.
            </p>
          </section>
          <StakeholderVacanciesPage />
        </DashboardPageContent>
      </div>
    </>
  )
}
