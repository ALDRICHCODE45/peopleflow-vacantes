"use client";

import * as React from "react";
import { CircleAlertIcon } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { reloadPage } from "@/features/jobs/components/reload-page";

/** Retry reloads the document: reset() only re-renders on the client and never
    re-requests the server data that failed. */
export default function VacantesError() {
  const [retrying, setRetrying] = React.useState(false);
  return <StateCard headingLevel={1} role="alert" icon={CircleAlertIcon} tone="error"
    title="No se pudieron cargar las vacantes"
    description="No se mostró ninguna vacante. Vuelve a intentarlo; si el problema sigue, prueba de nuevo en unos minutos."
    primaryAction={{ label: "Reintentar", disabled: retrying, onClick: () => { setRetrying(true); reloadPage(); } }}
    secondaryAction={{ label: "Volver al inicio", href: "/" }} />;
}
