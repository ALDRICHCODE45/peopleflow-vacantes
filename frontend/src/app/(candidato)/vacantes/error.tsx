"use client";

import { CircleAlertIcon } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";

export default function VacantesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StateCard headingLevel={1} role="alert" icon={CircleAlertIcon} tone="error"
    title="No se pudieron cargar las vacantes"
    description="No se mostró ninguna vacante. Vuelve a intentarlo; si el problema sigue, prueba de nuevo en unos minutos."
    primaryAction={{ label: "Reintentar", onClick: reset }}
    secondaryAction={{ label: "Volver al inicio", href: "/" }} />;
}
