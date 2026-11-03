"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { BriefcaseBusiness, CircleAlert, History } from "lucide-react";
import { ActionBar } from "@/components/feedback/action-status";
import { StateCard, SectionEmpty } from "@/components/feedback/state-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { plural } from "@/features/employer-vacancies/plural";
import { formatDate, functionLabel } from "@/features/vacancy-team/model";
import { DraftEditErrorState } from "@/features/jobs/drafts/reopen/error-state";
import { AssignmentError, currentFirst, historySchema, placementsCount, readOverview, summarize, type Assignment, type AssignmentClient, type AssignmentHistoryPage, type Summary } from "./client";

const endReason = { reassigned: "Te reasignaron", left: "Saliste de la vacante", removed: "Te quitaron del equipo", membership_ended: "Dejaste la empresa" };
function period(item: Assignment) {
  const start = formatDate(item.started_at);
  if (!item.ended_at) return `Desde el ${start}`;
  const end = formatDate(item.ended_at);
  const [day, ...rest] = start.split(" ");
  return `Del ${rest.join(" ") === end.split(" ").slice(1).join(" ") ? day : start} al ${end}`;
}
function SummaryRow({ summary }: { summary: Summary | null }) {
  const cards = [
    { label: "Vacantes en las que trabajas ahora", value: summary?.current },
    { label: "Candidatos entregados", value: summary?.delivered },
    { label: "Placements", value: summary?.placements },
  ];
  return <section aria-label="Resumen de tu trabajo" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    {cards.map(card => <Card key={card.label} size="sm"><CardHeader>
      <CardTitle>{summary ? <h3 className="text-[22px] font-bold tabular-nums">{summary.incomplete ? "al menos " : ""}{card.value}</h3> : <Skeleton aria-hidden="true" className="h-7 w-10" />}</CardTitle>
      <CardDescription>{summary ? card.label : <Skeleton aria-hidden="true" className="h-5 w-24" />}</CardDescription>
    </CardHeader></Card>)}
  </section>;
}
function AssignmentRow({ item }: { item: Assignment | null }) {
  const functions = item ? [...item.functions].sort((a, b) => a.started_at.localeCompare(b.started_at)) : [];
  const latest = functions.at(-1)?.function;
  const previous = [...new Set(functions.slice(0, -1).map(entry => entry.function))].filter(value => value !== latest);
  const metadata = item ? [period(item), item.ended_at && item.end_cause ? endReason[item.end_cause] : null, previous.length ? `antes ${previous.map(value => functionLabel[value]).join(", ")}` : null].filter(Boolean).join(" · ") : "";
  const figures = item ? [item.delivered_in_tramo ? plural(item.delivered_in_tramo, "entregado", "entregados") : null, placementsCount(item) ? plural(placementsCount(item), "placement", "placements") : null, item.placements.participant ? `participaste en ${item.placements.participant}` : null].filter((value): value is string => value !== null) : [];
  // Keep the figures to two lines too, even when all three kinds are present.
  const figureLines = figures.length > 2 ? [figures.slice(0, 1), figures.slice(1)] : figures.map(value => [value]);
  // Below sm the figures move under the text (aligned with it) so the title keeps the width (§16 «Reorganizar en móvil»).
  return <Item role="listitem" className="flex-wrap items-start sm:flex-nowrap">
    <ItemMedia variant="icon" className={`size-9 rounded-full ${item?.ended_at ? "bg-muted text-muted-foreground" : "bg-status-success/10 text-status-success"}`}>
      {item ? <BriefcaseBusiness aria-hidden="true" className="size-4" /> : <Skeleton className="size-9 rounded-full" />}
    </ItemMedia>
    <ItemContent className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><ItemTitle className="min-w-0">{item ? <span className="break-words">{item.vacancy_title ?? "Sin título"}</span> : <Skeleton className="h-5 w-40" />}</ItemTitle>{latest ? <Badge variant={latest === "responsible" ? "accent" : "secondary"}>{functionLabel[latest]}</Badge> : <Skeleton className="h-5 w-24" />}</div>
      {/* ItemDescription renders p; its loading slot uses a div so Skeleton's div stays valid HTML. */}
      {item ? <ItemDescription>{metadata}</ItemDescription> : <div data-slot="item-description"><Skeleton className="h-5 w-56" /></div>}
    </ItemContent>
    <ItemActions className="flex-col items-end gap-1 self-start text-right text-sm tabular-nums max-sm:basis-full max-sm:flex-row max-sm:flex-wrap max-sm:items-start max-sm:gap-x-3 max-sm:pl-12 max-sm:text-left">
      {!item ? <><Skeleton className="h-5 w-24" /><Skeleton className="h-5 w-20" /></> : figureLines.length ? figureLines.map((line, index) => <div key={index} className="whitespace-nowrap">{line.map((figure, index) => <Fragment key={figure}>{index > 0 && " · "}<span>{figure}</span></Fragment>)}</div>) : <span className="whitespace-nowrap text-muted-foreground">Sin entregas</span>}
    </ItemActions>
  </Item>;
}
function Rows({ items, loading = false }: { items: Assignment[]; loading?: boolean }) {
  const ordered = currentFirst(items);
  const sections: { label: string; items: (Assignment | null)[] }[] = loading ? [{ label: "AHORA", items: [null, null, null] }] : [
    { label: "AHORA", items: ordered.filter(item => !item.ended_at) },
    { label: "ANTES", items: ordered.filter(item => !!item.ended_at) },
  ];
  return <div className="flex flex-col gap-5" aria-hidden={loading || undefined}>{sections.filter(section => section.items.length).map(section => <section key={section.label} aria-label={section.label}>
    <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.label}</h3>
    <ItemGroup className="gap-0">{section.items.map((item, index) => <Fragment key={item ? `${item.vacancy_title}:${item.started_at}:${index}` : index}>
      {index > 0 && <ItemSeparator className="my-0" />}<AssignmentRow item={item} />
    </Fragment>)}</ItemGroup>
  </section>)}</div>;
}

/** Read-only own history. The preview never grows when the Sheet loads more pages. */
export function AssignmentHistory({ client }: { client: AssignmentClient }) {
  const [loaded, setLoaded] = useState<{ first: AssignmentHistoryPage; summary: Summary } | null>(null);
  const [failure, setFailure] = useState(false);
  const [expired, setExpired] = useState(false);
  const summarized = useRef(new Set<string>());
  const [attempt, setAttempt] = useState(0);
  const [pages, setPages] = useState<AssignmentHistoryPage | null>(null);
  const [moreFailure, setMoreFailure] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const lifetime = useRef(0);
  const sheetTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const generation = ++lifetime.current;
    async function load() {
      try { return await readOverview(client); }
      catch (error) {
        if (error instanceof AssignmentError && error.code === "invalid_cursor") return readOverview(client);
        throw error;
      }
    }
    load().then(result => { if (generation === lifetime.current) { summarized.current = new Set(result.cursors); setLoaded(result); setPages(result.first); setFailure(false); setMoreFailure(false); } }).catch(error => { if (generation === lifetime.current) { if (error instanceof AssignmentError && error.status === 401) setExpired(true); else setFailure(true); } });
    return () => { lifetime.current = generation + 1; };
  }, [client, attempt]);
  async function more() {
    if (!pages?.next_cursor || busy.current) return;
    busy.current = true; setPending(true);
    const generation = lifetime.current;
    try {
      const next = historySchema.parse(await client.getHistory(pages.next_cursor));
      if (generation === lifetime.current) {
        if (!summarized.current.has(pages.next_cursor)) {
          summarized.current.add(pages.next_cursor);
          setLoaded(previous => previous ? { ...previous, summary: summarize(next.items, !!next.next_cursor, previous.summary) } : previous);
        }
        setPages(previous => previous ? { items: [...previous.items, ...next.items], next_cursor: next.next_cursor } : next); setMoreFailure(false);
      }
    } catch (error) {
      if (generation === lifetime.current) {
        if (error instanceof AssignmentError && error.status === 401) setExpired(true);
        else if (error instanceof AssignmentError && error.code === "invalid_cursor") { setLoaded(null); setPages(null); setAttempt(value => value + 1); }
        else setMoreFailure(true);
      }
    }
    finally { busy.current = false; if (generation === lifetime.current) setPending(false); }
  }
  if (expired) return <DraftEditErrorState reason="unauthenticated" />;
  if (failure) return <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar tu historial" description="Tu trabajo sigue a tu nombre. Puedes reintentar esta consulta sin cambiar datos." primaryAction={{ label: "Reintentar", onClick: () => { setFailure(false); setAttempt(value => value + 1); } }} />;
  const loading = !loaded;
  const hasMore = loaded && (loaded.first.items.length > 5 || !!loaded.first.next_cursor);
  return <div aria-busy={loading || undefined} className="flex flex-col gap-5">
    {loading && <span role="status" className="sr-only">Cargando tu historial</span>}
    <SummaryRow summary={loaded?.summary ?? null} />
    <Card><CardHeader className="border-b"><CardTitle><h2>Tu trabajo en vacantes</h2></CardTitle></CardHeader>
      <CardContent>{loaded && !loaded.first.items.length ? <SectionEmpty icon={History} tone="empty" title="Todavía no has trabajado en vacantes" description="Aquí verás tu trabajo y tus resultados cuando te sumes a una vacante. Mientras tanto, puedes consultar tus vacantes." primaryAction={{ label: "Ver vacantes", href: "/empresa/vacantes" }} /> : <Rows loading={loading} items={loaded ? currentFirst(loaded.first.items).slice(0, 5) : []} />}</CardContent>
      {hasMore && <CardFooter className="border-t"><Sheet>
        <SheetTrigger render={<Button type="button" variant="outline" className="min-h-10" />}>Ver todo</SheetTrigger>
        {/* Focus the title on open: focusing the first tabbable («Ver más», at the end) scrolled past AHORA. */}
        <SheetContent showCloseButton={false} initialFocus={sheetTitle} className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
          <SheetHeader className="border-b"><div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/12 text-foreground ring-1 ring-primary/40"><History aria-hidden="true" className="size-5" /></div><SheetTitle ref={sheetTitle} tabIndex={-1} className="outline-none">Mi historial de vacantes</SheetTitle><SheetDescription>Tu trabajo sigue a tu nombre, incluso cuando ya no estás en el equipo.</SheetDescription></SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6" aria-busy={pending}>
            <Rows items={pages?.items ?? []} />
            {moreFailure ? <StateCard icon={CircleAlert} tone="error" title="No pudimos cargar más vacantes" description="Lo que ya consultaste sigue disponible. Reintentar no cambia datos." primaryAction={{ label: "Reintentar", onClick: () => void more() }} /> : pages?.next_cursor && <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={() => void more()}>{pending ? "Cargando…" : "Ver más"}</Button>}
          </div>
          <SheetFooter className="border-t"><ActionBar status={null}><SheetClose render={<Button type="button" variant="outline" className="min-h-10" />}>Cerrar</SheetClose></ActionBar></SheetFooter>
        </SheetContent>
      </Sheet></CardFooter>}
    </Card>
  </div>;
}
