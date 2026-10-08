import * as React from "react";
import { createRoot } from "react-dom/client";
import { sileo } from "sileo";
import { AppToaster } from "../../../src/components/feedback/app-toaster";
import { Button } from "../../../src/components/ui/button";
import { Skeleton } from "../../../src/components/ui/skeleton";
import { Spinner } from "../../../src/components/ui/spinner";
import "../../../src/app/globals.css";

// Browser-only verification fixture, never a product route or a persistence claim.
function FeedbackFixture() {
  return (
    <main className="flex min-h-dvh flex-col gap-6 bg-background p-6 text-foreground">
      <h1>Verificación de notificaciones</h1>
      <Button onClick={() => sileo.success({
        title: "Prueba confirmada",
        description: "Este mensaje pertenece a una prueba de interfaz.",
        duration: 60000,
      })}>Mostrar notificación de prueba</Button>
      <Button onClick={() => {
        sileo.clear();
        sileo.error({ title: "Error de prueba", description: "Revisa los datos e inténtalo de nuevo.", duration: 60000 });
      }}>Mostrar error de prueba</Button>
      <section aria-busy="true" aria-label="Contenido pendiente" className="flex flex-col gap-3">
        <span role="status" className="sr-only">Cargando contenido</span>
        <Skeleton aria-hidden="true" className="h-6 w-40" />
        <Skeleton aria-hidden="true" className="h-20 w-full" />
      </section>
      <Spinner aria-label="Procesando prueba" />
      <AppToaster />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<FeedbackFixture />);
