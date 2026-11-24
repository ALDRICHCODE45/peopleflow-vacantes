"use client";
import { useRef, useState, type ReactNode } from "react";
import { Copy, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { accentAvatar } from "@/lib/accent";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { categoryLabel, describeActor, describeBrowser, eventLabel, isKnownEventType, isTheVacancy, MX_TIME_ZONE, vacancyTitleLabel, type AuditEvent } from "./model";

const momentFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, dateStyle: "full", timeStyle: "medium" });
const MUTED = "text-muted-foreground";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1 border-t border-border/60 py-3 first:border-t-0 first:pt-0">
    <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-sm [overflow-wrap:anywhere]">{children}</dd>
  </div>;
}
const Note = ({ children }: { children: ReactNode }) => <p className="mt-1 text-xs text-muted-foreground">{children}</p>;

function Detail({ event }: { event: AuditEvent }) {
  const [copied, setCopied] = useState(false);
  const who = describeActor(event.actor, event.event_type);
  const date = new Date(event.occurred_at);
  const vacancy = event.vacancy ? vacancyTitleLabel(event.vacancy.title) : null;
  async function copy() {
    try { await navigator.clipboard.writeText(event.id); setCopied(true); } catch { setCopied(false); }
  }
  return <>
    <SheetHeader>
      <SheetTitle className="pr-12 [overflow-wrap:anywhere]">{eventLabel(event.event_type)}</SheetTitle>
      <SheetDescription><time dateTime={event.occurred_at}>{Number.isNaN(date.getTime()) ? "—" : momentFormat.format(date)}</time> · hora de la Ciudad de México</SheetDescription>
    </SheetHeader>
    <dl className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-6 py-2">
      <Row label="Quién">{who.system ? <b className="font-medium">Sistema</b> : <div className="flex items-start gap-3">
        <Avatar className="size-10 shrink-0"><AvatarFallback className={accentAvatar}>{initials(who.name)}</AvatarFallback></Avatar>
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <b className={who.name === "Usuario eliminado" ? `font-medium ${MUTED}` : "font-medium"}>{who.name}</b>
          {who.email && <span className={`text-xs ${MUTED}`}>{who.email}</span>}
          {who.former && <Badge variant="neutral">Ex miembro</Badge>}
        </div></div>}
        {who.former && <Note>Ya no pertenece a la empresa; su historial se conserva.</Note>}
        {!who.system && !who.email && who.name === "Usuario eliminado" && <Note>Su nombre y correo ya no están disponibles.</Note>}
      </Row>
      <Row label="Acción">
        <b className="font-medium">{eventLabel(event.event_type)}</b>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"><Badge variant="neutral">{categoryLabel(event.category)}</Badge>
          <span className={`font-mono text-xs ${MUTED}`}>{event.event_type}</span></div>
        {!isKnownEventType(event.event_type) && <Note>Una acción que esta versión todavía no conoce.</Note>}
      </Row>
      <Row label="Sobre">{isTheVacancy(event) ? <span className={MUTED}>—</span>
        : event.entity.label ? <b className="font-medium">{event.entity.label}</b> : <span className={MUTED}>Sin etiqueta</span>}</Row>
      <Row label="Vacante">{vacancy && event.vacancy
        ? <><b className={`font-medium ${vacancy.missing ? MUTED : ""}`}>{vacancy.label}</b>{vacancy.missing && <Note>{`Identificador #${event.vacancy.id.slice(0, 8)}`}</Note>}</>
        : <span className={MUTED}>Este evento no es de una vacante.</span>}</Row>
      <Row label="IP">{event.ip ? <><span className="font-mono">{event.ip}</span>
        {event.ip_source === "peer" && <div className="mt-1 flex flex-col items-start gap-1"><Badge variant="review">IP no verificada</Badge><Note>La IP la vio el servidor, no el navegador de la persona: puede ser la de un intermediario.</Note></div>}</>
        : <span className={MUTED}>—</span>}</Row>
      <Row label="Navegador">{event.user_agent ? <><b className="font-medium">{describeBrowser(event.user_agent)}</b><p className={`mt-0.5 font-mono text-xs ${MUTED}`}>{event.user_agent}</p></> : <span className={MUTED}>—</span>}</Row>
      <Row label="Metadatos">{Object.keys(event.metadata).length
        ? <div className="flex flex-col gap-1 rounded-xl bg-muted px-3 py-2.5 text-xs">{Object.entries(event.metadata).map(([key, value]) =>
          <div key={key} className="grid grid-cols-[minmax(0,.45fr)_minmax(0,1fr)] gap-2"><span className={`font-mono ${MUTED}`}>{key}</span><span className="font-mono">{typeof value === "object" ? JSON.stringify(value) : String(value)}</span></div>)}</div>
        : <span className={MUTED}>Este evento no guarda metadatos.</span>}</Row>
      <Row label="ID del evento"><span className="font-mono text-xs">{event.id}</span></Row>
    </dl>
    <SheetFooter className="flex-row flex-wrap items-center justify-end gap-2 border-t">
      {copied && <span role="status" className="mr-auto text-xs text-muted-foreground">ID copiado</span>}
      <Button type="button" variant="outline" className="min-h-10" onClick={() => void copy()}><Copy aria-hidden="true" data-icon="inline-start" />Copiar ID</Button>
      <SheetClose render={<Button type="button" className="min-h-10" />}>Cerrar</SheetClose>
    </SheetFooter>
  </>;
}

/** Every field of one event, with the full text the table clamps. Keeps the last event while the sheet slides out. */
export function AuditEventSheet({ event, onClose }: { event: AuditEvent | null; onClose: () => void }) {
  const last = useRef(event);
  if (event) last.current = event;
  const shown = last.current;
  return <Sheet open={event !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <SheetContent side="right" showCloseButton={false} className="gap-0 bg-card max-sm:[--sheet-inset:0px] max-sm:data-[side=right]:rounded-none max-sm:data-[side=right]:border-0 data-[side=right]:w-full">
      {shown && <Detail key={shown.id} event={shown} />}
      <SheetClose render={<Button type="button" variant="ghost" size="icon" className="absolute top-4 right-4 size-10 bg-secondary" aria-label="Cerrar" />}><X aria-hidden="true" /></SheetClose>
    </SheetContent>
  </Sheet>;
}
