"use client";
import * as React from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RichDataTable, type RichDataTableProps } from "@/components/data-table/rich-data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { SENIORITY_LABELS } from "@/features/candidate/model";
import { educationLabels, normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import type { LanguageCatalog } from "@/features/languages/model";
import type { OrgCandidate } from "../model";
import { relativeTime } from "../relative-time";
import { candidateColumns, CandidateTableContext, CandidateActions, CandidateCheckbox, CandidateIdentity, CandidateLanguages, LatestVacancyCell, SelectAllCheckbox, type CandidateSelection } from "./candidate-columns";
import { candidateDateFormat, candidateKey, processLabels } from "./candidate-values";
import { downloadCandidateCsv } from "./candidate-csv";

export type OpenCandidate = (candidate: Pick<OrgCandidate, "kind" | "id">) => void;
const defaultPinning = { start: ["selection", "candidate"], end: ["actions"] };
function CandidateCard({ item, languages, onOpen, selection }: { item: OrgCandidate; languages: LanguageCatalog["items"]; onOpen?: OpenCandidate; selection: CandidateSelection }) {
 const { seniority, years_of_experience: years, education } = item.profile;
 const exp = [seniority && SENIORITY_LABELS[seniority], years !== null && `${years} ${Number(years) === 1 ? "año" : "años"}`].filter(Boolean).join(" · ");
 const skills = item.profile.skills.filter(skill => normalizedProfileLabel(skill));
 const hasProfile = !!(item.profile.location?.label || exp || education.highest_completed || education.in_progress || item.profile.languages.length || skills.length);
 const processes = processLabels(item);
 // v0's content surface deliberately contains a grid of candidate cards. Each
 // card is a complete entity, not another frame around the same table.
 return <Card size="sm" className="relative min-w-0 focus-within:ring-2 focus-within:ring-ring" onClick={event => {
  if (event.target instanceof Element && !event.target.closest("button,a,input,[role=checkbox],[data-row-action]")) onOpen?.({ kind: item.kind, id: item.id });
 }}>
  <CardHeader><CardTitle className="min-w-0"><CandidateIdentity item={item} onOpen={onOpen} heading /></CardTitle>
   <CardAction className="flex items-center gap-2"><CandidateCheckbox item={item} selection={selection} /><CandidateActions item={item} onOpen={onOpen} /></CardAction>
   {item.profile.location?.label && <CardDescription className="break-words">{item.profile.location.label}</CardDescription>}
  </CardHeader>
  <CardContent className="flex flex-col gap-3 text-sm">
   {exp && <p>{exp}</p>}
   {(education.highest_completed || education.in_progress) && <div className="flex flex-col gap-1">{education.highest_completed && <span>{educationLabels[education.highest_completed]}</span>}{education.in_progress ? <span className="text-xs text-muted-foreground">{educationLabels[education.in_progress]} · En curso</span> : <span className="text-xs text-muted-foreground">Concluida</span>}</div>}
   {!!item.profile.languages.length && <CandidateLanguages item={item} languages={languages} />}
   {!!skills.length && <div className="flex flex-wrap gap-1">{skills.map((skill, index) => <Badge key={index} variant="outline" className="max-w-full whitespace-normal">{skill}</Badge>)}</div>}
   {!hasProfile && <p className="text-muted-foreground">Perfil sin completar</p>}
   <LatestVacancyCell item={item} compact={false} />
  </CardContent>
  <CardFooter className="flex flex-wrap justify-between gap-3 border-t text-xs"><div className="flex flex-col gap-1"><span>{processes.total}</span><span className="text-status-success">{processes.active}</span></div><time dateTime={item.last_activity_at} className="flex flex-col gap-1 text-muted-foreground"><span>{candidateDateFormat.format(new Date(item.last_activity_at))}</span><span>{relativeTime(item.last_activity_at)}</span></time></CardFooter>
 </Card>;
}
type CandidateResultsProps = { items: OrgCandidate[]; view: "table" | "cards"; languages: LanguageCatalog["items"]; onOpen?: OpenCandidate; toolbar?: RichDataTableProps<OrgCandidate>["toolbar"]; selectionKey?: string; fallback?: React.ReactNode };
export function CandidateResults({ items, view, languages, onOpen, toolbar, selectionKey = "", fallback }: CandidateResultsProps) {
 const [selectionState, setSelection] = React.useState({ key: selectionKey, ids: new Set<string>() });
 // Derive an empty selection immediately, including browser back/forward and
 // debounced search's draft, so stale rows can never be exported after a filter.
 const selected = React.useMemo(() => selectionState.key === selectionKey ? selectionState.ids : new Set<string>(), [selectionState, selectionKey]);
 React.useEffect(() => { setSelection(previous => previous.key === selectionKey ? previous : { key: selectionKey, ids: new Set() }); }, [selectionKey]);
 const selectedItems = items.filter(item => selected.has(candidateKey(item)));
 const selection: CandidateSelection = React.useMemo(() => ({ selected,
  all: items.length > 0 && items.every(item => selected.has(candidateKey(item))), some: items.some(item => selected.has(candidateKey(item))),
  toggle: (item, checked) => setSelection(previous => { const ids = new Set(previous.key === selectionKey ? previous.ids : []); if (checked) ids.add(candidateKey(item)); else ids.delete(candidateKey(item)); return { key: selectionKey, ids }; }),
  toggleAll: checked => setSelection({ key: selectionKey, ids: new Set(checked ? items.map(candidateKey) : []) }),
 }), [selected, items, selectionKey]);
 const [direction, setDirection] = React.useState<"none" | "ascending" | "descending">("none");
 const toggleSort = React.useCallback(() => setDirection(previous => previous === "ascending" ? "descending" : "ascending"), []);
 // Column renderers stay stable so toggling a checkbox never unmounts the
 // focused control. Dynamic selection travels through context instead.
 const richColumns = React.useMemo(() => candidateColumns(languages, onOpen, true), [languages, onOpen]);
 const sorted = React.useMemo(() => direction === "none" ? items : [...items].sort((a, b) => (direction === "ascending" ? 1 : -1) * a.full_name.localeCompare(b.full_name, "es-MX")), [items, direction]);
 const content = fallback !== undefined ? fallback : view === "cards" ? <div className="flex min-w-0 flex-col gap-4 px-(--card-spacing)">
  <div className="flex items-center gap-3 text-xs text-muted-foreground"><SelectAllCheckbox all={selection.all} some={selection.some} onToggle={selection.toggleAll} />Seleccionar todos los cargados</div>
  <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Tarjetas de candidatos">{sorted.map(item => <CandidateCard key={candidateKey(item)} item={item} languages={languages} onOpen={onOpen} selection={selection} />)}</div>
 </div> : undefined;
 return <CandidateTableContext.Provider value={{ selection, toggleSort }}><RichDataTable id="org-candidates" columns={richColumns} data={sorted} getRowId={candidateKey} defaultPinning={defaultPinning} onRowActivate={onOpen ? item => onOpen({ kind: item.kind, id: item.id }) : undefined} emptyState="Sin candidatos" toolbar={toolbar} compactControls content={content} sortState={{ id: "candidate", direction }}
  beforeContent={visibleColumns => selectedItems.length > 0 ? <div aria-label="Selección de candidatos" className="mx-(--card-spacing) flex flex-wrap items-center gap-3 rounded-lg bg-muted p-3">
   <span role="status" className="mr-auto text-sm font-medium">{selectedItems.length} {selectedItems.length === 1 ? "seleccionado" : "seleccionados"}</span>
   <Button type="button" variant="outline" className="min-h-10" onClick={() => downloadCandidateCsv(sorted.filter(item => selected.has(candidateKey(item))), visibleColumns, languages)}><Download aria-hidden="true" data-icon="inline-start" />Exportar seleccionados</Button>
   <Button type="button" variant="ghost" className="min-h-10" onClick={() => selection.toggleAll(false)}>Limpiar selección</Button>
  </div> : null} /></CandidateTableContext.Provider>;
}
export function CandidateResultsSkeleton({ view }: { view: "table" | "cards" }) {
 if (view === "cards") return <div data-candidates-skeleton="cards" aria-hidden="true" className="grid grid-cols-1 gap-4 px-(--card-spacing) md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Card key={index} size="sm"><CardHeader><CardTitle><Skeleton className="h-10 w-40 max-w-full" /></CardTitle><CardDescription><Skeleton className="h-4 w-32 max-w-full" /></CardDescription><CardAction><Skeleton className="size-10" /></CardAction></CardHeader><CardContent className="flex flex-col gap-3"><Skeleton className="h-5 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-5 w-32 max-w-full" /><Skeleton className="h-5 w-16" /><Skeleton className="h-12 w-full" /></CardContent><CardFooter className="justify-between border-t"><Skeleton className="h-10 w-20" /><Skeleton className="h-10 w-24" /></CardFooter></Card>)}</div>;
 const columns = candidateColumns([], undefined, true);
 const width = columns.reduce((sum, column) => sum + column.size, 0);
 return <div data-candidates-skeleton="table" aria-hidden="true"><Table className="table-fixed" style={{ width, minWidth: width }}><TableHeader><TableRow>{columns.map(column => <TableHead key={column.id} style={{ width: column.size }}>{column.meta.label}</TableHead>)}</TableRow></TableHeader><TableBody>{Array.from({ length: 5 }, (_, index) => <TableRow key={index}>{columns.map(column => <TableCell key={column.id}><div className="flex min-w-0 items-center gap-2">{column.id === "candidate" && <Skeleton className="size-10 shrink-0 rounded-full" />}<Skeleton className="h-10 w-28 max-w-full" /></div></TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
