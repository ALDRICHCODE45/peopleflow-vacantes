import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate"
import { ProfileWorkspace } from "@/features/candidate/profile-workspace"

export const metadata: Metadata = {
  title: "Perfil",
}

/**
 * Candidate profile route: the `(candidato)` layout owns the single shell, so
 * this page owns only its header plus the props-only local profile workspace.
 * The frozen prototype identity and profile are wired here, at the route
 * boundary, together with the local portrait source, so the workspace stays
 * fixture-independent; the page fetches, stores, navigates and mutates nothing.
 */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Perfil" />
      <ProfileWorkspace identity={CANDIDATE_IDENTITY} profile={CANDIDATE_PROFILE} avatarSrc="/candidate/ximena-barrera.jpg" />
    </>
  )
}
