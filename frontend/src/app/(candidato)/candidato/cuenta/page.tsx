import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { AccountWorkspace } from "@/features/candidate/account-workspace"
import { CANDIDATE_IDENTITY } from "@/features/candidate/prototype-candidate"

export const metadata: Metadata = {
  title: "Cuenta",
}

/**
 * Candidate account route: the `(candidato)` layout owns the single shell, so
 * this page owns only its header plus the props-only read-only account
 * workspace. The frozen prototype identity is wired here, at the route
 * boundary, so the workspace stays fixture-independent; the page fetches,
 * stores, navigates and mutates nothing.
 */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Cuenta" />
      <AccountWorkspace identity={CANDIDATE_IDENTITY} />
    </>
  )
}
