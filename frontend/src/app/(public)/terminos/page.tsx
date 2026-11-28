import type { Metadata } from "next";
import { LegalDraftPage } from "./_legal-draft";

export const metadata: Metadata = {
  title: "Términos y condiciones",
  robots: { index: false, follow: false },
};

/** Provisional (L23): linked from «Crea tu perfil»; the definitive text is published before launch. */
export default function TermsPage() {
  return (
    <LegalDraftPage
      title="Términos y condiciones"
      sections={["Objeto", "Uso de la plataforma", "Cuentas", "Contenido publicado", "Responsabilidad", "Cambios a estos términos", "Contacto"]}
      other={{ label: "Aviso de privacidad", href: "/aviso-de-privacidad" }}
    />
  );
}
