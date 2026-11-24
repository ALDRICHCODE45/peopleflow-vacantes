"use client";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ChevronsLeft, Info, ScrollText, SearchX, ShieldCheck, TriangleAlert } from "lucide-react";
import { DashboardPageContent } from "@/components/dashboard-page-content";
import { ActionStatus } from "@/components/feedback/action-status";
import { SectionEmpty, StateCard } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AuditEventList, AuditEventListSkeleton } from "./audit-cards";
import { AuditEventSheet } from "./audit-detail";
import { AuditFiltersBar } from "./audit-filters";
import { AuditRestricted } from "./audit-restricted";
import { AuditTable, AuditTableSkeleton } from "./audit-table";
import { ExportAuditButton } from "./export-button";
import { listFailureMessage, type AuditEvent, type AuditFailure } from "./model";
import { usePhone } from "./use-phone";
import { PAGE_SIZES, useAuditEvents, useAuditOptions } from "./use-audit-events";

const SESSION_NOTE = "«Cerró sesión» significa que la persona hizo clic en cerrar sesión. Las sesiones que terminan por expiración o al cerrar la pestaña no se registran.";
const number = new Intl.NumberFormat("es-MX");

/** Page heading (artboard `audit-log-redesign/01`): title with «Solo el dueño» beside it, one description line and the export at the end; the shell header owns the H1. */
function AuditHeading({ export: exportButton }: { export: ReactNode }) {
  return <header data-audit-header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
    <div className="flex min-w-0 flex-col gap-1.5">
      <div data-audit-title-row className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-heading text-2xl font-semibold tracking-tight text-balance">Registro de actividad</h2>
        <Badge variant="neutral"><ShieldCheck aria-hidden="true" data-icon="inline-start" />Solo el dueño</Badge>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground max-sm:hidden">Quién hizo qué en tu empresa, cuándo y desde dónde. Los registros no se pueden editar.</p>
    </div>
    {exportButton}
  </header>;
}

/** What is and is not recorded, on demand (system «On-demand help»): the sessions note lives here instead of a permanent block. */
function RecordedHelp() {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label="¿Qué se registra?"><Info aria-hidden="true" /></Button>} />
    <PopoverContent align="end" aria-label="Qué se registra" className="w-[min(320px,calc(100vw-2rem))]">
      <p data-testid="audit-session-note" className="text-sm text-muted-foreground">{SESSION_NOTE}</p>
      <p className="text-sm text-muted-foreground">Los registros no se pueden editar. Las fechas y horas son de la Ciudad de México.</p>
    </PopoverContent>
  </Popover>;
}

function FailureCard({ failure, onRetry, onClear }: { failure: AuditFailure; onRetry: () => void; onClear: () => void }) {
  const description = listFailureMessage(failure);
  if (failure.reason === "forbidden") return <AuditRestricted />;
  if (failure.reason === "unauthenticated") return <StateCard icon={TriangleAlert} tone="error" title="Tu sesión terminó" description={description} primaryAction={{ label: "Iniciar sesión", href: "/empresa/login" }} />;
  if (failure.reason === "invalid_filter") return <StateCard icon={SearchX} tone="error" title="No pudimos aplicar los filtros" description={description} primaryAction={{ label: "Limpiar filtros", onClick: onClear }} />;
  return <StateCard icon={TriangleAlert} tone="error" title="No pudimos cargar la auditoría" description={description} primaryAction={{ label: "Reintentar", onClick: onRetry }} />;
}

/** Same controls and copy as the dashboard table, without «última página»: a cursor only knows the next page. */
function AuditPagination({ audit, phone }: { audit: ReturnType<typeof useAuditEvents>; phone: boolean }) {
  const { page, pageCount, pageSize, paging, loaded } = audit;
  return <nav aria-label="Paginación" className="flex w-full items-center gap-6 sm:w-fit sm:gap-8">
    {!phone && <div className="flex items-center gap-2">
      <Label htmlFor="audit-rows-per-page" className="text-sm font-medium">Filas por página</Label>
      <Select value={`${pageSize}`} disabled={paging} onValueChange={(value: string | null) => { if (value !== null) audit.changePageSize(Number(value)); }} items={PAGE_SIZES.map(size => ({ label: `${size}`, value: `${size}` }))}>
        <SelectTrigger size="sm" className="w-20" id="audit-rows-per-page"><SelectValue placeholder={pageSize} /></SelectTrigger>
        <SelectContent side="top"><SelectGroup>{PAGE_SIZES.map(size => <SelectItem key={size} value={`${size}`}>{size}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </div>}
    <div className="flex w-fit items-center justify-center text-sm font-medium">{`Página ${page} de ${pageCount}`}</div>
    <div className="ml-auto flex items-center gap-2 sm:ml-0">
      <Button type="button" variant="outline" className="size-8" size="icon" onClick={audit.first} disabled={paging || page === 1}><span className="sr-only">Ir a la primera página</span><ChevronsLeft aria-hidden="true" /></Button>
      <Button type="button" variant="outline" className="size-8" size="icon" onClick={audit.previous} disabled={paging || page === 1}><span className="sr-only">Ir a la página anterior</span><ChevronLeft aria-hidden="true" /></Button>
      <Button type="button" variant="outline" className="size-8" size="icon" onClick={audit.next} disabled={paging || !loaded?.nextCursor}><span className="sr-only">Ir a la página siguiente</span><ChevronRight aria-hidden="true" /></Button>
    </div>
  </nav>;
}

/** Owner-only audit screen (contract §8): filters in the URL, newest first, cursor pagination and export. */
export function AuditWorkspace() {
  const audit = useAuditEvents();
  const phone = usePhone();
  const options = useAuditOptions();
  const { filters, loaded, failure, pageFailure, paging, notice, page, pageSize } = audit;
  const [tableToolbar, setTableToolbar] = useState<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const clear = () => audit.update({});
  const filtered = Object.keys(filters).length > 0;
  const initial = !loaded && !failure;
  const noun = loaded?.total === 1 ? "evento" : "eventos";
  const firstRow = (page - 1) * pageSize + 1;

  const content = failure ? <div className="px-(--card-spacing)"><FailureCard failure={failure} onRetry={audit.retry} onClear={clear} /></div>
    : !loaded ? (phone ? <AuditEventListSkeleton /> : <AuditTableSkeleton />)
    : loaded.items.length === 0 ? <div className="px-(--card-spacing)">{filtered
      ? <SectionEmpty icon={SearchX} tone="empty" title="Sin resultados" description="No hay actividad registrada con estos filtros. Prueba con otro rango de fechas o limpia los filtros." primaryAction={{ label: "Limpiar filtros", onClick: clear }} />
      : <SectionEmpty icon={ScrollText} tone="empty" title="Todavía no hay actividad registrada" description="Aquí aparecerá quién hizo qué en tu empresa: sesiones, consultas de candidatos, descargas de CV y cambios del equipo." />}</div>
    : phone ? (paging ? <AuditEventListSkeleton /> : <AuditEventList items={loaded.items} onOpen={setSelected} />)
    : <AuditTable items={loaded.items} loading={paging} onOpen={setSelected} toolbar={controls => tableToolbar ? createPortal(controls, tableToolbar) : null} />;

  const ready = options.status === "ready" ? options.options : null;
  return <DashboardPageContent width="screen-2xl" className="min-w-0 gap-5 md:gap-6">
    <AuditHeading export={<ExportAuditButton filters={filters} options={ready} phone={phone} />} />
    <Card role="region" aria-label="Registro de actividad" aria-busy={initial || paging} className="min-w-0">
      <CardHeader className="gap-3">
        <CardTitle className="sr-only"><h3>Eventos registrados</h3></CardTitle>
        <AuditFiltersBar filters={filters} options={ready} optionsFailed={options.status === "error"} onRetryOptions={options.retry} onChange={patch => audit.update({ ...filters, ...patch })} onClear={clear}
          phone={phone} total={loaded?.total} actions={phone ? undefined : <div ref={setTableToolbar} />} />
        <CardDescription className="-mb-2 flex min-h-10 flex-wrap items-center justify-between gap-2 text-xs">
          <span role="status" aria-live="polite" aria-label={initial ? "Cargando auditoría" : undefined}>{initial ? <Skeleton aria-hidden="true" className="h-4 w-52" /> : loaded ? <><strong className="font-medium text-foreground">{number.format(loaded.total)}</strong> {noun} {filtered ? "con estos filtros" : "registrados en tu empresa"} <span aria-hidden="true">·</span> Más recientes primero</> : null}</span>
          <RecordedHelp />
        </CardDescription>
      </CardHeader>
      <CardContent className="-mx-(--card-spacing) -mb-(--card-spacing)">
        <div className="flex min-w-0 flex-col gap-4">
          {notice && <div className="px-(--card-spacing)"><ActionStatus id="audit-notice" tone="info" text={notice} /></div>}
          {content}
          {pageFailure && <div className="px-(--card-spacing)"><ActionStatus id="audit-page-failure" tone="error" text={listFailureMessage(pageFailure)} action={<Button type="button" variant="link" className="min-h-10" onClick={audit.retryPage}>Reintentar</Button>} /></div>}
        </div>
      </CardContent>
      {loaded && loaded.items.length > 0 && <CardFooter className="flex flex-wrap justify-between gap-3 border-t">
        <span className="text-xs text-muted-foreground" role="status">{`Mostrando ${firstRow}–${firstRow + loaded.items.length - 1} de ${loaded.total} ${noun}`}</span>
        <AuditPagination audit={audit} phone={phone} />
      </CardFooter>}
    </Card>
    <AuditEventSheet event={selected} onClose={() => setSelected(null)} phone={phone} />
  </DashboardPageContent>;
}
