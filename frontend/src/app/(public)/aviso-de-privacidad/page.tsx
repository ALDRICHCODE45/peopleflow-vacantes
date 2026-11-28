import type { Metadata } from "next";
import { LegalDraftPage } from "../terminos/_legal-draft";

export const metadata: Metadata = {
  title: "Aviso de privacidad",
  robots: { index: false, follow: false },
};

/** Provisional (L23): linked from «Crea tu perfil»; the definitive text is published before launch. */
export default function PrivacyPage() {
  return (
    <LegalDraftPage
      title="Aviso de privacidad"
      sections={["Responsable", "Datos que recabamos", "Finalidades", "Transferencias", "Derechos ARCO", "Cambios a este aviso", "Contacto"]}
      other={{ label: "Términos y condiciones", href: "/terminos" }}
    />
  );
}
