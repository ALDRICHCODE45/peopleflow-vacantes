import type { ReactNode } from "react";
import { CheckCheck, CircleAlert, FunnelX, Inbox, RefreshCw, type LucideIcon } from "lucide-react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Inbox states of design 07 (`ntSkeleton`, `stEmptyUnread`, `stFirstUse`, `stError`, `stNoResults`). */

export function InboxSkeleton() {
  return <div aria-busy="true">
    <span role="status" className="sr-only">Cargando notificaciones</span>
    <div aria-hidden="true">
      <div className="px-2.5 pt-2.5 pb-1"><Skeleton className="h-3 w-10" /></div>
      {["78%", "64%", "86%", "58%", "72%"].map((width, index) => <div key={width} className="grid grid-cols-[36px_1fr] gap-3 px-3.5 py-3">
        <Skeleton className="size-9 rounded-xl" />
        <div className="grid gap-2"><Skeleton className="h-3.5" style={{ width }} /><Skeleton className="h-3" style={{ width: ["40%", "52%", "34%", "46%", "38%"][index] }} /></div>
      </div>)}
    </div>
  </div>;
}

function State({ icon: Icon, tone, title, description, children, alert }: {
  icon: LucideIcon; tone: string; title: string; description?: string; children?: ReactNode; alert?: boolean;
}) {
  return <div role={alert ? "alert" : undefined} className="grid justify-items-center gap-2 px-6 py-10 text-center">
    <span aria-hidden="true" className={cn("mb-1 grid size-10 place-items-center rounded-[14px]", tone)}><Icon className="size-5" /></span>
    <h3 className="text-base font-semibold">{title}</h3>
    {description && <p className="max-w-[300px] text-sm text-muted-foreground">{description}</p>}
    {children && <div className="mt-2 flex flex-wrap justify-center gap-2">{children}</div>}
  </div>;
}

export function InboxUpToDate({ onShowAll }: { onShowAll: () => void }) {
  return <State icon={CheckCheck} tone="bg-primary/10 text-primary" title="Estás al día" description="No tienes notificaciones sin leer. Las anteriores siguen en «Todas».">
    <Button type="button" variant="outline" className="min-h-10" onClick={onShowAll}>Ver todas</Button>
  </State>;
}

/** No preferences action yet: `/empresa/configuracion/notificaciones` does not exist (stage 2). Candidate wording: design 04. */
export function InboxFirstUse({ candidate = false }: { candidate?: boolean }) {
  return <State icon={Inbox} tone="bg-primary/10 text-primary" title="Aún no tienes notificaciones"
    description={candidate
      ? "Aquí te avisaremos cuando una empresa cambie el estado de tu postulación, te escriba o te pida una prueba."
      : "Aquí llegan las postulaciones nuevas, las entregas por vencer, las vacantes que te asignan y las pruebas de tus candidatos."} />;
}

export function InboxError({ onRetry }: { onRetry: () => void }) {
  return <State alert icon={CircleAlert} tone="bg-destructive/10 text-status-danger" title="No pudimos cargar tus notificaciones." description="Revisa tu conexión e inténtalo de nuevo.">
    <Button type="button" variant="outline" className="min-h-10" onClick={onRetry}><RefreshCw aria-hidden="true" data-icon="inline-start" />Reintentar</Button>
  </State>;
}

/** Filters with no match: they stay, are named, and can be cleared. */
export function InboxNoResults({ description, onClear }: { description: string; onClear: () => void }) {
  return <State icon={FunnelX} tone="bg-muted text-muted-foreground" title="Sin resultados" description={description}>
    <Button type="button" variant="outline" className="min-h-10" onClick={onClear}>Limpiar filtros</Button>
  </State>;
}
