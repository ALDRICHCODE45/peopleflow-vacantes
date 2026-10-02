import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { CvWorkspace } from "@/features/candidate/cv-workspace"
import { CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio"

export const metadata: Metadata = {
  title: "CVs",
}

/**
 * Candidate CV route: the `(candidato)` layout owns the single shell, so this
 * page owns only its header plus the props-only CV workspace. The frozen
 * inventory is supplied here, at the route boundary, so the workspace stays
 * fixture-independent; the page fetches, stores, navigates and mutates nothing.
 */
export default function Page() {
  return (
    <>
      <CandidateHeader title="CVs" />
      <CvWorkspace cvs={CANDIDATE_CVS} />
    </>
  )
}
