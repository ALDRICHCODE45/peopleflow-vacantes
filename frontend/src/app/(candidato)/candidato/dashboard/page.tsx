import type { Metadata } from "next"

import { CandidateDashboardOverview } from "@/components/candidate-dashboard/candidate-dashboard-overview"
import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "@/features/candidate/prototype-candidate"
import { CANDIDATE_APPLICATION_MESSAGES } from "@/features/candidate/prototype-messages"
import { CANDIDATE_APPLICATIONS, CANDIDATE_CVS } from "@/features/candidate/prototype-portfolio"

export const metadata: Metadata = {
  title: "Dashboard",
}

/**
 * Candidate dashboard route: the `(candidato)` layout owns the single shell, so
 * this page owns only its header plus the props-only overview. Every metric is
 * derived from the five committed frozen fixtures; the page fetches, stores,
 * navigates and mutates nothing.
 */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Dashboard" />
      <CandidateDashboardOverview
        identity={CANDIDATE_IDENTITY}
        profile={CANDIDATE_PROFILE}
        applications={CANDIDATE_APPLICATIONS}
        cvs={CANDIDATE_CVS}
        messages={CANDIDATE_APPLICATION_MESSAGES}
      />
    </>
  )
}
