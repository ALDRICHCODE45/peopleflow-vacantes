import * as React from "react";
import Link from "next/link";

// Branded not-found state for the detail route: rendered for malformed job IDs
// (rejected before any API access) and backend 404s alike. Retryable service
// failures never land here; they use the route error boundary instead.
export default function VacanteDetailNotFound() {
  return (
    <section className="flex flex-col items-start gap-3 py-6">
      <h2 className="font-heading text-xl font-medium text-foreground">
        Esta vacante no está disponible
      </h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        La vacante que buscas no existe o ya no está publicada. Explora otras
        vacantes disponibles.
      </p>
      <Link
        href="/vacantes"
        className="text-sm font-medium text-primary underline-offset-4 transition-colors hover:underline"
      >
        Volver a vacantes
      </Link>
    </section>
  );
}
