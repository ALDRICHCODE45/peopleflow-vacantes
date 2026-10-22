"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RichColumnDef } from "@/components/data-table/rich-data-table";
import { TruncatedText, TwoLineCell } from "@/components/data-table/truncated-text";
import { SENIORITY_LABELS } from "@/features/candidate/model";
import { educationLabels, normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import { cn } from "@/lib/utils";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import type { LanguageCatalog } from "@/features/languages/model";
import type { OrgCandidate } from "../model";
import type { OpenCandidate } from "./candidate-results";

const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
const relativeFormat = new Intl.RelativeTimeFormat("es-MX", { numeric: "always" });
function relativeActivity(value: string) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  if (Math.abs(seconds) < 60) return relativeFormat.format(seconds, "second");
  if (Math.abs(seconds) < 3600) return relativeFormat.format(Math.trunc(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400) return relativeFormat.format(Math.trunc(seconds / 3600), "hour");
  return relativeFormat.format(Math.trunc(seconds / 86400), "day");
}
function CandidateLanguages({ item, languages }: { item: OrgCandidate; languages: LanguageCatalog["items"] }) {
  const labels = item.profile.languages.map(language => `${languages.find(entry => entry.code === language.code)?.name ?? "Idioma no disponible"} ${language.level === "native" ? "Nativo" : language.level}`);
  if (!labels.length) return <TwoLineCell primary="Sin dato" missing />;
  return <div className="flex min-w-0 items-center gap-2">
    <TruncatedText text={labels[0]} className="text-sm font-medium text-foreground" />
    {labels.length > 1 && <TooltipProvider><Tooltip><TooltipTrigger render={<span className="shrink-0 text-[12.5px] text-muted-foreground" />} tabIndex={0} aria-label={`${labels.length - 1} idiomas más`}>+{labels.length - 1}</TooltipTrigger>
      <TooltipContent role="tooltip"><div className="flex flex-col gap-1">{labels.map((label, index) => <span key={index}>{label}</span>)}</div></TooltipContent>
    </Tooltip></TooltipProvider>}
  </div>;
}
function LatestVacancyCell({ item }: { item: OrgCandidate }) {
  const latest = item.latest_participation;
  if (!latest) return <TwoLineCell primary="Sin participaciones" missing />;
  // Candidate outcome takes precedence over vacancy lifecycle when both are terminal.
  const status = latest.state === "discarded" ? { text: "Descartado", color: "bg-destructive" }
    : latest.vacancy.lifecycle.process === "finished" ? { text: "Proceso finalizado", color: "bg-muted-foreground" }
    : latest.vacancy.lifecycle.publication === "closed" ? { text: "Cerrada", color: "bg-muted-foreground" }
    : latest.vacancy.lifecycle.publication === "paused" ? { text: "Pausada", color: "bg-status-review" }
    : { text: "Activa", color: "bg-status-success" };
  return <div className="flex min-w-0 flex-col gap-1">
    <TruncatedText text={latest.vacancy.title} className="text-sm font-medium text-foreground" />
    <div className="flex min-w-0 items-center gap-1.5"><span data-status-dot aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", status.color)} /><TruncatedText text={`${latest.stage.name.trim()} · ${status.text}`} className="text-[12.5px] text-muted-foreground" /></div>
  </div>;
}
function CandidateActions({ item, onOpen }: { item: OrgCandidate; onOpen?: OpenCandidate }) {
  return <div data-row-action onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" className="size-10" aria-label={`Acciones de ${item.full_name}`} />}><Ellipsis aria-hidden="true" /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60"><DropdownMenuGroup>
        <DropdownMenuItem className="min-h-10" onClick={() => onOpen?.({ kind: item.kind, id: item.id })}>Ver ficha</DropdownMenuItem>
        {item.latest_participation && <DropdownMenuItem className="min-h-10" render={<Link href={`/empresa/vacantes/${item.latest_participation.vacancy.id}/pipeline`} />}>Abrir tablero de la vacante</DropdownMenuItem>}
      </DropdownMenuGroup></DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

/** Keep the existing avatar, cell padding and visual density; each datum has at most two single-line tiers. */
export function candidateColumns(languages: LanguageCatalog["items"], onOpen?: OpenCandidate): RichColumnDef<OrgCandidate>[] {
  return [
    { id: "candidate", size: 250, meta: { label: "Candidato" }, enableHiding: false, cell: ({ row }) => {
      const item = row.original;
      return <div className="flex min-w-0 items-center gap-3"><Avatar className="size-10 shrink-0"><AvatarFallback>{initials(item.full_name)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><TwoLineCell primary={item.full_name} secondary={normalizedProfileLabel(item.professional_title ?? "") || (item.kind === "manual" ? "Manual" : "Orgánico")} /></div></div>;
    } },
    { id: "location", size: 140, meta: { label: "Ubicación" }, cell: ({ row }) => {
      const location = row.original.profile.location;
      const primary = [location?.municipality?.name, location?.state?.name].filter(Boolean).join(", ") || location?.label || location?.country?.name;
      return <TwoLineCell primary={primary || "Sin dato"} secondary={location?.country?.name !== primary ? location?.country?.name : null} missing={!primary} />;
    } },
    { id: "experience", size: 112, meta: { label: "Experiencia" }, cell: ({ row }) => {
      const { years_of_experience: years, seniority } = row.original.profile;
      return <TwoLineCell primary={years !== null ? `${years} ${Number(years) === 1 ? "año" : "años"}` : "Sin dato"} secondary={seniority ? SENIORITY_LABELS[seniority] : null} missing={years === null} />;
    } },
    { id: "education", size: 180, meta: { label: "Estudios" }, cell: ({ row }) => {
      const education = row.original.profile.education;
      return <TwoLineCell primary={education.highest_completed ? educationLabels[education.highest_completed] : "Sin dato"} secondary={education.in_progress ? `${educationLabels[education.in_progress]} en curso` : null} missing={!education.highest_completed} />;
    } },
    { id: "languages", size: 120, meta: { label: "Idiomas" }, cell: ({ row }) => <CandidateLanguages item={row.original} languages={languages} /> },
    { id: "vacancy", size: 180, meta: { label: "Última vacante" }, cell: ({ row }) => <LatestVacancyCell item={row.original} /> },
    { id: "processes", size: 100, meta: { label: "Procesos" }, cell: ({ row }) => <TwoLineCell primary={`${row.original.participations.total} ${row.original.participations.total === 1 ? "proceso" : "procesos"}`} secondary={`${row.original.participations.active} ${row.original.participations.active === 1 ? "activo" : "activos"}`} /> },
    { id: "activity", size: 112, meta: { label: "Actividad" }, cell: ({ row }) => <time dateTime={row.original.last_activity_at}><TwoLineCell primary={dateFormat.format(new Date(row.original.last_activity_at))} secondary={relativeActivity(row.original.last_activity_at)} /></time> },
    { id: "actions", size: 56, header: () => <span className="sr-only">Acciones</span>, meta: { label: "Acciones", align: "center" }, enablePinning: false, enableHiding: false, enableReorder: false, cell: ({ row }) => <CandidateActions item={row.original} onOpen={onOpen} /> },
  ];
}
