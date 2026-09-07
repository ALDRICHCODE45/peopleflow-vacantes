"use client";

import * as React from "react";

import { Button } from "../../../components/ui/button";

// Client route error boundary for unexpected render/subscription failures.
// The server list read never throws — result-state errors render through
// `JobsResults`; only truly unexpected errors land here.
export default function VacantesError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section role="alert" className="flex flex-col items-start gap-3 py-6">
      <h2 className="font-heading text-xl font-medium text-foreground">
        No se pudieron cargar las vacantes
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        Ocurrió un error inesperado. Puedes reintentar la carga.
      </p>
      <Button type="button" onClick={reset}>
        Intentar de nuevo
      </Button>
    </section>
  );
}
