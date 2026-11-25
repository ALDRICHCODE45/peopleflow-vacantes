"use client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { RichColumnDef } from "@/components/data-table/rich-data-table";
import { TwoLineCell } from "@/components/data-table/truncated-text";
import { accentAvatar } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { describeActor, describeBrowser, eventLabel, isKnownEventType, isTheVacancy, MX_TIME_ZONE, vacancyTitleLabel, type AuditEvent } from "./model";

const dayFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, dateStyle: "medium" });
const timeFormat = new Intl.DateTimeFormat("es-MX", { timeZone: MX_TIME_ZONE, timeStyle: "medium" });

/** Documented exception for this table (design/system.md «Audit table»): cells wrap up to 3 lines and the full text is in `title` and in the detail sheet. */
const CLAMP = "line-clamp-3 whitespace-normal [overflow-wrap:anywhere]";
function Clamp({ text, title = text, className }: { text: string; title?: string; className?: string }) {
  return <span title={title} className={cn("min-w-0", CLAMP, className)}>{text}</span>;
}

function When({ event }: { event: AuditEvent }) {
  const date = new Date(event.occurred_at);
  if (Number.isNaN(date.getTime())) return <TwoLineCell primary="—" missing />;
  return <time dateTime={event.occurred_at} title="Hora de la Ciudad de México"><TwoLineCell primary={dayFormat.format(date)} secondary={timeFormat.format(date)} /></time>;
}

/** The email is not repeated under the name (the table must fit a 1440 px page): the tooltip and the detail sheet carry it. */
function Who({ actor, eventType }: { actor: AuditEvent["actor"]; eventType: string }) {
  const who = describeActor(actor, eventType);
  return <div className="flex min-w-0 items-start gap-3">
    <Avatar className="shrink-0"><AvatarFallback className={cn("text-xs", accentAvatar)}>{initials(who.name)}</AvatarFallback></Avatar>
    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
      <Clamp text={who.name} title={who.email ? `${who.name} · ${who.email}` : who.name} className="w-full text-sm font-medium text-foreground" />
      {who.former && <Badge variant="neutral">Ex miembro</Badge>}
    </div>
  </div>;
}

function Action({ event }: { event: AuditEvent }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <Clamp text={eventLabel(event.event_type)} className="text-sm font-medium text-foreground" />
    {!isKnownEventType(event.event_type) && <Clamp text={event.event_type} className="font-mono text-xs text-muted-foreground" />}
  </div>;
}

function Origin({ event }: { event: AuditEvent }) {
  return <div className="flex min-w-0 flex-col items-start gap-1">
    {event.ip ? <Clamp text={event.ip} className="w-full font-mono text-xs text-foreground" /> : event.ip_source === "peer" ? null : <span className="text-xs text-muted-foreground">—</span>}
    {event.ip_source === "peer" && <Badge variant="review" title="La IP la vio el servidor, no el navegador de la persona: puede ser la de un intermediario.">IP no verificada</Badge>}
    <span className={cn("w-full min-w-0 text-xs text-muted-foreground", CLAMP)} title={event.user_agent ?? undefined}>{describeBrowser(event.user_agent)}</span>
  </div>;
}

/**
 * Columns in the artboard's order (Cuándo first), sized so the table fits a 1440 px page without sideways scrolling: the fixed widths add
 * up to 1056 px of the ~1092 px the card gives it, and «Vacante» (the fill column) takes whatever is left. Muted secondary lines,
 * semantic badges; long text wraps (see CLAMP) and the rows shrink to their content.
 */
export const auditColumns: RichColumnDef<AuditEvent>[] = [
  { id: "when", size: 136, meta: { label: "Cuándo" }, enableHiding: false, cell: ({ row }) => <When event={row.original} /> },
  { id: "actor", size: 210, meta: { label: "Quién" }, enableHiding: false, cell: ({ row }) => <Who actor={row.original.actor} eventType={row.original.event_type} /> },
  { id: "action", size: 170, meta: { label: "Acción" }, enableHiding: false, cell: ({ row }) => <Action event={row.original} /> },
  { id: "entity", size: 180, meta: { label: "Sobre" }, cell: ({ row }) => isTheVacancy(row.original) || !row.original.entity.label
    ? <TwoLineCell primary="—" missing />
    : <Clamp text={row.original.entity.label} className="text-sm font-medium text-foreground" /> },
  { id: "vacancy", size: 188, meta: { label: "Vacante", grow: true }, cell: ({ row }) => row.original.vacancy
    ? <VacancyTitle title={row.original.vacancy.title} />
    : <TwoLineCell primary="—" missing /> },
  { id: "origin", size: 172, meta: { label: "IP y navegador" }, cell: ({ row }) => <Origin event={row.original} /> },
];

function VacancyTitle({ title }: { title: string | null }) {
  const { label, missing } = vacancyTitleLabel(title);
  return missing ? <TwoLineCell primary={label} missing /> : <Clamp text={label} className="text-sm font-medium text-foreground" />;
}
