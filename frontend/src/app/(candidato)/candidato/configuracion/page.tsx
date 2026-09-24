import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { SettingsWorkspace } from "@/features/candidate/settings-workspace"

export const metadata: Metadata = {
  title: "Configuración",
}

/**
 * Candidate settings route: the `(candidato)` layout owns the single shell, so
 * this page owns only its header plus the client settings workspace. Settings
 * receives no props: it renders no identity fact sheet and owns only its own
 * session-scoped view state, while the page fetches, stores, navigates and
 * mutates nothing.
 */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Configuración" />
      <SettingsWorkspace />
    </>
  )
}
