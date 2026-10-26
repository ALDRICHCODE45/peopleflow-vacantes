"use client";

import * as React from "react";
import { CircleAlertIcon } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { reloadPage } from "@/features/jobs/components/reload-page";

/** Retry reloads the document: reset() only re-renders on the client and never
    re-requests the server data that failed. */
export default function VacanteDetailError() {
  const [retrying, setRetrying] = React.useState(false);
  return <>
    {/* React hoists this into <head>: an API failure must never be indexed as the vacancy. */}
    <meta name="robots" content="noindex" />
    <StateCard headingLevel={1} role="alert" icon={CircleAlertIcon} tone="error"
      title="No se pudo cargar la vacante"
      description="El servicio de vacantes no respondió correctamente. Puedes reintentar la carga."
      primaryAction={{ label: "Reintentar", disabled: retrying, onClick: () => { setRetrying(true); reloadPage(); } }}
      secondaryAction={{ label: "Ver vacantes", href: "/vacantes" }} />
  </>;
}
