import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { describeActor, describeBrowser, eventLabel, formatOccurredAt, isKnownEventType, type AuditEvent } from "./model";

const muted = "text-xs text-muted-foreground";

function Who({ actor }: { actor: AuditEvent["actor"] }) {
  const who = describeActor(actor);
  return <div className="flex min-w-0 flex-col gap-0.5">
    <span className="flex flex-wrap items-center gap-1.5 font-medium">{who.name}{who.former && <Badge variant="neutral">Ex miembro</Badge>}</span>
    {who.email && <span className={muted}>{who.email}</span>}
  </div>;
}

function Origin({ event }: { event: AuditEvent }) {
  return <div className="flex min-w-0 flex-col gap-0.5">
    <span className="flex flex-wrap items-center gap-1.5">
      {event.ip ? <span className="font-mono text-xs">{event.ip}</span> : event.ip_source === "peer" ? null : <span className={muted}>—</span>}
      {event.ip_source === "peer" && <Badge variant="review" title="La IP la vio el servidor, no el navegador de la persona: puede ser la de un intermediario.">IP no verificada</Badge>}
    </span>
    <span className={muted} title={event.user_agent ?? undefined}>{describeBrowser(event.user_agent)}</span>
  </div>;
}

/** One row per recorded event; every nullable of the contract has an honest, neutral reading. */
export function AuditTable({ items }: { items: AuditEvent[] }) {
  return <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Cuándo</TableHead><TableHead>Quién</TableHead><TableHead>Acción</TableHead>
        <TableHead>Sobre</TableHead><TableHead>Vacante</TableHead><TableHead>IP y navegador</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {items.map(event => <TableRow key={event.id}>
        <TableCell className="whitespace-nowrap align-top"><time dateTime={event.occurred_at} title="Hora de la Ciudad de México">{formatOccurredAt(event.occurred_at)}</time></TableCell>
        <TableCell className="align-top"><Who actor={event.actor} /></TableCell>
        <TableCell className="align-top whitespace-normal">
          <span className="flex flex-col gap-0.5">{eventLabel(event.event_type)}{!isKnownEventType(event.event_type) && <span className={`${muted} font-mono`}>{event.event_type}</span>}</span>
        </TableCell>
        <TableCell className="align-top whitespace-normal">{event.entity.label ?? <span className={muted}>Sin etiqueta</span>}</TableCell>
        <TableCell className="align-top whitespace-normal">{event.vacancy ? event.vacancy.title ?? <span className={muted}>Vacante eliminada</span> : <span className={muted}>—</span>}</TableCell>
        <TableCell className="align-top"><Origin event={event} /></TableCell>
      </TableRow>)}
    </TableBody>
  </Table>;
}
