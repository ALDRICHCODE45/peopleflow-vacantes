"use client";

import { CircleAlert, CloudCheck, Lock } from "lucide-react";
import { StateCard } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { autosaveLabel, type AutosaveStatus } from "../autosave";

export function SaveStatus({ status, dirty, onLoadLatest }: { status: AutosaveStatus; dirty: boolean; onLoadLatest: () => void }) {
  const label = status.kind === "saving" ? "Guardando…" : status.kind === "offline" ? "Sin conexión — reintentaremos" : status.kind === "conflict" ? "Otra persona editó el sitio" : status.kind === "invalid" ? "Revisa los campos marcados" : status.kind === "error" ? autosaveLabel(status) : dirty ? "Cambios pendientes" : status.kind === "saved" ? "Cambios guardados" : "Sin cambios pendientes";
  const Icon = status.kind === "saving" ? Spinner : ["offline", "conflict", "invalid", "error"].includes(status.kind) ? CircleAlert : CloudCheck;
  return <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1">
    <p role="status" aria-label="Estado del guardado" aria-live="polite" aria-atomic="true" className="flex items-center gap-2 text-sm text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0" />{label}</p>
    {status.kind === "offline" && <span className="text-xs text-muted-foreground">Al reconectar o hacer otro cambio.</span>}
    {status.kind === "conflict" && <Button variant="link" className="min-h-10" onClick={onLoadLatest}>Cargar la versión más reciente</Button>}
  </div>;
}
export function CareersSiteEditorLoading() {
  return <div aria-busy="true" className="flex min-w-0 flex-col gap-5">
    <p role="status" className="sr-only">Cargando editor</p>
    <div data-editor-region="toolbar" aria-hidden="true" className="flex flex-wrap items-center justify-between gap-4"><div className="flex flex-col gap-2"><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64" /></div><Skeleton className="h-10 w-60" /></div>
    <div aria-hidden="true" className="grid min-w-0 gap-0 lg:grid-cols-[17.5rem_minmax(0,1fr)_18.75rem]">
      <div data-editor-region="sections" className="hidden flex-col gap-4 p-1 lg:flex"><Skeleton className="h-9 w-full" /><Skeleton className="h-5 w-32" />{Array.from({ length: 13 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      <div data-editor-region="preview" className="flex min-w-0 flex-col gap-6 bg-muted p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-16 w-3/4" /><Skeleton className="h-6 w-full" /><Skeleton className="h-64 w-full" /><Skeleton className="h-24 w-full" /></div>
      <div data-editor-region="properties" className="hidden flex-col gap-6 p-3 lg:flex"><Skeleton className="h-5 w-36" /><div className="grid grid-cols-2 gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div><Skeleton className="h-32 w-full" /></div>
    </div>
    <div aria-hidden="true" className="flex gap-2 text-xs text-muted-foreground"><Lock className="size-4" /><Skeleton className="h-4 w-64" /></div>
  </div>;
}
export function CareersSiteEditorError({ onRetry }: { onRetry: () => void }) {
  return <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar el editor" description="Tu borrador no cambió. Vuelve a intentarlo para continuar editando." primaryAction={{ label: "Reintentar", onClick: onRetry }} />;
}
