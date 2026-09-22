import type { Metadata } from "next"

import { CandidateDestinationShell } from "@/components/candidate-dashboard/candidate-destination-shell"

export const metadata: Metadata = {
  title: "Postulaciones",
}

/**
 * Candidate applications placeholder: the shared `(candidato)` layout mounts the
 * candidate shell, so this route owns only its header and honest local preview.
 * CDP-06 replaces this shell with the searchable, status-filtered applications.
 */
export default function Page() {
  return (
    <CandidateDestinationShell
      title="Postulaciones"
      summary="Seguí el estado de cada postulación y la fuente por la que llegaste a la vacante."
      preview={[
        "Listado de postulaciones con estado y fuente.",
        "Búsqueda por puesto y filtros por estado.",
        "Enlaces a las vacantes públicas cuando existan.",
      ]}
    />
  )
}
