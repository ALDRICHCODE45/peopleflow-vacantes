"use client";
import { History as HistoryIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { SectionEmpty } from "@/components/feedback/state-card";
import { SnapshotDetails } from "./controls";
import { formatDate, functionLabel, modeLabel, reasons, type History } from "./model";
const causeLabel = { creation: "Creación", added: "Incorporación", reassignment: "Reasignación", backfill: "Registro inicial", removed: "Retiro del equipo", left: "Salida voluntaria", reassigned: "Reasignación", membership_ended: "Fin de membresía" };

export function TeamHistory({ history, onMore, pending }: { history: History; onMore: () => void; pending: boolean }) {
  return <section aria-labelledby="team-history-heading" className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-col gap-1"><h3 id="team-history-heading" className="text-base font-semibold">Historia del equipo</h3><p className="text-sm text-muted-foreground">Más reciente primero. Los cambios de función no reinician los tramos.</p></div>
    {!history.items.length ? <Card><CardContent><SectionEmpty icon={HistoryIcon} tone="empty" title="Aún no hay cambios en el equipo" description="Aquí verás los tramos y las reasignaciones cuando ocurran. Mientras tanto, revisa el equipo actual." primaryAction={{ label: "Ver equipo", href: "#current-team" }} /></CardContent></Card> : <ol className="flex flex-col gap-4">{history.items.map(item => {
      if (item.kind === "tramo") {
        const tramo = item.tramo;
        return <li key={`tramo-${tramo.assignment_id}`}><Card>
          <CardHeader><CardTitle><h4>Tramo de {tramo.user.name}</h4></CardTitle><CardDescription>{formatDate(tramo.started_at)} – {tramo.ended_at ? formatDate(tramo.ended_at) : "Actualidad"} · {causeLabel[tramo.start_cause]}</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-3"><ol className="flex flex-col gap-2">{tramo.functions.map((period, index) => <li key={`${period.started_at}-${index}`} className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{functionLabel[period.function]}</Badge><span className="text-sm text-muted-foreground">{formatDate(period.started_at)} – {period.ended_at ? formatDate(period.ended_at) : "Actualidad"}</span></li>)}</ol>
            {tramo.end_cause && <p className="text-sm text-muted-foreground">{causeLabel[tramo.end_cause]} · Plazo al salir: {formatDate(tramo.closing_deadline)}</p>}
          </CardContent>
        </Card></li>;
      }
      if (item.kind === "mode_change") return <li key={`mode-${item.mode_change.id}`}><Card><CardHeader><CardTitle><h4>Cambió el modo del equipo</h4></CardTitle><CardDescription>{formatDate(item.at)} · {item.mode_change.performed_by.name}</CardDescription></CardHeader><CardContent><p className="text-sm">{modeLabel[item.mode_change.from_mode]} → {modeLabel[item.mode_change.to_mode]}</p>{item.mode_change.responsible_user && <p className="text-sm text-muted-foreground">Responsable: {item.mode_change.responsible_user.name}</p>}</CardContent></Card></li>;
      const event = item.reassignment;
      return <li key={`reassignment-${event.id}`}><Card><CardHeader><CardTitle><h4>{event.to_user.name} reemplaza a {event.from_user.name}</h4></CardTitle><CardDescription>{formatDate(item.at)} · {event.performed_by.name}</CardDescription></CardHeader><CardContent className="flex flex-col gap-3"><p className="text-sm">Motivo: {reasons.find(reason => reason.value === event.reason)?.label}. {event.previous_responsible === "remove" ? "El responsable anterior sale de la vacante." : "El responsable anterior sigue como colaborador."}</p>{event.note && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">Nota: {event.note}</p>}
        <Accordion><AccordionItem value="snapshot"><AccordionTrigger>Ver estado guardado</AccordionTrigger><AccordionContent><SnapshotDetails snapshot={event.state_snapshot} /></AccordionContent></AccordionItem></Accordion>
      </CardContent></Card></li>;
    })}</ol>}
    {history.next_cursor && <Button type="button" variant="outline" disabled={pending} onClick={onMore}>{pending ? "Cargando…" : "Ver más"}</Button>}
  </section>;
}
