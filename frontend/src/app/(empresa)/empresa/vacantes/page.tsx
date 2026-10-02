import type { Metadata } from "next"
import Link from "next/link"
import { PlusIcon } from "lucide-react"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { buttonVariants } from "@/components/ui/button"
import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies"
import { VacancyPortfolio } from "@/features/employer-vacancies/vacancy-portfolio"
import { cn } from "cn"

/**
 * Employer vacancy portfolio route content.
 *
 * The shared `(empresa)` layout owns the single EmployerShell, the sidebar
 * provider and the theme module, so this route contributes only its header,
 * intro and the mounted portfolio. It stays a server component and
 * owns no fetch, credential, storage or mutation concern; the interactive
 * portfolio arrives as a client component over the frozen local fixtures.
 */
export const metadata: Metadata = {
  title: "Vacantes",
}

export default function Page() {
  return (
    <>
      <SiteHeader title="Vacantes" />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent
          data-pf-vacantes-content=""
          width="screen-2xl"
          className="gap-5 md:gap-6"
        >
          <section
            data-pf-vacantes-intro=""
            aria-label="Presentación de vacantes"
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p className="max-w-prose text-[13.5px] text-muted-foreground">
              Gestiona tus vacantes y su publicación en la bolsa de trabajo.
            </p>
            <Link
              href="/empresa/vacantes/nueva"
              className={cn(
                buttonVariants({ variant: "default", size: "lg" }),
                "h-10 gap-2 px-4",
              )}
            >
              <PlusIcon aria-hidden="true" className="size-4" />
              Nueva vacante
            </Link>
          </section>
          <VacancyPortfolio vacancies={NEXO_VACANCIES} />
        </DashboardPageContent>
      </div>
    </>
  )
}
