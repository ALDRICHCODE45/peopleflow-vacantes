import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { SavedVacanciesWorkspace } from "@/features/candidate/saved-vacancies-workspace"
import { ACME_PROTOTYPE_JOBS } from "@/features/jobs/prototype-jobs"

export const metadata: Metadata = {
  title: "Vacantes guardadas",
}

/**
 * Candidate saved vacancies route: the `(candidato)` layout owns the single
 * shell, so this page owns only its header plus the props-only workspace. The
 * canonical Acme prototype vacancies are supplied at this route boundary, and
 * the page fetches, stores, navigates and mutates nothing.
 */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Vacantes guardadas" />
      <SavedVacanciesWorkspace savedVacancies={ACME_PROTOTYPE_JOBS} />
    </>
  )
}
