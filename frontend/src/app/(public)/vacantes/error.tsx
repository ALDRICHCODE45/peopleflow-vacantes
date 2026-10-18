"use client";

import { CircleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function VacantesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Empty role="alert">
    <EmptyHeader>
      <EmptyMedia variant="icon"><CircleAlertIcon aria-hidden="true" /></EmptyMedia>
      <EmptyTitle><h1>No se pudieron cargar las vacantes</h1></EmptyTitle>
      <EmptyDescription>No se mostró ninguna vacante. Vuelve a intentarlo; si el problema sigue, prueba de nuevo en unos minutos.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent><Button type="button" onClick={reset} className="min-h-10">Intentar de nuevo</Button></EmptyContent>
  </Empty>;
}
