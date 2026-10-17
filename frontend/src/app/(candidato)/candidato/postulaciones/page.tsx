import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { ApplicationsWorkspace } from "@/features/candidate/applications-workspace"

export const metadata: Metadata = {
  title: "Postulaciones",
}

/** The candidate layout guards identity; the workspace loads the private list. */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Postulaciones" />
      <ApplicationsWorkspace />
    </>
  )
}
