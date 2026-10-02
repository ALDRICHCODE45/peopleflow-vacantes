import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { ApplicationsWorkspace } from "@/features/candidate/applications-workspace"
import { CANDIDATE_APPLICATIONS } from "@/features/candidate/prototype-portfolio"

export const metadata: Metadata = {
  title: "Postulaciones",
}

/**
 * Candidate applications route: the `(candidato)` layout owns the single shell,
 * so this page owns only its header plus the props-only workspace. The frozen
 * fixture is supplied at this route boundary, and the page fetches, stores,
 * navigates and mutates nothing.
 */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Postulaciones" />
      <ApplicationsWorkspace applications={CANDIDATE_APPLICATIONS} />
    </>
  )
}
