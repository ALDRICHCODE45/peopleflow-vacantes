import type { Metadata } from "next"

import { CandidateDestinationShell } from "@/components/candidate-dashboard/candidate-destination-shell"

export const metadata: Metadata = {
  title: "Cuenta",
}

/**
 * Candidate account placeholder: the shared `(candidato)` layout mounts the
 * candidate shell, so this route owns only its header and honest local preview.
 * CDP-09 replaces this shell with the read-only account and security context.
 */
export default function Page() {
  return (
    <CandidateDestinationShell
      title="Cuenta"
      summary="Tus datos de acceso y la información de la cuenta de candidata."
      preview={[
        "Datos de identidad de la cuenta.",
        "Contexto de proveedor y seguridad de solo lectura.",
        "Cambios de correo y contraseña, hoy no disponibles.",
      ]}
    />
  )
}
