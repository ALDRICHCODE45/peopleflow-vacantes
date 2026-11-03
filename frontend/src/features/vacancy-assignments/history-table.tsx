"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, History } from "lucide-react";
import { RichDataTable, type RichColumnDef } from "@/components/data-table/rich-data-table";
import { cn } from "@/lib/utils";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { plural } from "@/features/employer-vacancies/plural";
import { InfoPopover } from "@/features/psychometrics/help/info-popover";
import { formatDate, functionLabel } from "@/features/vacancy-team/model";
import type { Assignment } from "./client";

const META = "text-[12.5px] text-muted-foreground";
// This page wraps rather than measuring overflow. In the old nowrap/items-start
// layout, swapping measured text for a tooltip trigger could change its width and
// toggle overflow again. No measured branch or tooltip is needed for wrapping copy.
function WrappingText({ text, className }: { text: string; className?: string }) {
  return <span className={cn("block min-w-0 max-w-full whitespace-normal break-words", className)}>{text}</span>;
}
function WrappingCell({ primary, secondary }: { primary: string; secondary: string }) {
  return <div className="flex min-w-0 max-w-full flex-col gap-1"><WrappingText text={primary} className="text-sm font-medium text-foreground" /><WrappingText text={secondary} className={META} /></div>;
}
const endReason = { reassigned: "Te reasignaron", left: "Saliste de la vacante", removed: "Te quitaron del equipo", membership_ended: "Dejaste la empresa" };
const publication = { draft: "Borrador", published: "Publicada", paused: "Pausada", closed: "Cerrada" };
const results = {
  on_time: { label: "A tiempo", variant: "success" }, late: { label: "Tarde", variant: "danger" }, pending: { label: "En curso", variant: "info" },
  unfinished: { label: "Sin terminar", variant: "neutral" }, not_applicable: { label: "No aplica", variant: "neutral" }, none: { label: "Sin plazo", variant: "neutral" },
} as const;
function period(item: Assignment) {
  const start = formatDate(item.started_at);
  if (!item.ended_at) return `Desde el ${start}`;
  const end = formatDate(item.ended_at);
  const [day, ...rest] = start.split(" ");
  return `Del ${rest.join(" ") === end.split(" ").slice(1).join(" ") ? day : start} al ${end}`;
}
function DeadlineHelp() {
  return <InfoPopover accessibleName="Ayuda: Plazo" title="Qué significa «a tiempo»" description="La meta de entrega es del equipo: se mide si la vacante cumplió su entrega mientras estabas en ella, en la fecha del plazo o antes. Cumplir el mismo día cuenta como a tiempo; salir ese día sin cumplir queda como «Sin terminar», no como «Tarde»." footer="Los plazos se cuentan en días hábiles de la Ciudad de México." />;
}
function Identity({ item }: { item: Assignment }) {
  const title = item.vacancy_title ?? "Sin título";
  return <div className="flex min-w-0 items-start gap-3"><Avatar aria-hidden="true" size="lg"><AvatarFallback>{title.split(/\s+/u).slice(0, 2).map(word => word.charAt(0)).join("").toUpperCase()}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><WrappingText text={title} className="line-clamp-2 text-[14.5px] font-semibold text-foreground" />{item.requester && <WrappingText text={`${item.requester.kind === "client" ? "Cliente" : "Área"} · ${item.requester.name}`} className={META} />}</div></div>;
}
function FunctionCell({ item }: { item: Assignment }) {
  const functions = [...item.functions].sort((a, b) => a.started_at.localeCompare(b.started_at));
  const latest = functions.at(-1)!.function;
  const previous = [...new Set(functions.slice(0, -1).map(entry => entry.function))].filter(value => value !== latest);
  return <div className="flex min-w-0 w-full flex-col items-start gap-1"><Badge variant={latest === "responsible" ? "accent" : "secondary"}>{functionLabel[latest]}</Badge>{previous.length > 0 && <WrappingText text={`antes ${previous.map(value => functionLabel[value]).join(", ")}`} className={META} />}</div>;
}
function Deadline({ item }: { item: Assignment }) {
  const result = results[item.deadline_result];
  const delta = item.deadline_delta_business_days;
  const difference = delta === null ? null : item.deadline_result === "pending" ? `${delta === 1 ? "falta" : "faltan"} ${plural(delta, "día", "días")}` : `${plural(Math.abs(delta), "día", "días")} ${delta < 0 ? "tarde" : "antes"}`;
  if (item.deadline_result === "none") return <Badge variant={result.variant}>{result.label}</Badge>;
  return <div className="flex min-w-0 max-w-full flex-col gap-1"><div className="flex min-w-0 flex-wrap items-center gap-2">{item.effective_deadline && <WrappingText text={formatDate(item.effective_deadline)} className="text-sm font-medium" />}<Badge variant={result.variant}>{result.label}</Badge></div>{difference && <WrappingText text={difference} className={META} />}</div>;
}
function Deliveries({ item }: { item: Assignment }) {
  return <div className="flex min-w-0 max-w-full flex-col gap-1 whitespace-normal break-words tabular-nums"><span className={item.delivered_in_tramo ? "text-sm font-medium" : META}>{item.delivered_in_tramo === 0 ? "Sin entregas" : item.delivery_target !== null ? `${item.delivered_in_tramo} de ${item.delivery_target}` : plural(item.delivered_in_tramo, "entregado", "entregados")}</span>{item.delivery_target !== null && <Progress aria-label="Entregas frente a la meta de la vacante" value={item.delivery_target > 0 ? Math.min(100, item.delivered_in_tramo / item.delivery_target * 100) : 0} className="w-full [&_[data-slot=progress-track]]:h-1" />}</div>;
}
function Placements({ item, mobile = false }: { item: Assignment; mobile?: boolean }) {
  const { direct, shared, participant } = item.placements;
  const primary = [direct ? plural(direct, "directo", "directos") : null, shared ? plural(shared, "compartido", "compartidos") : null].filter(Boolean).join(" · ");
  return <div className="flex min-w-0 flex-col gap-1 tabular-nums">{primary ? <WrappingText text={primary} className="text-sm font-medium" /> : !participant && !mobile ? <span className={META}>—</span> : null}{participant > 0 && <WrappingText text={`participaste en ${participant}`} className={META} />}</div>;
}
function OpenVacancy({ item }: { item: Assignment }) {
  return item.draft_id !== null ? <Link className={buttonVariants({ variant: "ghost", size: "sm", className: "min-h-10" })} href={`/empresa/vacantes/${encodeURIComponent(item.draft_id)}/pipeline`}>Abrir vacante<ArrowUpRight data-icon="inline-end" aria-hidden="true" /></Link> : null;
}
type Row = { id: string; item: Assignment | null };
const definitions: { id: string; label: string; size: number; render: (item: Assignment) => ReactNode }[] = [
  { id: "vacancy", label: "Vacante", size: 230, render: item => <Identity item={item} /> },
  { id: "function", label: "Tu función", size: 140, render: item => <FunctionCell item={item} /> },
  { id: "period", label: "Periodo", size: 170, render: item => <WrappingCell primary={period(item)} secondary={plural(item.business_days_in_tramo, "día hábil", "días hábiles")} /> },
  { id: "status", label: "Estado", size: 145, render: item => <WrappingCell primary={item.end_cause ? endReason[item.end_cause] : "En la vacante"} secondary={`${publication[item.vacancy_status.publication]}${item.vacancy_status.process === "finished" ? " · proceso terminado" : ""}`} /> },
  { id: "deadline", label: "Plazo", size: 180, render: item => <Deadline item={item} /> },
  { id: "deliveries", label: "Entregas", size: 120, render: item => <Deliveries item={item} /> },
  { id: "placements", label: "Placements", size: 155, render: item => <Placements item={item} /> },
  { id: "action", label: "Acción", size: 140, render: item => <OpenVacancy item={item} /> },
];
const columns: RichColumnDef<Row>[] = definitions.map(definition => ({ id: definition.id, size: definition.size,
  meta: { label: definition.label, grow: definition.id === "vacancy" },
  ...(definition.id === "action" ? { enableHiding: false, enableReorder: false, enablePinning: false } : {}),
  ...(definition.id === "deadline" ? { header: () => <div className="flex items-center gap-1"><span>Plazo</span><DeadlineHelp /></div> } : {}),
  cell: ({ row }) => row.original.item ? definition.render(row.original.item) : <div aria-hidden="true" className="flex gap-3">{definition.id === "vacancy" && <Skeleton className="size-10 shrink-0 rounded-full" />}<div className="flex flex-1 flex-col gap-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-full" /></div></div>,
}));
const pinning = { start: ["vacancy"], end: ["action"] };

/** Uses the canonical §26 table; Equipo identity and spacing are kept without changing shared primitives. */
export function HistoryTable({ items, loading, footer }: { items: Assignment[]; loading: boolean; footer: ReactNode }) {
  const [section, setSection] = useState("now");
  useEffect(() => {
    const sync = () => setSection(new URLSearchParams(window.location.search).get("period") === "before" ? "before" : "now");
    sync(); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync);
  }, []);
  const rows: Row[] = loading ? [0, 1, 2].map(index => ({ id: String(index), item: null })) : items.map((item, index) => ({ id: String(index), item })).filter(row => section === "now" ? !row.item.ended_at : !!row.item.ended_at);
  const empty = <SectionEmpty icon={History} tone="empty" title={section === "now" ? "No estás en ninguna vacante" : "Todavía no hay vacantes anteriores"} description={section === "now" ? "Cuando te sumen al equipo de una vacante, aparecerá aquí." : "Aquí verás las vacantes en las que ya terminaste de trabajar, con lo que aportaste en cada una."} />;
  return <Tabs className="min-w-0" value={section} onValueChange={value => { const next = String(value); setSection(next); const url = new URL(window.location.href); url.searchParams.set("period", next); window.history.replaceState(null, "", url); }}>
    <TabsList aria-label="Periodo de tus vacantes"><TabsTrigger value="now">Ahora</TabsTrigger><TabsTrigger value="before">Antes</TabsTrigger></TabsList>
    <TabsContent value={section} className="flex min-w-0 flex-col gap-3">
      <Card data-history-desktop="" className="hidden min-w-0 md:block"><CardHeader className="sr-only"><CardTitle><h2>Tu trabajo en vacantes</h2></CardTitle></CardHeader><CardContent className="-mx-(--card-spacing) min-w-0">
        <div data-history-layout="" className="min-w-0 [&_[data-slot=table-head]]:text-[12px] [&_[data-slot=table-head]]:font-semibold [&_[data-slot=table-head]]:tracking-wide [&_[data-slot=table-head]]:uppercase [&_tbody_tr]:h-auto [&_td]:min-w-0 [&_td]:px-3 [&_td]:py-4 [&_td]:whitespace-normal [&_td]:break-words [&_td[data-column-id=action]]:px-1 [&_th]:px-3 [&_th]:py-3">
          <RichDataTable id="own-vacancy-history" columns={columns} data={rows} getRowId={row => row.id} defaultPinning={pinning} emptyState={empty} toolbar={controls => <div className="px-5">{controls}</div>} />
        </div>
      </CardContent></Card>
      <div className="md:hidden">{!rows.length ? <Card><CardContent>{empty}</CardContent></Card> : <ul aria-label="Vacantes en tarjetas" className="flex flex-col gap-3 md:hidden">{rows.map(row => <li key={row.id}><Card size="sm"><CardHeader><CardTitle>{row.item ? <Identity item={row.item} /> : <Skeleton className="h-10 w-full" />}</CardTitle></CardHeader>{/* Two columns even on phones: six stacked blocks made each card a whole screen (browser review). */}<CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">{row.item ? definitions.slice(1, -1).filter(definition => definition.id !== "placements" || Object.values(row.item!.placements).some(Boolean)).map(definition => <div key={definition.id} className="min-w-0"><div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><span>{definition.label}</span>{definition.id === "deadline" && <DeadlineHelp />}</div>{definition.id === "placements" ? <Placements item={row.item!} mobile /> : definition.render(row.item!)}</div>) : definitions.slice(1, -1).map(definition => <div key={definition.id} className="flex flex-col gap-2"><Skeleton className="h-5 w-24" /><Skeleton className="h-4 w-full" /></div>)}</CardContent>{row.item?.draft_id !== null && row.item && <CardFooter className="border-t"><OpenVacancy item={row.item} /></CardFooter>}</Card></li>)}</ul>}</div>
      {footer && <div className="border-t border-border pt-4">{footer}</div>}
    </TabsContent>
  </Tabs>;
}
