import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { TeamInvitation } from "@/features/employer-team/team-invitation"
import { NEXO_TEAM_MEMBERS } from "@/features/employer-team/prototype-team"
import { TeamWorkspace } from "@/features/employer-team/team-workspace"

/**
 * Employer team workspace route content.
 *
 * The shared `(empresa)` layout owns the single EmployerShell, the sidebar
 * provider and the theme module, so this route contributes only its header,
 * intro and the mounted invitation + workspace surfaces. It stays
 * a server component and owns no fetch, credential, storage or mutation
 * concern; both interactive surfaces arrive as client components over the
 * frozen local fixtures.
 */
export const metadata: Metadata = {
  title: "Equipo",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Equipo" />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div
            data-pf-equipo-content=""
            className="flex flex-col gap-5 px-4 py-5 md:gap-6 md:py-6 lg:px-6"
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
            <TeamInvitation />
            <TeamWorkspace members={NEXO_TEAM_MEMBERS} />
          </div>
        </div>
      </div>
    </>
  )
}
