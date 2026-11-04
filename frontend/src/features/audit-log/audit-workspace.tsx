"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Info, ScrollText, SearchX, ShieldCheck, TriangleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionStatus } from "@/components/feedback/action-status";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AuditFiltersBar } from "./audit-filters";
import { AuditRestricted } from "./audit-restricted";
import { AuditTable, AuditTableSkeleton } from "./audit-table";
import { ExportAuditButton } from "./export-button";
import { listFailureMessage, type AuditFailure } from "./model";
import { useAuditEvents, useAuditOptions } from "./use-audit-events";

const SESSION_NOTE = "«Cerró sesión» significa que la persona hizo clic en cerrar sesión. Las sesiones que terminan por expiración o al cerrar la pestaña no se registran.";
const number = new Intl.NumberFormat("es-MX");

/** Page heading with the talent base's hierarchy (eyebrow, title, one-line description); the shell header owns the H1. */
function AuditHeading() {
  return <header className="flex flex-col gap-2">
    <p className="flex items-center gap-2 text-xs tracking-widest text-muted-foreground">
      <span className="size-1.5 rounded-xs bg-primary" aria-hidden="true" />
      TRAZABILIDAD DE TU EMPRESA
    </p>
    <h2 className="font-heading text-2xl font-semibold tracking-tight text-balance">Registro de actividad</h2>
    <p className="max-w-prose text-sm text-muted-foreground">Quién hizo qué en tu empresa, cuándo y desde dónde. Los registros no se pueden editar.</p>
  </header>;
}

function FailureCard({ failure, onRetry, onClear }: { failure: AuditFailure; onRetry: () => void; onClear: () => void }) {
  const description = listFailureMessage(failure);
  if (failure.reason === "forbidden") return <AuditRestricted />;
  if (failure.reason === "unauthenticated") return <StateCard icon={TriangleAlert} tone="error" title="Tu sesión terminó" description={description} primaryAction={{ label: "Iniciar sesión", href: "/empresa/login" }} />;
  if (failure.reason === "invalid_filter") return <StateCard icon={SearchX} tone="error" title="No pudimos aplicar los filtros" description={description} primaryAction={{ label: "Limpiar filtros", onClick: onClear }} />;
  return <StateCard icon={TriangleAlert} tone="error" title="No pudimos cargar la auditoría" description={description} primaryAction={{ label: "Reintentar", onClick: onRetry }} />;
}

/** Owner-only audit screen (contract §8): filters in the URL, newest first, cursor pagination and export. */
export function AuditWorkspace() {
  const audit = useAuditEvents();
  const options = useAuditOptions();
  const { filters, loaded, failure, moreFailure, loadingMore, notice } = audit;
  const [tableToolbar, setTableToolbar] = useState<HTMLDivElement | null>(null);
  const clear = () => audit.update({});
  const filtered = Object.keys(filters).length > 0;
  const initial = !loaded && !failure;
  const noun = loaded?.total === 1 ? "evento" : "eventos";

  const content = failure ? <div className="px-(--card-spacing)"><FailureCard failure={failure} onRetry={audit.retry} onClear={clear} /></div>
    : !loaded ? <AuditTableSkeleton />
    : loaded.items.length === 0 ? <div className="px-(--card-spacing)">{filtered
      ? <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados" description="No hay actividad registrada con estos filtros. Prueba con otro rango de fechas o limpia los filtros." primaryAction={{ label: "Limpiar filtros", onClick: clear }} />
      : <SectionEmpty icon={ScrollText} tone="empty" title="Todavía no hay actividad registrada" description="Aquí aparecerá quién hizo qué en tu empresa: sesiones, consultas de candidatos, descargas de CV y cambios del equipo." />}</div>
    : <AuditTable items={loaded.items} toolbar={controls => tableToolbar ? createPortal(controls, tableToolbar) : null} />;

  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    <AuditHeading />
    <Card role="region" aria-label="Registro de actividad" aria-busy={initial} className="min-w-0 pt-0">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <p className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Solo el owner
        </p>
      </div>
      <CardHeader className="gap-4">
        <CardTitle className="sr-only"><h3>Eventos registrados</h3></CardTitle>
        <AuditFiltersBar filters={filters} options={options.status === "ready" ? options.options : null} optionsFailed={options.status === "error"} onRetryOptions={options.retry} onChange={patch => audit.update({ ...filters, ...patch })} onClear={clear}
          actions={<><div ref={setTableToolbar} /><ExportAuditButton filters={filters} /></>} />
        <CardDescription className="text-xs"><span role="status" aria-live="polite" aria-label={initial ? "Cargando auditoría" : undefined}>{initial ? <Skeleton aria-hidden="true" className="h-4 w-52" /> : loaded ? <><strong className="font-medium text-foreground">{number.format(loaded.total)}</strong> {noun} registrados en tu empresa</> : null}</span></CardDescription>
      </CardHeader>
      <CardContent className="-mx-(--card-spacing) -mb-(--card-spacing)">
        <div className="flex min-w-0 flex-col gap-4">
          {notice && <div className="px-(--card-spacing)"><ActionStatus id="audit-notice" tone="info" text={notice} /></div>}
          {content}
          {moreFailure && <div className="px-(--card-spacing)"><ActionStatus id="audit-more-failure" tone="error" text={listFailureMessage(moreFailure)} /></div>}
          <div className="px-(--card-spacing) pb-(--card-spacing)">
            <div data-testid="audit-session-note" className="flex items-start gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <p>{SESSION_NOTE}</p>
            </div>
          </div>
        </div>
      </CardContent>
      {loaded && loaded.items.length > 0 && <CardFooter className="flex flex-wrap justify-between gap-3 border-t">
        <span className="text-xs text-muted-foreground" role="status">{`Mostrando ${loaded.items.length} de ${loaded.total} ${noun}`}</span>
        {loaded.nextCursor && <Button type="button" variant="outline" className="min-h-10" disabled={loadingMore} onClick={() => void audit.loadMore()}>
          {loadingMore && <Spinner aria-hidden="true" data-icon="inline-start" />}Cargar más
        </Button>}
      </CardFooter>}
    </Card>
  </DashboardPageContent>;
}
