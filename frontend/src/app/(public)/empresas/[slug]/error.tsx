"use client";

import { RefreshCw } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { CompanySiteStateFrame } from "./state-frame";

export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <CompanySiteStateFrame>
      <StateCard
        icon={RefreshCw}
        tone="error"
        headingLevel={1}
        role="alert"
        title="No se pudo cargar el sitio"
        description="Inténtalo de nuevo o explora las vacantes disponibles."
        primaryAction={{ label: "Reintentar", onClick: reset }}
        secondaryAction={{ label: "Explorar vacantes", href: "/vacantes" }}
      />
    </CompanySiteStateFrame>
  );
}
