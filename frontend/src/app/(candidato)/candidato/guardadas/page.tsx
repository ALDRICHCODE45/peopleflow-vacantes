import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { SavedVacanciesWorkspace } from "@/features/candidate/saved-vacancies-workspace"

export const metadata: Metadata = {
  title: "Vacantes guardadas",
}

/** The candidate layout owns the shell; the workspace reads the session's saved list. */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Vacantes guardadas" />
      <SavedVacanciesWorkspace />
    </>
  )
}
