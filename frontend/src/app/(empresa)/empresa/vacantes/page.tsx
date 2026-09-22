import type { Metadata } from "next"
import Link from "next/link"
import { InfoIcon, PlusIcon } from "lucide-react"

import { SiteHeader } from "@/components/company-dashboard/site-header"
import { buttonVariants } from "@/components/ui/button"
import { NEXO_VACANCIES } from "@/features/employer-vacancies/prototype-vacancies"
import { VacancyPortfolio } from "@/features/employer-vacancies/vacancy-portfolio"
import { cn } from "cn"

/**
 * Employer vacancy portfolio route content.
 *
 * The shared `(empresa)` layout owns the single EmployerShell, the sidebar
 * provider and the theme module, so this route contributes only its header,
 * intro, disclosure and the mounted portfolio. It stays a server component and
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
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div
            data-pf-vacantes-content=""
            className="flex flex-col gap-5 px-4 py-5 md:gap-6 md:py-6 lg:px-6"
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
            <p
              role="note"
              data-pf-vacantes-disclosure=""
              className="flex items-start gap-2.5 rounded-xl border border-border bg-card/50 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground"
            >
              <InfoIcon aria-hidden="true" className="mt-px size-4 shrink-0" />
              <span>
                Datos de demostración locales: las vacantes y sus pipelines viven
                solo en este prototipo y los cambios no se guardan.
              </span>
            </p>
            <VacancyPortfolio vacancies={NEXO_VACANCIES} />
          </div>
        </div>
      </div>
    </>
  )
}
