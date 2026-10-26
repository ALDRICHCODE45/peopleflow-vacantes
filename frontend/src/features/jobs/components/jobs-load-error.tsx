"use client";

import * as React from "react";
import { CircleAlert } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { reloadPage } from "./reload-page";

/** Listing load failure. Retrying reloads the current URL as a new document:
    a same-URL client navigation or router.refresh() sometimes received the
    recovered payload without applying it, leaving the error on screen. */
export function JobsLoadError() {
  const [retrying, setRetrying] = React.useState(false);
  return <StateCard role="alert" icon={CircleAlert} tone="error"
    title="No se pudieron cargar las vacantes"
    description="No pudimos mostrar los resultados. Conservamos los filtros de tu búsqueda para que puedas intentarlo de nuevo."
    primaryAction={{ label: "Intentar de nuevo", disabled: retrying, onClick: () => { setRetrying(true); reloadPage(); } }}
    secondaryAction={{ href: "/vacantes", label: "Ver todas las vacantes" }} />;
}
