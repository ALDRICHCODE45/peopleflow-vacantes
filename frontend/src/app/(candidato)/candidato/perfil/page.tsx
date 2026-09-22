import type { Metadata } from "next"

import { CandidateDestinationShell } from "@/components/candidate-dashboard/candidate-destination-shell"

export const metadata: Metadata = {
  title: "Perfil",
}

/**
 * Candidate profile placeholder: the shared `(candidato)` layout mounts the
 * candidate shell, so this route owns only its header and honest local preview.
 * CDP-07 replaces this shell with the accessible local-only profile editor.
 */
export default function Page() {
  return (
    <CandidateDestinationShell
      title="Perfil"
      summary="Tu información profesional para que las empresas te conozcan mejor."
      preview={[
        "Datos de contacto y título profesional.",
        "Experiencia, formación y expectativas salariales.",
        "Habilidades e idiomas con niveles verificables.",
      ]}
    />
  )
}
