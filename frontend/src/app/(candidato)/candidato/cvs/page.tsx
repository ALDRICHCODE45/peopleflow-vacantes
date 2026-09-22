import type { Metadata } from "next"

import { CandidateDestinationShell } from "@/components/candidate-dashboard/candidate-destination-shell"

export const metadata: Metadata = {
  title: "CVs",
}

/**
 * Candidate CV placeholder: the shared `(candidato)` layout mounts the candidate
 * shell, so this route owns only its header and honest local preview. CDP-08
 * replaces this shell with the frozen CV inventory and disabled upload actions.
 */
export default function Page() {
  return (
    <CandidateDestinationShell
      title="CVs"
      summary="Tus documentos de CV y cuál se comparte con cada postulación."
      preview={[
        "Inventario de CV con idioma y formato.",
        "CV principal frente a documentos secundarios.",
        "Acciones de carga y reemplazo, hoy no disponibles.",
      ]}
    />
  )
}
