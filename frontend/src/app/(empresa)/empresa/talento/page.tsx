import type { Metadata } from "next"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { TALENT_VACANCY_TITLES } from "@/features/employer-talent/model"
import { TALENT_PEOPLE } from "@/features/employer-talent/prototype-talent"
import { TalentWorkspace } from "@/features/employer-talent/talent-workspace"

/**
 * Employer talent base route content.
 *
 * The shared `(empresa)` layout owns the single EmployerShell, the sidebar
 * provider and the theme module, so this route contributes only its header,
 * intro and the mounted workspace. It stays a server component and owns no
 * fetch, credential, storage or mutation concern; the interactive workspace is a
 * client component over the frozen local fixture and reaches no backend.
 */
export const metadata: Metadata = {
  title: "Base de talento",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Base de talento" />
      <div className="@container/main flex flex-1 flex-col">
        {/* One outer padding owner: the shared page-content wrapper, so the
            workspace adds no second page inset. */}
        <DashboardPageContent
          data-pf-talento-content=""
          width="screen-2xl"
          className="gap-5 md:gap-6"
        >
          <section
            data-pf-talento-intro=""
            aria-labelledby="talento-intro-title"
            className="flex flex-col gap-1.5"
          >
            <h2
              id="talento-intro-title"
              className="font-heading text-xl font-semibold tracking-tight text-foreground"
            >
              Explora tu base de talento
            </h2>
            <p className="max-w-prose text-[13.5px] text-muted-foreground">
              Consulta a las personas que han postulado a tus vacantes, con su
              perfil y el historial completo de cada postulación.
            </p>
          </section>
          <TalentWorkspace
            people={TALENT_PEOPLE}
            vacancyTitleById={TALENT_VACANCY_TITLES}
          />
        </DashboardPageContent>
      </div>
    </>
  )
}
