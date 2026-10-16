"use client";

import Link from "next/link";
import { CircleAlertIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

export default function VacanteDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Empty role="alert">
    <EmptyHeader>
      <EmptyMedia variant="icon"><CircleAlertIcon aria-hidden="true" /></EmptyMedia>
      <EmptyTitle><h1>No se pudo cargar la vacante</h1></EmptyTitle>
      <EmptyDescription>El servicio de vacantes no respondió correctamente. Puedes reintentar la carga.</EmptyDescription>
    </EmptyHeader>
    <EmptyContent>
      <Button type="button" onClick={reset} className="min-h-10">Intentar de nuevo</Button>
      <Link href="/vacantes" className={cn(buttonVariants({ variant: "ghost" }), "min-h-10")}>Volver a vacantes</Link>
    </EmptyContent>
  </Empty>;
}
