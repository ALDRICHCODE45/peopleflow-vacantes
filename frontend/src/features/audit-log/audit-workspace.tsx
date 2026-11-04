"use client";
import { SearchX, ScrollText, TriangleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionStatus } from "@/components/feedback/action-status";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { AuditFiltersBar } from "./audit-filters";
import { AuditRestricted } from "./audit-restricted";
import { AuditTable } from "./audit-table";
import { ExportAuditButton } from "./export-button";
import { listFailureMessage, type AuditFailure } from "./model";
import { useAuditEvents, useAuditOptions } from "./use-audit-events";

const SESSION_NOTE = "«Cerró sesión» significa que la persona hizo clic en cerrar sesión. Las sesiones que terminan por expiración o al cerrar la pestaña no se registran.";

function LoadingRows() {
  return <div role="status" aria-label="Cargando auditoría" aria-busy="true" className="flex flex-col gap-2 px-(--card-spacing)">
    {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} aria-hidden="true" className="h-12 w-full" />)}
  </div>;
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
  const clear = () => audit.update({});
  const filtered = Object.keys(filters).length > 0;

  const content = failure ? <div className="px-(--card-spacing)"><FailureCard failure={failure} onRetry={audit.retry} onClear={clear} /></div>
    : !loaded ? <LoadingRows />
    : loaded.items.length === 0 ? <div className="px-(--card-spacing)">{filtered
      ? <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados" description="No hay actividad registrada con estos filtros. Prueba con otro rango de fechas o limpia los filtros." primaryAction={{ label: "Limpiar filtros", onClick: clear }} />
      : <SectionEmpty icon={ScrollText} tone="empty" title="Todavía no hay actividad registrada" description="Aquí aparecerá quién hizo qué en tu empresa: sesiones, consultas de candidatos, descargas de CV y cambios del equipo." />}</div>
    : <AuditTable items={loaded.items} />;

  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    <Card aria-label="Registro de actividad" aria-busy={!loaded && !failure} className="min-w-0">
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle><h2 className="text-xl font-semibold">Registro de actividad</h2></CardTitle>
            <CardDescription>Quién hizo qué en tu empresa, cuándo y desde dónde. Solo el owner puede verlo y los registros no se pueden editar.</CardDescription>
            <p data-testid="audit-session-note" className="text-xs text-muted-foreground">{SESSION_NOTE}</p>
          </div>
          <ExportAuditButton filters={filters} />
        </div>
        <AuditFiltersBar filters={filters} options={options.status === "ready" ? options.options : null} optionsFailed={options.status === "error"} onRetryOptions={options.retry} onChange={patch => audit.update({ ...filters, ...patch })} onClear={clear} />
        {notice && <ActionStatus id="audit-notice" tone="info" text={notice} />}
      </CardHeader>
      <CardContent className="-mx-(--card-spacing) -mb-(--card-spacing)">
        <div className="flex min-w-0 flex-col gap-4">
          {content}
          {moreFailure && <p className="px-(--card-spacing) text-sm text-destructive">{listFailureMessage(moreFailure)}</p>}
        </div>
      </CardContent>
      {loaded && loaded.items.length > 0 && <CardFooter className="flex flex-wrap justify-between gap-3 border-t">
        <span className="text-xs text-muted-foreground" role="status">{`Mostrando ${loaded.items.length} de ${loaded.total} ${loaded.total === 1 ? "evento" : "eventos"}`}</span>
        {loaded.nextCursor && <Button type="button" variant="outline" className="min-h-10" disabled={loadingMore} onClick={() => void audit.loadMore()}>
          {loadingMore && <Spinner aria-hidden="true" data-icon="inline-start" />}Cargar más
        </Button>}
      </CardFooter>}
    </Card>
  </DashboardPageContent>;
}
