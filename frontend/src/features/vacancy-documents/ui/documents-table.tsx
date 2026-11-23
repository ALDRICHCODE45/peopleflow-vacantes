"use client";

import { FileImage, FileSpreadsheet, FileText, History, Link2, Lock, Briefcase, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DocumentFormat, DocumentOwner, Scope } from "../model";
import type { Participation } from "./candidate-picker";
import { dateLabel, FORMAT_LABEL, sizeLabel } from "./format";
import { RowActions, type RowIntent } from "./row-actions";
import type { DocRow } from "./rows";

const FormatIcon = ({ format }: { format: DocumentFormat }) => {
  const Icon = format === "xlsx" ? FileSpreadsheet : format === "jpg" || format === "png" ? FileImage : FileText;
  return <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-5" /></span>;
};
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
const originLabel = (sequence: number) => sequence === 0 ? "Proceso original" : `Reemplazo ${sequence}`;

function Owner({ owner, participations }: { owner: DocumentOwner; participations: Participation[] }) {
  if (owner.kind === "vacancy") return <span className="inline-flex items-center gap-2 font-medium"><Briefcase aria-hidden="true" className="size-4 text-muted-foreground" />Vacante</span>;
  const stage = participations.find(entry => entry.participation_id === owner.participation_id)?.stage.name;
  return <span className="inline-flex items-center gap-2">
    <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">{initials(owner.candidate.full_name)}</span>
    <span className="flex min-w-0 flex-col"><span className="truncate font-medium">{owner.candidate.full_name}</span>{stage && <span className="truncate text-xs text-muted-foreground">{stage}</span>}</span>
    {owner.discarded && <Badge variant="neutral">Descartado</Badge>}
  </span>;
}

const cell = "max-md:block max-md:p-0 max-md:whitespace-normal";
function Line({ row, participations, openVersions }: { row: Extract<DocRow, { kind: "item" }>; participations: Participation[]; openVersions: (row: DocRow, trigger: HTMLElement) => void }) {
  const { item } = row;
  return <>
    <TableCell className={`${cell} max-md:col-span-2`}><div className="flex items-center gap-3"><FormatIcon format={item.format} /><div className="min-w-0"><p className="truncate font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{`${FORMAT_LABEL[item.format]} · ${sizeLabel(item.size)}`}</p></div></div></TableCell>
    <TableCell className={cell}><Owner owner={row.owner} participations={participations} /></TableCell>
    <TableCell className={cell}><div className="flex flex-wrap items-center gap-2"><span className="tabular-nums">v{item.version}</span>
      {item.version_count > 1 && <button type="button" onClick={event => openVersions(row, event.currentTarget)} className="inline-flex min-h-10 items-center gap-1 rounded-xl px-2 text-xs text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"><History aria-hidden="true" className="size-3.5" />{item.version_count} versiones</button>}</div></TableCell>
    <TableCell className={cell}><p>{item.updated_by.name}</p><p className="text-xs text-muted-foreground">{dateLabel(item.updated_at)}</p></TableCell>
  </>;
}

function LinkLine({ row, participations }: { row: Extract<DocRow, { kind: "link" }>; participations: Participation[] }) {
  const { link } = row;
  const source = link.source;
  const when = <TableCell className={cell}><p>Vinculado {dateLabel(link.linked_at)}</p><p className="text-xs text-muted-foreground">{link.linked_by.name}</p></TableCell>;
  if (!source) {
    const removed = link.state === "removed";
    return <>
      <TableCell className={`${cell} max-md:col-span-2`}><div className="flex items-center gap-3"><span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">{removed ? <Trash2 className="size-5" /> : <Lock className="size-5" />}</span>
        <div className="min-w-0"><p className="font-medium">{removed ? "Documento eliminado" : "Documento sin acceso"}</p><p className="text-xs text-muted-foreground">{removed ? "Se eliminó en el proceso de origen" : "Sin acceso al proceso de origen"}</p></div></div></TableCell>
      <TableCell className={cell}><Owner owner={row.owner} participations={participations} /></TableCell>
      <TableCell className={cell}><Badge variant="neutral">{removed ? "Eliminado en el origen" : "Sin acceso"}</Badge></TableCell>
      {when}
    </>;
  }
  return <>
    <TableCell className={`${cell} max-md:col-span-2`}><div className="flex items-center gap-3"><FormatIcon format={source.format} /><div className="min-w-0"><p className="truncate font-medium">{source.name}</p><p className="text-xs text-muted-foreground">{`${FORMAT_LABEL[source.format]} · ${sizeLabel(source.size)}`}</p></div></div></TableCell>
    <TableCell className={cell}><div className="flex flex-col items-start gap-1"><Owner owner={row.owner} participations={participations} /><Badge variant="accent"><Link2 aria-hidden="true" />{originLabel(source.sequence)}</Badge></div></TableCell>
    <TableCell className={cell}><div className="flex flex-wrap items-center gap-2"><span className="tabular-nums">v{source.version} fijada</span>{source.has_newer_version && <Badge variant="review" dot>Hay una versión más nueva</Badge>}</div></TableCell>
    {when}
  </>;
}

/** One table of items and links (artboard 03); below `md` every row stacks as a card, so there is a single DOM for both layouts. */
export function DocumentsTable({ draftId, rows, participations, limits, busy, onIntent, onVersions }: {
  draftId: string; rows: DocRow[]; participations: Participation[]; limits: Scope["limits"]; busy: boolean;
  onIntent: (intent: RowIntent, row: DocRow, trigger: HTMLElement | null) => void; onVersions: (row: DocRow, trigger: HTMLElement) => void;
}) {
  return <div aria-busy={busy || undefined} className={busy ? "opacity-70 transition-opacity" : undefined}>
    <Table className="max-md:block">
      <caption className="sr-only">Documentos de la vacante y de sus candidatos, el más reciente primero</caption>
      <TableHeader className="max-md:sr-only"><TableRow className="max-md:block">
        <TableHead scope="col" className="min-w-64">Documento</TableHead><TableHead scope="col">Pertenece a</TableHead><TableHead scope="col">Versión</TableHead>
        <TableHead scope="col">Actualizado</TableHead><TableHead scope="col"><span className="sr-only">Acciones</span></TableHead>
      </TableRow></TableHeader>
      <TableBody className="max-md:block">
        {rows.map(row => <TableRow key={`${row.kind}-${row.id}`} className="max-md:mb-2 max-md:grid max-md:grid-cols-[1fr_auto] max-md:gap-x-2 max-md:gap-y-2 max-md:rounded-2xl max-md:border max-md:p-3">
          {row.kind === "item" ? <Line row={row} participations={participations} openVersions={onVersions} /> : <LinkLine row={row} participations={participations} />}
          <TableCell className={`${cell} max-md:col-start-2 max-md:row-start-1`}><RowActions draftId={draftId} row={row} limits={limits} onIntent={onIntent} /></TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
  </div>;
}
