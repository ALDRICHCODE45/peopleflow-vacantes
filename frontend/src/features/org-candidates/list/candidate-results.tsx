"use client";
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
export type OpenCandidate = (candidate: Pick<OrgCandidate, "kind" | "id">) => void;
const columns = ["Nombre", "Ubicación", "Seniority", "Experiencia", "Estudios", "Idiomas", "Última vacante", "Actividad"];
const dateFormat = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Mexico_City" });
const location = (item: OrgCandidate) => item.profile.location?.label || "Sin dato";
const seniority = (item: OrgCandidate) => item.profile.seniority ? SENIORITY_LABELS[item.profile.seniority] : "Sin dato";
const years = (item: OrgCandidate) => item.profile.years_of_experience === null ? "Sin dato" : `${item.profile.years_of_experience} ${Number(item.profile.years_of_experience) === 1 ? "año" : "años"}`;
function Education({ item }: { item: OrgCandidate }) {
  const education = item.profile.education;
  return <div className="flex flex-col gap-1">{education.highest_completed && <span>{educationLabels[education.highest_completed]}</span>}{education.in_progress && <span className="text-muted-foreground">{educationLabels[education.in_progress]} · En curso</span>}{!education.highest_completed && !education.in_progress && "Sin dato"}</div>;
}
function Languages({ item, languages }: { item: OrgCandidate; languages: LanguageCatalog["items"] }) {
  return <div className="flex flex-wrap gap-1">{item.profile.languages.length ? item.profile.languages.map(language => <Badge key={language.code} variant="outline">{languages.find(entry => entry.code === language.code)?.name ?? language.code} · {language.level === "native" ? "Nativo" : language.level}</Badge>) : "Sin dato"}</div>;
}
function LatestVacancy({ item }: { item: OrgCandidate }) {
  const latest = item.latest_participation;
  if (!latest) return <span className="text-muted-foreground">Sin participaciones</span>;
  const { publication, process } = latest.vacancy.lifecycle;
  return <div className="flex flex-col gap-1.5"><span className="font-medium">{latest.vacancy.title}</span><span className="text-muted-foreground">{latest.stage.name}</span><div className="flex flex-wrap gap-1">
    {publication === "paused" && <Badge variant="review" dot>Pausada</Badge>}
    {publication === "closed" && <Badge variant="neutral" dot>Cerrada</Badge>}
    {process === "finished" && <Badge variant="neutral" dot>Proceso finalizado</Badge>}
    {latest.state === "discarded" && <Badge variant="danger" dot>Descartado</Badge>}
  </div></div>;
}
function Identity({ item, onOpen, stretch = false }: { item: OrgCandidate; onOpen?: OpenCandidate; stretch?: boolean }) {
  const Name = stretch ? "h2" : "div";
  return <div className="flex min-w-0 items-center gap-3"><Avatar className="size-10 shrink-0"><AvatarFallback>{initials(item.full_name)}</AvatarFallback></Avatar><div className="flex min-w-0 flex-col gap-1">
    <Name><Button type="button" variant="link" className={stretch ? "h-auto min-h-10 justify-start whitespace-normal text-left after:absolute after:inset-0" : "h-auto min-h-10 justify-start whitespace-normal text-left"} aria-label={`Abrir ficha de ${item.full_name}`} onClick={() => onOpen?.({ kind: item.kind, id: item.id })}>{item.full_name}</Button></Name>
    {item.professional_title && <span className="break-words text-xs text-muted-foreground">{normalizedProfileLabel(item.professional_title)}</span>}
  </div></div>;
}
const Origin = ({ item }: { item: OrgCandidate }) => <Badge variant={item.kind === "manual" ? "accent" : "secondary"}>{item.kind === "manual" ? "Manual" : "Orgánico"}</Badge>;
function Activity({ item }: { item: OrgCandidate }) { return <time dateTime={item.last_activity_at} className="text-xs tabular-nums text-muted-foreground">{dateFormat.format(new Date(item.last_activity_at))}</time>; }
export function CandidateResults({ items, view, languages, onOpen }: { items: OrgCandidate[]; view: "table" | "cards"; languages: LanguageCatalog["items"]; onOpen?: OpenCandidate }) {
  if (view === "cards") return <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Tarjetas de candidatos">{items.map(item => <Card key={`${item.kind}:${item.id}`} className="relative min-w-0 focus-within:ring-2 focus-within:ring-ring">
    <CardHeader><CardTitle><Identity item={item} onOpen={onOpen} stretch /></CardTitle><CardAction><Origin item={item} /></CardAction><CardDescription>{location(item)}</CardDescription></CardHeader>
    <CardContent className="flex flex-col gap-4 text-sm"><p><span>{seniority(item)}</span> · <span>{years(item)}</span></p><Education item={item} /><Languages item={item} languages={languages} /><LatestVacancy item={item} /></CardContent>
    <CardFooter className="flex flex-wrap justify-between gap-2"><span className="text-xs text-muted-foreground">{item.participations.total} {item.participations.total === 1 ? "proceso" : "procesos"} · {item.participations.active} {item.participations.active === 1 ? "activo" : "activos"}</span><Activity item={item} /></CardFooter>
  </Card>)}</div>;
  return <Card className="min-w-0"><CardContent><Table><TableCaption className="sr-only">Candidatos de mi organización</TableCaption><TableHeader><TableRow>{columns.map(column => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{items.map(item => <TableRow key={`${item.kind}:${item.id}`} className="cursor-pointer" onClick={event => { if (!(event.target as HTMLElement).closest("button")) onOpen?.({ kind: item.kind, id: item.id }); }}>
    <TableCell className="min-w-64"><div className="flex flex-col items-start gap-2"><Identity item={item} onOpen={onOpen} /><Origin item={item} /></div></TableCell><TableCell>{location(item)}</TableCell><TableCell>{seniority(item)}</TableCell><TableCell>{years(item)}</TableCell><TableCell className="min-w-48 whitespace-normal"><Education item={item} /></TableCell><TableCell className="min-w-36"><Languages item={item} languages={languages} /></TableCell><TableCell className="min-w-48 whitespace-normal"><LatestVacancy item={item} /></TableCell><TableCell><Activity item={item} /></TableCell>
  </TableRow>)}</TableBody></Table></CardContent></Card>;
}
export function CandidateResultsSkeleton({ view }: { view: "table" | "cards" }) {
  if (view === "cards") return <div data-candidates-skeleton="cards" aria-hidden="true" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Card key={index}><CardHeader><CardTitle><Skeleton className="h-6 w-40" /></CardTitle><CardDescription><Skeleton className="h-4 w-32" /></CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-5 w-32" /><Skeleton className="h-16 w-full" /></CardContent><CardFooter><Skeleton className="h-4 w-40" /></CardFooter></Card>)}</div>;
  return <Card data-candidates-skeleton="table" aria-hidden="true"><CardContent><Table><TableHeader><TableRow>{columns.map(column => <TableHead key={column}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{Array.from({ length: 5 }, (_, index) => <TableRow key={index}>{columns.map((column, columnIndex) => <TableCell key={column}><div className="flex items-center gap-2">{columnIndex === 0 && <Skeleton className="size-10 rounded-full" />}<Skeleton className="h-10 w-28" /></div></TableCell>)}</TableRow>)}</TableBody></Table></CardContent></Card>;
}
