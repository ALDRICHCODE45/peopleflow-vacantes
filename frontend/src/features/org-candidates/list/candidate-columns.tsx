"use client";
import Link from "next/link";
import { createContext, useContext } from "react";
import { ArrowUpDown, ArrowUpRight, Check, Ellipsis, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RichColumnDef } from "@/components/data-table/rich-data-table";
import { TruncatedText, TwoLineCell } from "@/components/data-table/truncated-text";
import { normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import type { LanguageCatalog } from "@/features/languages/model";
import type { OrgCandidate } from "../model";
import { relativeTime } from "../relative-time";
import type { OpenCandidate } from "./candidate-results";
import { candidateDateFormat, candidateKey, educationLines, experienceLines, languageLabels, locationLines, originLabel, processLabels, vacancyBadges, type CandidateListItem } from "./candidate-values";

export function CandidateLanguages({ item, languages }: { item: OrgCandidate; languages: LanguageCatalog["items"] }) {
 const labels = languageLabels(item, languages);
 if (!labels.length) return <TwoLineCell primary="Sin dato" missing />;
 return <div className="flex min-w-0 flex-col items-start gap-1">
  <Badge variant="outline" className="max-w-full"><TruncatedText text={labels[0]} /></Badge>
  {labels.length > 1 && <TooltipProvider><Tooltip><TooltipTrigger render={<span className="text-xs text-muted-foreground" />} tabIndex={0}>+{labels.length - 1} {labels.length === 2 ? "idioma" : "idiomas"}</TooltipTrigger>
   <TooltipContent><div className="flex flex-col gap-1">{labels.map((label, index) => <span key={index}>{label}</span>)}</div></TooltipContent>
  </Tooltip></TooltipProvider>}
 </div>;
}
export function LatestVacancyCell({ item, compact = true }: { item: OrgCandidate; compact?: boolean }) {
 const latest = item.latest_participation;
 if (!latest) return <TwoLineCell primary="Sin participaciones" missing />;
 const badges = vacancyBadges(item);
 return <div className="flex min-w-0 flex-col items-start gap-1.5">
  <TruncatedText text={latest.vacancy.title} className="w-full text-sm font-medium text-foreground" />
  {compact ? <Badge variant={badges.at(-1)!.variant} dot className="max-w-full"><TruncatedText text={badges.map(badge => badge.text).join(" · ")} /></Badge> : <div className="flex max-w-full flex-wrap gap-1">{badges.map(badge => <Badge key={badge.text} variant={badge.variant} dot className="max-w-full"><TruncatedText text={badge.text} /></Badge>)}</div>}
 </div>;
}
export function CandidateActions({ item, onOpen }: { item: OrgCandidate; onOpen?: OpenCandidate }) {
 return <div data-row-action onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
  <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${item.full_name}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
   <DropdownMenuContent align="end" className="min-w-60"><DropdownMenuGroup>
    <DropdownMenuItem className="min-h-10" onClick={() => onOpen?.({ kind: item.kind, id: item.id })}>Ver ficha</DropdownMenuItem>
    {item.latest_participation && <DropdownMenuItem className="min-h-10" render={<Link href={`/empresa/vacantes/${item.latest_participation.vacancy.id}/pipeline`} />}>Abrir tablero de la vacante</DropdownMenuItem>}
   </DropdownMenuGroup></DropdownMenuContent>
  </DropdownMenu>
 </div>;
}
export function CandidateIdentity({ item, onOpen, heading = false }: { item: CandidateListItem; onOpen?: OpenCandidate; heading?: boolean }) {
 const Name = heading ? "h3" : "div";
 return <div className="flex min-w-0 items-center gap-3"><Avatar className="size-10 shrink-0"><AvatarFallback>{initials(item.full_name)}</AvatarFallback></Avatar>
  <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
   <Name className="flex w-full min-w-0 items-center gap-1.5">{heading ? <Button type="button" variant="link" className="-mx-3 h-auto min-h-10 min-w-0 max-w-full shrink justify-start text-left font-medium text-foreground" aria-label={`Abrir ficha de ${item.full_name}`} onClick={() => onOpen?.({ kind: item.kind, id: item.id })}><TruncatedText text={item.full_name} /></Button> : <TruncatedText text={item.full_name} className="text-sm font-medium text-foreground" />}
    {!!item.corrected_fields?.length && <TooltipProvider><Tooltip><TooltipTrigger render={<span className="shrink-0 text-muted-foreground" />} tabIndex={0} aria-label="Datos corregidos por tu empresa"><Check aria-hidden="true" className="size-3.5" /></TooltipTrigger><TooltipContent>Datos corregidos por tu empresa</TooltipContent></Tooltip></TooltipProvider>}
   </Name>
   {item.professional_title && <TruncatedText text={normalizedProfileLabel(item.professional_title)} className="w-full text-xs text-muted-foreground" />}
   <Badge variant="outline" className="text-muted-foreground">{item.kind === "manual" ? <Users aria-hidden="true" data-icon="inline-start" /> : <ArrowUpRight aria-hidden="true" data-icon="inline-start" />}{originLabel(item)}</Badge>
  </div>
 </div>;
}
export type CandidateSelection = { selected: ReadonlySet<string>; toggle: (item: OrgCandidate, checked: boolean) => void; all: boolean; some: boolean; toggleAll: (checked: boolean) => void };
export function CandidateCheckbox({ item, selection }: { item: OrgCandidate; selection: CandidateSelection }) {
 return <div data-row-action className="relative inline-flex" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><Checkbox aria-label={`Seleccionar a ${item.full_name}`} checked={selection.selected.has(candidateKey(item))} onCheckedChange={checked => selection.toggle(item, checked)} /></div>;
}
export const CandidateTableContext = createContext<{ selection: CandidateSelection; toggleSort: () => void } | null>(null);
function SelectionHeader() {
 const context = useContext(CandidateTableContext);
 return <Checkbox aria-label="Seleccionar todos" checked={context?.selection.all ?? false} indeterminate={!!context?.selection.some && !context.selection.all} onCheckedChange={context?.selection.toggleAll} />;
}
function SelectionCell({ item }: { item: OrgCandidate }) {
 const context = useContext(CandidateTableContext);
 return context ? <CandidateCheckbox item={item} selection={context.selection} /> : null;
}
function SortHeader() {
 const context = useContext(CandidateTableContext);
 return <Button variant="ghost" size="sm" aria-label="Ordenar por candidato" onClick={context?.toggleSort}>Candidato<ArrowUpDown aria-hidden="true" data-icon="inline-end" /></Button>;
}
export function candidateColumns(languages: LanguageCatalog["items"], onOpen?: OpenCandidate, selectable = false): RichColumnDef<OrgCandidate>[] {
 return [
  ...(selectable ? [{ id: "selection", size: 44, meta: { label: "Seleccionar todos", align: "center" as const }, enableHiding: false, enablePinning: false, enableReorder: false,
   header: SelectionHeader, cell: ({ row }: { row: { original: OrgCandidate } }) => <SelectionCell item={row.original} /> }] : []),
  { id: "candidate", size: 264, meta: { label: "Candidato" }, enableHiding: false,
   header: SortHeader,
   cell: ({ row }) => <CandidateIdentity item={row.original} /> },
  { id: "location", size: 158, meta: { label: "Ubicación" }, cell: ({ row }) => <TwoLineCell {...locationLines(row.original)} /> },
  { id: "experience", size: 124, meta: { label: "Experiencia" }, cell: ({ row }) => <TwoLineCell {...experienceLines(row.original)} /> },
  { id: "education", size: 202, meta: { label: "Estudios" }, cell: ({ row }) => <TwoLineCell {...educationLines(row.original)} /> },
  { id: "languages", size: 124, meta: { label: "Idiomas" }, cell: ({ row }) => <CandidateLanguages item={row.original} languages={languages} /> },
  { id: "vacancy", size: 190, meta: { label: "Última vacante", grow: true }, cell: ({ row }) => <LatestVacancyCell item={row.original} /> },
  { id: "processes", size: 116, meta: { label: "Procesos" }, cell: ({ row }) => {
   const labels = processLabels(row.original);
   return <div className="flex min-w-0 flex-col gap-1"><TruncatedText text={labels.total} className="text-sm font-medium" /><TruncatedText text={labels.active} className="text-xs text-status-success" /></div>;
  } },
  { id: "activity", size: 120, meta: { label: "Actividad" }, cell: ({ row }) => <time dateTime={row.original.last_activity_at}><TwoLineCell primary={candidateDateFormat.format(new Date(row.original.last_activity_at))} secondary={relativeTime(row.original.last_activity_at)} /></time> },
  { id: "actions", size: 56, header: () => <span className="sr-only">Acciones</span>, meta: { label: "Acciones", align: "center" }, enablePinning: false, enableHiding: false, enableReorder: false, cell: ({ row }) => <CandidateActions item={row.original} onOpen={onOpen} /> },
 ];
}
