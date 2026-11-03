"use client";

import { useState, type ReactNode } from "react";
import { ArrowLeftRight, History as HistoryIcon, LogOut, UserRoundCog, UserRoundPlus } from "lucide-react";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia } from "@/components/ui/item";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ActionBar } from "@/components/feedback/action-status";
import { SectionEmpty } from "@/components/feedback/state-card";
import { SnapshotSheet, snapshotSheetClass } from "./snapshot-sheet";
import { formatDate, functionLabel, modeLabel, reasons, type History, type HistoryItem } from "./model";

const person = (name: string) => <span className="font-medium">{name}</span>;
function movement(item: HistoryItem): { sentence: ReactNode; tone: string; icon: typeof HistoryIcon } {
  if (item.kind === "reassignment") return {
    sentence: <>{person(item.reassignment.performed_by.name)} reasignó la vacante a {person(item.reassignment.to_user.name)}</>,
    // §13.1: primary-tinted medallions use foreground for dark-mode contrast.
    tone: "bg-primary/12 text-foreground ring-1 ring-primary/40", icon: UserRoundCog,
  };
  if (item.kind === "mode_change") return { sentence: <>{person(item.mode_change.performed_by.name)} cambió el modo a {modeLabel[item.mode_change.to_mode]}</>, tone: "bg-status-info/10 text-status-info", icon: ArrowLeftRight };
  const tramo = item.tramo;
  const name = person(tramo.user.name);
  if (tramo.ended_at) {
    const sentence = tramo.end_cause === "removed" ? <>{tramo.ended_by ? person(tramo.ended_by.name) : "Alguien"} quitó a {name} del equipo</>
      : tramo.end_cause === "membership_ended" ? <>Terminó la membresía de {name}</>
      : tramo.end_cause === "reassigned" ? <>{name} salió del equipo por reasignación</>
      : <>{name} salió del equipo</>;
    return { sentence, tone: "bg-muted text-muted-foreground", icon: LogOut };
  }
  const latest = tramo.functions.at(-1);
  if (tramo.functions.length > 1 && latest) return { sentence: <>{name} cambió su función a {functionLabel[latest.function].toLocaleLowerCase("es-MX")}</>, tone: "bg-status-info/10 text-status-info", icon: ArrowLeftRight };
  return { sentence: <>{name} se unió como {latest ? functionLabel[latest.function].toLocaleLowerCase("es-MX") : "miembro"}</>, tone: "bg-status-success/10 text-status-success", icon: UserRoundPlus };
}
function movementKey(item: HistoryItem) {
  return item.kind === "tramo" ? `tramo-${item.tramo.assignment_id}` : item.kind === "reassignment" ? `reassignment-${item.reassignment.id}` : `mode-${item.mode_change.id}`;
}
// Same connector layout as org-candidates/history/change-history; native Item spacing stays intact.
const timelineEntry = "relative items-start before:absolute before:left-[2.125rem] before:top-12 before:-bottom-4 before:w-px before:bg-border last:before:hidden";
// Movement sentences are body copy, not titles: only people's names carry medium emphasis.
function Timeline({ items, onSnapshot }: { items: HistoryItem[]; onSnapshot: (item: Extract<HistoryItem, { kind: "reassignment" }>) => void }) {
  return <ItemGroup className="gap-0">{items.map(item => {
    const { sentence, tone, icon: Icon } = movement(item);
    const event = item.kind === "reassignment" ? item.reassignment : null;
    return <Item role="listitem" key={movementKey(item)} className={timelineEntry}>
      <ItemMedia variant="icon" className={`size-9 rounded-full ${tone}`}><Icon aria-hidden="true" className="size-4" /></ItemMedia>
      <ItemContent className="min-w-0 gap-2">
        <p className="break-words text-sm leading-relaxed">{sentence}</p>
        <ItemDescription className="text-xs"><time dateTime={item.at}>{formatDate(item.at)}</time>{event && ` · ${reasons.find(reason => reason.value === event.reason)?.label}`}</ItemDescription>
        {event?.note && <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{event.note}</p>}
        {item.kind === "reassignment" && <Button type="button" variant="link" className="min-h-10 self-start" onClick={() => onSnapshot(item)}>Ver cómo estaba la vacante</Button>}
      </ItemContent>
    </Item>;
  })}</ItemGroup>;
}

export function TeamHistory({ history, onMore, pending }: { history: History; onMore: () => void; pending: boolean }) {
  const [snapshot, setSnapshot] = useState<Extract<HistoryItem, { kind: "reassignment" }> | null>(null);
  const [open, setOpen] = useState(false);
  const hasMore = history.items.length > 5 || !!history.next_cursor;
  return <>
    <section aria-labelledby="team-history-heading" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1"><h3 id="team-history-heading" className="text-base font-semibold">Movimientos del equipo</h3><p className="text-sm text-muted-foreground">Las incorporaciones, salidas y cambios más recientes.</p></div>
      {/* Timeline-only Card: the section heading already names it; no redundant CardHeader. */}
      {!history.items.length ? <Card><CardContent><SectionEmpty icon={HistoryIcon} tone="empty" title="Aún no hay cambios en el equipo" description="Aquí verás los movimientos del equipo cuando ocurran. Mientras tanto, revisa el equipo actual." primaryAction={{ label: "Ver equipo", href: "#current-team" }} /></CardContent></Card> : <Card>
        <CardContent><Timeline items={history.items.slice(0, 5)} onSnapshot={setSnapshot} /></CardContent>
        {hasMore && <CardFooter className="border-t"><Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<Button type="button" variant="outline" className="min-h-10" />}>Ver todos los movimientos</SheetTrigger>
          <SheetContent showCloseButton={false} className={snapshotSheetClass}>
            <SheetHeader className="border-b">
              <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/12 text-foreground ring-1 ring-primary/40"><HistoryIcon aria-hidden="true" className="size-5" /></div>
              <SheetTitle>Movimientos del equipo</SheetTitle><SheetDescription>Consulta quién se sumó, quién salió y qué cambió en la vacante.</SheetDescription>
            </SheetHeader>
            <div data-slot="movements-body" className="min-h-0 flex-1 overflow-y-auto p-6" aria-busy={pending}>
              <Timeline items={history.items} onSnapshot={setSnapshot} />
              {history.next_cursor && <Button type="button" variant="outline" className="min-h-10" disabled={pending} onClick={onMore}>{pending ? "Cargando…" : "Ver más"}</Button>}
            </div>
            <SheetFooter className="border-t"><ActionBar status={null}><SheetClose render={<Button type="button" variant="outline" className="min-h-10" />}>Cerrar movimientos</SheetClose></ActionBar></SheetFooter>
            {/* Nested in this Sheet only when opened here, so keyboard focus returns to its action. */}
            {open && snapshot && <SnapshotSheet snapshot={snapshot.reassignment.state_snapshot} from={snapshot.reassignment.from_user.name} to={snapshot.reassignment.to_user.name} open onOpenChange={value => { if (!value) setSnapshot(null); }} />}
          </SheetContent>
        </Sheet></CardFooter>}
      </Card>}
    </section>
    {!open && snapshot && <SnapshotSheet snapshot={snapshot.reassignment.state_snapshot} from={snapshot.reassignment.from_user.name} to={snapshot.reassignment.to_user.name} open onOpenChange={value => { if (!value) setSnapshot(null); }} />}
  </>;
}
