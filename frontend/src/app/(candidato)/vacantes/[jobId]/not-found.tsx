import { SearchXIcon } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";

export default function VacanteDetailNotFound() {
  return <StateCard headingLevel={1} icon={SearchXIcon} tone="empty"
    title="Esta vacante no está disponible"
    description="La vacante que buscas no existe o ya no está publicada. Explora otras vacantes disponibles."
    primaryAction={{ label: "Explorar vacantes", href: "/vacantes" }}
    secondaryAction={{ label: "Volver al inicio", href: "/" }} />;
}
