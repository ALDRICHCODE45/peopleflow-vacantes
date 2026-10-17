import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { CvWorkspace } from "@/features/candidate/cv-workspace"

export const metadata: Metadata = {
  title: "CVs",
}

/** The candidate layout owns identity and the shell; the workspace loads the private library. */
export default function Page() {
  return (
    <>
      <CandidateHeader title="CVs" />
      <CvWorkspace />
    </>
  )
}
