import type { Metadata } from "next"

import { CandidateHeader } from "@/components/candidate-dashboard/candidate-header"
import { DashboardPageContent } from "@/components/dashboard-page-content"
import { NotificationPreferences } from "@/features/notifications/ui/notification-preferences"

export const metadata: Metadata = {
  title: "Notificaciones",
}

/** Candidate «Mis preferencias» (T4.2, design 05 candidate variant); the `(candidato)` layout owns the shell and the guard. */
export default function Page() {
  return (
    <>
      <CandidateHeader title="Notificaciones" parent={{ label: "Configuración", href: "/candidato/configuracion" }} />
      <DashboardPageContent width="full" className="mx-auto w-full max-w-[65rem]">
        <NotificationPreferences scope="candidate" />
      </DashboardPageContent>
    </>
  )
}
