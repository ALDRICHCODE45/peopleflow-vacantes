import type { Metadata } from "next"

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
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div
            data-pf-create-vacancy-content=""
            className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-4 md:gap-6 md:py-6 lg:px-6"
          >
            <CreateVacancyForm />
          </div>
        </div>
      </div>
    </>
  )
}
