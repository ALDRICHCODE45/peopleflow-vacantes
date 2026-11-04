"use client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { RichColumnDef } from "@/components/data-table/rich-data-table";
import { TruncatedText, TwoLineCell } from "@/components/data-table/truncated-text";
import { accentAvatar } from "@/lib/accent";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { describeActor, describeBrowser, eventLabel, isKnownEventType, MX_TIME_ZONE, type AuditEvent } from "./model";

const dayFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, timeStyle: "medium" });

function When({ event }: { event: AuditEvent }) {
  const date = new Date(event.occurred_at);
  if (Number.isNaN(date.getTime())) return <TwoLineCell primary="—" missing />;
  return <time dateTime={event.occurred_at} title="Hora de la Ciudad de México"><TwoLineCell primary={dayFormat.format(date)} secondary={timeFormat.format(date)} /></time>;
}

function Who({ actor }: { actor: AuditEvent["actor"] }) {
  const who = describeActor(actor);
  return <div className="flex min-w-0 items-center gap-3">
    <Avatar className="size-10 shrink-0"><AvatarFallback className={accentAvatar}>{initials(who.name)}</AvatarFallback></Avatar>
    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
      <TruncatedText text={who.name} className="w-full text-sm font-medium text-foreground" />
      {who.email && <TruncatedText text={who.email} className="w-full text-xs text-muted-foreground" />}
      {who.former && <Badge variant="neutral">Ex miembro</Badge>}
    </div>
  </div>;
}

function Action({ event }: { event: AuditEvent }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <TruncatedText text={eventLabel(event.event_type)} className="text-sm font-medium text-foreground" />
    {!isKnownEventType(event.event_type) && <TruncatedText text={event.event_type} className="font-mono text-xs text-muted-foreground" />}
  </div>;
}

function Origin({ event }: { event: AuditEvent }) {
  return <div className="flex min-w-0 flex-col items-start gap-1">
    {event.ip ? <TruncatedText text={event.ip} className="w-full font-mono text-xs text-foreground" /> : event.ip_source === "peer" ? null : <span className="text-xs text-muted-foreground">—</span>}
    {event.ip_source === "peer" && <Badge variant="review" title="La IP la vio el servidor, no el navegador de la persona: puede ser la de un intermediario.">IP no verificada</Badge>}
    <span className="w-full min-w-0 truncate text-xs text-muted-foreground" title={event.user_agent ?? undefined}>{describeBrowser(event.user_agent)}</span>
  </div>;
}

/** Same column anatomy as the talent base: identity column pinned first, muted secondary lines, semantic badges. */
export const auditColumns: RichColumnDef<AuditEvent>[] = [
  { id: "when", size: 150, meta: { label: "Cuándo" }, enableHiding: false, cell: ({ row }) => <When event={row.original} /> },
  { id: "actor", size: 240, meta: { label: "Quién" }, enableHiding: false, cell: ({ row }) => <Who actor={row.original.actor} /> },
  { id: "action", size: 220, meta: { label: "Acción" }, enableHiding: false, cell: ({ row }) => <Action event={row.original} /> },
  { id: "entity", size: 180, meta: { label: "Sobre" }, cell: ({ row }) => row.original.entity.label
    ? <TruncatedText text={row.original.entity.label} className="text-sm font-medium text-foreground" />
    : <TwoLineCell primary="Sin etiqueta" missing /> },
  { id: "vacancy", size: 180, meta: { label: "Vacante", grow: true }, cell: ({ row }) => row.original.vacancy
    ? row.original.vacancy.title ? <TruncatedText text={row.original.vacancy.title} className="text-sm font-medium text-foreground" /> : <TwoLineCell primary="Vacante eliminada" missing />
    : <TwoLineCell primary="—" missing /> },
  { id: "origin", size: 200, meta: { label: "IP y navegador" }, cell: ({ row }) => <Origin event={row.original} /> },
];
