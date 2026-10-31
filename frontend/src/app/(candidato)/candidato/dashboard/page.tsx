import type { Metadata } from "next"
import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { CandidateDashboardWorkspace } from "@/features/candidate/dashboard/workspace"

export const metadata: Metadata = { title: "Dashboard" }

/** The layout owns the shell and guard; private reads start only on client mount. */
export default async function Page() {
  return <>
    <CandidateHeader title="Dashboard" />
    <CandidateDashboardWorkspace />
  </>
}
