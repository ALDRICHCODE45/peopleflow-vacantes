import type { Metadata } from "next"

import { CandidateDestinationShell } from "@/components/candidate-dashboard/candidate-destination-shell"

export const metadata: Metadata = {
  title: "Dashboard",
}

/**
 * Candidate dashboard placeholder: the shared `(candidato)` layout mounts the
 * candidate shell, so this route owns only its header and honest local preview.
 * CDP-04/CDP-05 replace this shell with the derived overview from frozen props.
 */
export default function Page() {
  return (
    <CandidateDestinationShell
      title="Dashboard"
      summary="Tu resumen de búsqueda: postulaciones recientes, estado del perfil y CV principal en un solo lugar."
      preview={[
        "Resumen de postulaciones activas y su estado.",
        "Guía de perfil completo con lo que falta cargar.",
        "Aplicaciones recientes y tu CV principal.",
      ]}
    />
  )
}
