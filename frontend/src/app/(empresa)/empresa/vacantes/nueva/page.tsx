import type { Metadata } from "next"

import { DashboardPageContent } from "@/components/dashboard-page-content"
import { CreateVacancyForm } from "@/features/jobs/create/CreateVacancyForm"
import { CreateVacancyHeader } from "@/features/jobs/create/CreateVacancyHeader"

/**
 * Employer create-vacancy route content: the shared `(empresa)` layout mounts
 * the employer shell, so this route owns only its header and the verified form
 * body. The `max-w-7xl` container carries the section grid plus the 24rem
 * dossier rail at `xl`; nothing else about the shell changes.
 *
 * The route owns no data access, no client state and no credential concern.
 */
export const metadata: Metadata = {
  title: "Nueva vacante",
}

export default function Page() {
  return (
    <>
      <CreateVacancyHeader />
      <div className="@container/main flex flex-1 flex-col">
        <DashboardPageContent
          data-pf-create-vacancy-content=""
          width="7xl"
          className="gap-5 md:gap-6"
        >
          <CreateVacancyForm />
        </DashboardPageContent>
      </div>
    </>
  )
}
