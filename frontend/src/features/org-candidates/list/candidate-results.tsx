"use client";
import * as React from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { SENIORITY_LABELS } from "@/features/candidate/model";
import { educationLabels, normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import type { LanguageCatalog } from "@/features/languages/model";
import type { OrgCandidate } from "../model";
import { cn } from "@/lib/utils";

export type OpenCandidate = (candidate: Pick<OrgCandidate, "kind" | "id">) => void;
// Fixed proportions, not intrinsic minimum widths: all seven columns fit beside
// the expanded sidebar. Location yields space on smaller desktop viewports.
const columns = [
  { label: "Nombre", width: "w-[24%]" },
  { label: "Ubicación", width: "hidden w-[13%] xl:table-cell" },
  { label: "Experiencia", width: "w-[12%]" },
  { label: "Estudios", width: "w-[14%]" },
  { label: "Idiomas", width: "w-[12%]" },
  { label: "Última vacante", width: "w-[16%]" },
  { label: "Actividad", width: "w-[9%]" },
];
const cellClass = "whitespace-normal break-words";
const missing = <span className="text-muted-foreground">Sin dato</span>;
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
function experience(item: OrgCandidate) {
  const { seniority, years_of_experience: years } = item.profile;
  return [seniority && SENIORITY_LABELS[seniority], years !== null && `${years} ${Number(years) === 1 ? "año" : "años"}`].filter(Boolean).join(" · ");
}
/** Experience parts never break inside («4.5» and «años» stay together); only the « · » joint may wrap. */
function Experience({ item }: { item: OrgCandidate }) {
  const parts = experience(item).split(" · ").filter(Boolean);
  if (!parts.length) return missing;
  return <>{parts.map((part, index) => <React.Fragment key={part}>{index > 0 && " · "}<span className="whitespace-nowrap">{part}</span></React.Fragment>)}</>;
}
function hasEducation(item: OrgCandidate) {
  return !!(item.profile.education.highest_completed || item.profile.education.in_progress);
}
function Education({ item }: { item: OrgCandidate }) {
  const education = item.profile.education;
  return <div className="flex flex-col gap-1">{education.highest_completed && <span>{educationLabels[education.highest_completed]}</span>}{education.in_progress && <span className="text-muted-foreground">{educationLabels[education.in_progress]} · En curso</span>}{!hasEducation(item) && missing}</div>;
}
function Languages({ item, languages }: { item: OrgCandidate; languages: LanguageCatalog["items"] }) {
  // Same catalog name + CEFR/native label and fallback as candidate-sheet's pills.
  return <div className="flex flex-wrap gap-1">{item.profile.languages.length ? item.profile.languages.map(language => <Badge key={language.code} variant="outline" className="max-w-full whitespace-normal">{languages.find(entry => entry.code === language.code)?.name ?? "Idioma no disponible"} {language.level === "native" ? "Nativo" : language.level}</Badge>) : missing}</div>;
}
function LatestVacancy({ item }: { item: OrgCandidate }) {
  const latest = item.latest_participation;
  if (!latest) return <span className="text-muted-foreground">Sin participaciones</span>;
  const { publication, process } = latest.vacancy.lifecycle;
  return <div className="flex min-w-0 flex-col gap-1.5"><span className="break-words font-medium">{latest.vacancy.title}</span><span className="break-words text-muted-foreground">{latest.stage.name}</span><div className="flex flex-wrap gap-1 [&>[data-slot=badge]]:max-w-full [&>[data-slot=badge]]:whitespace-normal">
    {publication === "paused" && <Badge variant="review" dot>Pausada</Badge>}
    {publication === "closed" && <Badge variant="neutral" dot>Cerrada</Badge>}
    {process === "finished" && <Badge variant="neutral" dot>Proceso finalizado</Badge>}
    {latest.state === "discarded" && <Badge variant="danger" dot>Descartado</Badge>}
  </div></div>;
}
function Identity({ item, onOpen, stretch = false }: { item: OrgCandidate; onOpen?: OpenCandidate; stretch?: boolean }) {
  const Name = stretch ? "h3" : "div";
  return <div className="flex min-w-0 items-start gap-3"><Avatar className="size-10 shrink-0"><AvatarFallback>{initials(item.full_name)}</AvatarFallback></Avatar><div className="flex min-w-0 flex-1 flex-col items-start gap-1">
    {/* Offset the link's native inset with layout margins so its text, subtitle
        and origin align, without replacing the shared Button's padding/focus. */}
    <Name className="w-full"><Button type="button" variant="link" className={cn("-mx-3 h-auto min-h-10 max-w-[calc(100%+1.5rem)] justify-start whitespace-normal break-words text-left font-medium text-foreground", stretch && "after:absolute after:inset-0")} aria-label={`Abrir ficha de ${item.full_name}`} onClick={() => onOpen?.({ kind: item.kind, id: item.id })}>{item.full_name}</Button></Name>
    {item.professional_title && <span className="break-words text-xs text-muted-foreground">{normalizedProfileLabel(item.professional_title)}</span>}
    {!stretch && <Origin item={item} />}
  </div></div>;
}
const Origin = ({ item }: { item: OrgCandidate }) => <Badge variant="accent">{item.kind === "manual" ? "Manual" : "Orgánico"}</Badge>;
function Activity({ item }: { item: OrgCandidate }) { return <time dateTime={item.last_activity_at} className="text-xs tabular-nums text-muted-foreground">{dateFormat.format(new Date(item.last_activity_at))}</time>; }
function CandidateCard({ item, languages, onOpen }: { item: OrgCandidate; languages: LanguageCatalog["items"]; onOpen?: OpenCandidate }) {
  const exp = experience(item);
  const skills = item.profile.skills.filter(skill => normalizedProfileLabel(skill));
  const hasProfile = !!(item.profile.location?.label || exp || hasEducation(item) || item.profile.languages.length || skills.length);
  return <Card className="relative min-w-0 focus-within:ring-2 focus-within:ring-ring">
    <CardHeader><CardTitle className="min-w-0"><Identity item={item} onOpen={onOpen} stretch /></CardTitle><CardAction><Origin item={item} /></CardAction>{item.profile.location?.label && <CardDescription className="break-words">{item.profile.location.label}</CardDescription>}</CardHeader>
    <CardContent className="flex flex-col gap-4 text-sm">
      {exp && <p>{exp}</p>}
      {hasEducation(item) && <Education item={item} />}
      {!!item.profile.languages.length && <Languages item={item} languages={languages} />}
      {!!skills.length && <div className="flex flex-wrap gap-1">{skills.map((skill, index) => <Badge key={index} variant="outline" className="max-w-full whitespace-normal">{skill}</Badge>)}</div>}
      {!hasProfile && <p className="text-muted-foreground">Perfil sin completar</p>}
      <LatestVacancy item={item} />
    </CardContent>
    <CardFooter className="flex flex-wrap justify-between gap-2"><span className="text-xs text-muted-foreground">{item.participations.total} {item.participations.total === 1 ? "proceso" : "procesos"} · {item.participations.active} {item.participations.active === 1 ? "activo" : "activos"}</span><Activity item={item} /></CardFooter>
  </Card>;
}
export function CandidateResults({ items, view, languages, onOpen }: { items: OrgCandidate[]; view: "table" | "cards"; languages: LanguageCatalog["items"]; onOpen?: OpenCandidate }) {
  if (view === "cards") return <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Tarjetas de candidatos">{items.map(item => <CandidateCard key={`${item.kind}:${item.id}`} item={item} languages={languages} onOpen={onOpen} />)}</div>;
  return <Card className="min-w-0"><CardContent><Table className="table-fixed"><TableCaption className="sr-only">Candidatos de mi organización</TableCaption><TableHeader><TableRow>{columns.map(column => <TableHead key={column.label} className={cn(column.width, "whitespace-normal")}>{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={`${item.kind}:${item.id}`} className="cursor-pointer" onClick={event => { if (!(event.target as HTMLElement).closest("button")) onOpen?.({ kind: item.kind, id: item.id }); }}>
    <TableCell className={cellClass}><Identity item={item} onOpen={onOpen} /></TableCell>
    <TableCell className={cn(cellClass, "hidden xl:table-cell")}>{item.profile.location?.label || missing}</TableCell>
    <TableCell className={cellClass}><Experience item={item} /></TableCell>
    <TableCell className={cellClass}><Education item={item} /></TableCell>
    <TableCell className={cellClass}><Languages item={item} languages={languages} /></TableCell>
    <TableCell className={cellClass}><LatestVacancy item={item} /></TableCell>
    <TableCell className={cellClass}><Activity item={item} /></TableCell>
  </TableRow>)}</TableBody></Table></CardContent></Card>;
}
export function CandidateResultsSkeleton({ view }: { view: "table" | "cards" }) {
  if (view === "cards") return <div data-candidates-skeleton="cards" aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Card key={index}><CardHeader><CardTitle><Skeleton className="h-6 w-40 max-w-full" /></CardTitle><CardDescription><Skeleton className="h-4 w-32 max-w-full" /></CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-5 w-32 max-w-full" /><Skeleton className="h-16 w-full" /></CardContent><CardFooter><Skeleton className="h-4 w-40 max-w-full" /></CardFooter></Card>)}</div>;
  return <Card data-candidates-skeleton="table" aria-hidden="true"><CardContent><Table className="table-fixed"><TableHeader><TableRow>{columns.map(column => <TableHead key={column.label} className={cn(column.width, "whitespace-normal")}>{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{Array.from({ length: 5 }, (_, index) => <TableRow key={index}>{columns.map((column, columnIndex) => <TableCell key={column.label} className={cn(cellClass, columnIndex === 1 && "hidden xl:table-cell")}><div className="flex min-w-0 items-center gap-2">{columnIndex === 0 && <Skeleton className="size-10 shrink-0 rounded-full" />}<Skeleton className="h-10 w-28 max-w-full" /></div></TableCell>)}</TableRow>)}</TableBody></Table></CardContent></Card>;
}
