"use client";

import { CircleAlertIcon } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";

export default function VacanteDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <StateCard headingLevel={1} role="alert" icon={CircleAlertIcon} tone="error"
    title="No se pudo cargar la vacante"
    description="El servicio de vacantes no respondió correctamente. Puedes reintentar la carga."
    primaryAction={{ label: "Reintentar", onClick: reset }}
    secondaryAction={{ label: "Ver vacantes", href: "/vacantes" }} />;
}
