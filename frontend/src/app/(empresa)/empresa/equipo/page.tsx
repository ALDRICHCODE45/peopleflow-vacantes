import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { TeamPage } from "@/features/employer-team/team-page"

/**
 * Employer team workspace route content.
 *
 * The shared `(empresa)` layout owns the single EmployerShell, the sidebar
 * provider and the theme module, so this route contributes only its header,
 * intro and the connected team surface. Data access and member actions live
 * in the client feature; this route remains server composition.
 */
export const metadata: Metadata = {
  title: "Equipo",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Equipo" />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent
          data-pf-equipo-content=""
          width="screen-2xl"
          className="gap-5 md:gap-6"
        >
          <section
            data-pf-equipo-intro=""
            aria-label="Presentación del equipo"
            className="flex flex-col gap-1.5"
          >
            <p className="max-w-prose text-[13.5px] text-muted-foreground">
              Consulta las personas, roles y carga de trabajo de tu equipo de
              reclutamiento.
            </p>
          </section>
          <TeamPage />
        </DashboardPageContent>
      </div>
    </>
  )
}
