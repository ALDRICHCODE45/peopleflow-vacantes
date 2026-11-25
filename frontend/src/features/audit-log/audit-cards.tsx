"use client";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { describeActor, eventLabel, isKnownEventType, isTheVacancy, MX_TIME_ZONE, vacancyTitleLabel, type AuditEvent } from "./model";

const dayFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, timeStyle: "medium" });
/** Same documented exception as the table (design/system.md «Audit table»): text wraps up to 3 lines and the full text is in `title` and in the detail sheet. */
const CLAMP = "line-clamp-3 whitespace-normal [overflow-wrap:anywhere]";

function Clamp({ text, className }: { text: string; className?: string }) {
  return <span title={text} className={cn("min-w-0", CLAMP, className)}>{text}</span>;
}
function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-baseline gap-1.5 text-sm"><span className="shrink-0 text-xs text-muted-foreground">{label}</span>{children}</div>;
}

function EventCard({ event, onOpen }: { event: AuditEvent; onOpen?: (event: AuditEvent) => void }) {
  const who = describeActor(event.actor, event.event_type);
  const date = new Date(event.occurred_at);
  const valid = !Number.isNaN(date.getTime());
  const vacancy = event.vacancy ? vacancyTitleLabel(event.vacancy.title) : null;
  const about = isTheVacancy(event) ? null : event.entity.label;
  return <li className="border-t border-border/60 first:border-t-0">
    <button type="button" aria-haspopup="dialog" onClick={() => onOpen?.(event)}
      aria-label={`Ver el detalle: ${eventLabel(event.event_type)}, ${who.name}, ${valid ? dayFormat.format(date) : "sin fecha"}`}
      className="grid min-h-[76px] w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 px-(--card-spacing) py-3.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-text">
      <span className="flex min-w-0 flex-col gap-1.5">
        <Clamp text={eventLabel(event.event_type)} className="text-[15px] leading-snug font-semibold text-foreground" />
        {!isKnownEventType(event.event_type) && <Clamp text={event.event_type} className="font-mono text-xs text-muted-foreground" />}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <span className={cn("min-w-0 [overflow-wrap:anywhere]", who.name === "Usuario eliminado" && "text-muted-foreground")}>{who.name}</span>
          {who.former && <Badge variant="neutral">Ex miembro</Badge>}
        </span>
        {!isTheVacancy(event) && <Labeled label="Sobre ·">{about ? <Clamp text={about} className="font-medium text-foreground" /> : <span className="text-muted-foreground">—</span>}</Labeled>}
        {vacancy && <Labeled label="Vacante ·"><Clamp text={vacancy.label} className={cn("font-medium", vacancy.missing ? "text-muted-foreground" : "text-foreground")} /></Labeled>}
        {valid
          ? <time dateTime={event.occurred_at} title="Hora de la Ciudad de México" className="text-xs text-muted-foreground">{`${dayFormat.format(date)} · ${timeFormat.format(date)}`}</time>
          : <span className="text-xs text-muted-foreground">—</span>}
      </span>
      <ChevronRight aria-hidden="true" className="mt-1 size-5 shrink-0 text-muted-foreground" />
    </button>
  </li>;
}

/** Phone layout of the audit table: one condensed, tappable card per event; a tap opens the detail sheet. */
export function AuditEventList({ items, onOpen }: { items: AuditEvent[]; onOpen?: (event: AuditEvent) => void }) {
  return <ul data-audit-list aria-label="Eventos registrados" className="flex flex-col border-t border-border/60">
    {items.map(event => <EventCard key={event.id} event={event} onOpen={onOpen} />)}
  </ul>;
}

/** Same blocks as the cards, so loading does not shift the layout. */
export function AuditEventListSkeleton() {
  return <ul data-audit-skeleton="list" aria-hidden="true" className="flex flex-col border-t border-border/60">
    {Array.from({ length: 4 }, (_, index) => <li key={index} className="flex min-h-[76px] flex-col gap-2 border-t border-border/60 px-(--card-spacing) py-3.5 first:border-t-0">
      <Skeleton className="h-5 w-3/5" /><Skeleton className="h-4 w-2/5" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-1/3" />
    </li>)}
  </ul>;
}
