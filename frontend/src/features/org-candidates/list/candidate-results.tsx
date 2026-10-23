"use client";
import * as React from "react";
import { ArrowUpRight, Check, Download } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RichDataTable, type RichDataTableProps } from "@/components/data-table/rich-data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ActionStatus } from "@/components/feedback/action-status";
import { getCandidateContactsAction } from "../contacts/contacts-actions";
import { CONTACTS_EXPORT_FAILURE } from "../contacts/contacts-model";
import { normalizedProfileLabel } from "@/features/pipeline-movement/profile-filter-dimensions";
import type { LanguageCatalog } from "@/features/languages/model";
import type { OrgCandidate } from "../model";
import { candidateColumns, CandidateTableContext, CandidateCheckbox, SelectAllCheckbox, type CandidateSelection } from "./candidate-columns";
import { candidateKey, languageLabels, originLabel, vacancyBadges } from "./candidate-values";
import { downloadCandidateCsv } from "./candidate-csv";

export type OpenCandidate = (candidate: Pick<OrgCandidate, "kind" | "id">) => void;
const defaultPinning = { start: ["selection", "candidate"], end: ["actions"] };
function CandidateCard({ item, languages, onOpen, selection }: { item: OrgCandidate; languages: LanguageCatalog["items"]; onOpen?: OpenCandidate; selection: CandidateSelection }) {
 // Approved v0 talent-card: identity, «location · years», language/origin tags
 // and the latest vacancy footer. The whole card opens the ficha; the
 // selection checkbox stays (user decision) so cards can still be exported.
 const years = item.profile.years_of_experience;
 const meta = [item.profile.location?.label, years !== null && `${years} ${Number(years) === 1 ? "año" : "años"}`].filter(Boolean).join(" · ");
 const spoken = languageLabels(item, languages);
 const title = item.professional_title && normalizedProfileLabel(item.professional_title);
 const latest = item.latest_participation;
 return <Card size="sm" className="relative min-w-0 gap-0 transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/40" onClick={event => {
  if (event.target instanceof Element && !event.target.closest("button,a,input,[role=checkbox],[data-row-action]")) onOpen?.({ kind: item.kind, id: item.id });
 }}>
  <CardHeader className="gap-1">
   <div className="mb-1.5 flex items-center justify-between text-muted-foreground"><Avatar className="size-10"><AvatarFallback>{initials(item.full_name)}</AvatarFallback></Avatar>
    <div className="flex items-center gap-2"><CandidateCheckbox item={item} selection={selection} /><ArrowUpRight aria-hidden="true" className="size-4" /></div></div>
   <CardTitle className="min-w-0"><h3 className="flex min-w-0 items-center gap-1.5"><Button type="button" variant="link" className="h-auto min-w-0 max-w-full shrink justify-start whitespace-normal p-0 text-left text-sm font-semibold text-foreground" aria-label={`Abrir ficha de ${item.full_name}`} onClick={() => onOpen?.({ kind: item.kind, id: item.id })}><span className="break-words">{item.full_name}</span></Button>
    {!!item.corrected_fields.length && <TooltipProvider><Tooltip><TooltipTrigger render={<span className="shrink-0 text-muted-foreground" />} tabIndex={0} aria-label="Datos corregidos por tu empresa"><Check aria-hidden="true" className="size-3.5" /></TooltipTrigger><TooltipContent>Datos corregidos por tu empresa</TooltipContent></Tooltip></TooltipProvider>}</h3></CardTitle>
   {title && <CardDescription className="break-words text-xs">{title}</CardDescription>}
   <CardDescription className="break-words text-xs">{meta || "Perfil sin completar"}</CardDescription>
  </CardHeader>
  <CardContent className="mb-3"><div data-testid="card-tags" className="mt-2.5 flex flex-wrap gap-1.5">
   {spoken[0] && <Badge variant="secondary" className="bg-muted dark:border-border">{spoken[0]}</Badge>}
   {spoken.length > 1 && <Badge variant="secondary" className="bg-muted dark:border-border" title={spoken.slice(1).join(", ")}>+{spoken.length - 1}</Badge>}
   <Badge variant="secondary" className="bg-muted dark:border-border">{originLabel(item)}</Badge>
  </div></CardContent>
  <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
   {latest ? <><span className="min-w-0 break-words">{latest.vacancy.title}</span><span className="flex flex-wrap justify-end gap-1">{vacancyBadges(item).map(badge => <Badge key={badge.text} variant={badge.variant} dot>{badge.text}</Badge>)}</span></> : <span className="text-muted-foreground">Sin participaciones</span>}
  </CardFooter>
 </Card>;
}
type CandidateResultsProps = { items: OrgCandidate[]; view: "table" | "cards"; languages: LanguageCatalog["items"]; onOpen?: OpenCandidate; toolbar?: RichDataTableProps<OrgCandidate>["toolbar"]; selectionKey?: string; fallback?: React.ReactNode };
export function CandidateResults({ items, view, languages, onOpen, toolbar, selectionKey = "", fallback }: CandidateResultsProps) {
 const [exporting, setExporting] = React.useState(false);
 const [exportFailed, setExportFailed] = React.useState(false);
 const exportBusy = React.useRef(false);
 async function exportSelected(visibleColumns: string[]) {
  if (exportBusy.current) return;
  exportBusy.current = true; setExporting(true); setExportFailed(false);
  const snapshot = sorted.filter(item => selected.has(candidateKey(item)));
  try {
   const result = await getCandidateContactsAction(snapshot.map(({ kind, id }) => ({ kind, id })));
   if (!result.ok) { setExportFailed(true); return; }
   downloadCandidateCsv(snapshot, visibleColumns, languages, result.data.items);
  } catch { setExportFailed(true); }
  finally { exportBusy.current = false; setExporting(false); }
 }
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
   <Button type="button" variant="outline" className="min-h-10" disabled={exporting} aria-busy={exporting} onClick={() => void exportSelected(visibleColumns)}>{exporting ? <Spinner aria-hidden="true" data-icon="inline-start" /> : <Download aria-hidden="true" data-icon="inline-start" />}Exportar seleccionados</Button>
   <Button type="button" variant="ghost" className="min-h-10" disabled={exporting} onClick={() => selection.toggleAll(false)}>Limpiar selección</Button>
   {exportFailed && <div className="w-full"><ActionStatus id="candidate-export-status" tone="error" text={CONTACTS_EXPORT_FAILURE} /></div>}
  </div> : null} /></CandidateTableContext.Provider>;
}
export function CandidateResultsSkeleton({ view }: { view: "table" | "cards" }) {
 if (view === "cards") return <div data-candidates-skeleton="cards" aria-hidden="true" className="grid grid-cols-1 gap-4 px-(--card-spacing) md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Card key={index} size="sm"><CardHeader><CardTitle><Skeleton className="h-10 w-40 max-w-full" /></CardTitle><CardDescription><Skeleton className="h-4 w-32 max-w-full" /></CardDescription><CardAction><Skeleton className="size-10" /></CardAction></CardHeader><CardContent className="flex flex-col gap-3"><Skeleton className="h-5 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-5 w-32 max-w-full" /><Skeleton className="h-5 w-16" /><Skeleton className="h-12 w-full" /></CardContent><CardFooter className="justify-between border-t"><Skeleton className="h-10 w-20" /><Skeleton className="h-10 w-24" /></CardFooter></Card>)}</div>;
 const columns = candidateColumns([], undefined, true);
 const width = columns.reduce((sum, column) => sum + column.size, 0);
 return <div data-candidates-skeleton="table" aria-hidden="true"><Table className="table-fixed" style={{ width, minWidth: width }}><TableHeader><TableRow>{columns.map(column => <TableHead key={column.id} style={{ width: column.size }}>{column.meta.label}</TableHead>)}</TableRow></TableHeader><TableBody>{Array.from({ length: 5 }, (_, index) => <TableRow key={index}>{columns.map(column => <TableCell key={column.id}><div className="flex min-w-0 items-center gap-2">{column.id === "candidate" && <Skeleton className="size-10 shrink-0 rounded-full" />}<Skeleton className="h-10 w-28 max-w-full" /></div></TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
