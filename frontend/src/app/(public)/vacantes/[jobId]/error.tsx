"use client";

import * as React from "react";
import Link from "next/link";

import { Button } from "../../../../components/ui/button";

// Route-local client error boundary for retryable detail failures (service,
// timeout, schema). It is intentionally distinct from the branded not-found
// page: a retryable failure is never presented as "vacante no disponible".
export default function VacanteDetailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section role="alert" className="flex flex-col items-start gap-3 py-6">
      <h2 className="font-heading text-xl font-medium text-foreground">
        No se pudo cargar la vacante
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        El servicio de vacantes no respondió correctamente. Puedes reintentar la
        carga.
      </p>
      <Button type="button" onClick={reset}>
        Intentar de nuevo
      </Button>
      <Link
        href="/vacantes"
        className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      >
        Volver a vacantes
      </Link>
    </section>
  );
}
