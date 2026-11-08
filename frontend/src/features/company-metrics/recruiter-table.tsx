"use client";
import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpen, ChevronRight } from "lucide-react";
import { RichDataTable, type RichColumnDef } from "@/components/data-table/rich-data-table";
import { TwoLineCell } from "@/components/data-table/truncated-text";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { accentAvatar } from "@/lib/accent";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { COLUMN_DEFINITIONS, DEFINITIONS } from "./definitions";
import { formatMedian, formatRate, NO_SAMPLE, number, personName, placementTotal, plural, type RecruiterCard } from "./model";
import { DEFAULT_SORT, nextSort, sortLabel, sortRecruiters, type RecruiterSort, type SortKey } from "./sorting";

const SortContext = createContext<{ sort: RecruiterSort; toggle: (key: SortKey) => void; href: (card: RecruiterCard) => string } | null>(null);

/** Wraps to a second line instead of cutting the label; each column size fits its longest word, the sort icon and the column menu. */
function SortHeader({ id, label }: { id: SortKey; label: string }) {
  const context = useContext(SortContext);
  const active = context?.sort.key === id;
  const Icon = !active ? ArrowUpDown : context.sort.direction === "ascending" ? ArrowUp : ArrowDown;
  return <Button type="button" variant="ghost" size="sm" className="-ml-2 h-auto min-h-7 max-w-full py-1 text-left leading-tight whitespace-normal" onClick={() => context?.toggle(id)}>{label}<Icon aria-hidden="true" data-icon="inline-end" /></Button>;
}
const sortable = (id: SortKey, label: string, size: number, cell: (card: RecruiterCard) => React.ReactNode, extra: Partial<RichColumnDef<RecruiterCard>> = {}): RichColumnDef<RecruiterCard> =>
  ({ id, size, meta: { label }, header: () => <SortHeader id={id} label={label} />, cell: ({ row }) => cell(row.original), ...extra });

function Who({ card }: { card: RecruiterCard }) {
  const context = useContext(SortContext);
  return <div className="flex min-w-0 items-center gap-3">
    <Avatar className="size-10 shrink-0"><AvatarFallback className={accentAvatar}>{initials(personName(card))}</AvatarFallback></Avatar>
    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
      <Link href={context?.href(card) ?? "#"} className="w-full min-w-0 truncate text-sm font-medium text-foreground hover:underline">{personName(card)}</Link>
      {card.former_member ? <Badge variant="neutral" title="Ya no pertenece a la empresa; su historial se conserva">Ex miembro</Badge>
        : <span className="text-[12.5px] text-muted-foreground">{`${number.format(card.vacancies.as_responsible)} como responsable`}</span>}
    </div>
  </div>;
}
function placementDetail(placements: RecruiterCard["placements"]) {
  const parts = [placements.direct && `${placements.direct} dir.`, placements.participant && `${placements.participant} part.`, placements.shared && `${placements.shared} comp.`].filter(Boolean);
  if (placements.did_not_hold) parts.push(`de ellos ${plural(placements.did_not_hold, "no se sostuvo", "no se sostuvieron")}`);
  return parts.join(" · ") || null;
}

export const recruiterColumns: RichColumnDef<RecruiterCard>[] = [
  sortable("name", "Reclutador", 240, card => <Who card={card} />, { enableHiding: false }),
  sortable("assigned", "Asignadas", 150, card => <TwoLineCell primary={number.format(card.vacancies.assigned)} secondary={plural(card.vacancies.started_in_period, "nueva", "nuevas")} />),
  sortable("on_time", "Entregas", 200, card => <TwoLineCell primary={`${number.format(card.delivery.on_time)} a tiempo`}
    secondary={card.delivery.on_time + card.delivery.late + card.delivery.overdue ? `${plural(card.delivery.late, "tarde", "tarde")} · ${plural(card.delivery.overdue, "vencida", "vencidas")}` : "Ninguna vencía en el periodo"} />),
  sortable("median", "Mediana a la meta", 160, card => <TwoLineCell primary={formatMedian(card.delivery.median_business_days_to_target)} missing={card.delivery.median_business_days_to_target === null} />),
  sortable("delivered", "Entregados", 160, card => <TwoLineCell primary={number.format(card.delivery.delivered_in_tramo)} />),
  sortable("placements", "Placements", 200, card => <TwoLineCell primary={number.format(placementTotal(card.placements))} secondary={placementDetail(card.placements)} />),
  sortable("conversion", "Conversión", 170, card => { const rate = formatRate(card.placements.conversion); return <TwoLineCell primary={rate.value} secondary={rate.detail} missing={rate.value === NO_SAMPLE} />; }),
  sortable("reassignments", "Reasignaciones", 190, card => <TwoLineCell primary={plural(card.reassignments.received, "recibida", "recibidas")} secondary={plural(card.reassignments.lost, "perdida", "perdidas")} />),
  sortable("business_days", "Días en tramos", 150, card => <TwoLineCell primary={number.format(card.business_days_in_tramos)} />),
  { id: "open", size: 56, header: () => <span className="sr-only">Ver ficha</span>, meta: { label: "Ver ficha", align: "center" }, enablePinning: false, enableHiding: false, enableReorder: false,
    cell: ({ row }) => <OpenCard card={row.original} /> },
];
function OpenCard({ card }: { card: RecruiterCard }) {
  const context = useContext(SortContext);
  return <Button variant="ghost" size="icon" className="size-10" nativeButton={false} role="link" aria-label={`Ver ficha de ${personName(card)}`} render={<Link href={context?.href(card) ?? "#"} />}><ChevronRight aria-hidden="true" /></Button>;
}

/** «Qué mide cada columna»: the definitions of the table, kept out of the headers. */
function ColumnsSheet() {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" className="min-h-10" onClick={() => setOpen(true)}><BookOpen aria-hidden="true" data-icon="inline-start" />Qué mide cada columna</Button>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader><SheetTitle>Qué mide cada columna</SheetTitle><SheetDescription>Definiciones v1. Cada columna se lee por separado; la tabla no asigna posiciones.</SheetDescription></SheetHeader>
        <dl className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {COLUMN_DEFINITIONS.map(({ column, key }) => <div key={column} className="flex flex-col gap-1">
            <dt className="text-sm font-medium">{`${column} · ${DEFINITIONS[key].title}`}</dt>
            <dd className="text-[13px] leading-relaxed">{DEFINITIONS[key].description}</dd>
            <dd className="text-xs text-muted-foreground">{DEFINITIONS[key].footer}</dd>
          </div>)}
        </dl>
      </SheetContent>
    </Sheet>
  </>;
}

/** Recruiter cards aligned as columns to compare (S4, D11): alphabetical by default, sortable by header, no score or rank. */
export function RecruiterTable({ items, href }: { items: RecruiterCard[]; href: (card: RecruiterCard) => string }) {
  const router = useRouter();
  const [sort, setSort] = useState<RecruiterSort>(DEFAULT_SORT);
  const sorted = sortRecruiters(items, sort);
  return <section aria-labelledby="metrics-recruiters" className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="metrics-recruiters" className="font-heading text-lg font-semibold">Fichas por reclutador</h2>
        <p className="text-sm text-muted-foreground">{`${plural(items.length, "persona", "personas")} con tramos en el periodo. Sin puntaje ni posición: cada columna se lee por separado y la comparación la haces tú.`}</p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-xs text-muted-foreground" aria-live="polite" data-testid="sort-label">{sortLabel(sort)}</p>
        <ColumnsSheet />
      </div>
    </div>
    <SortContext.Provider value={{ sort, toggle: key => setSort(current => nextSort(current, key)), href }}>
      <RichDataTable id="company-metrics-recruiters" columns={recruiterColumns} data={sorted} getRowId={card => card.user_id} defaultPinning={{ start: ["name"], end: ["open"] }}
        onRowActivate={card => router.push(href(card))} emptyState={null} compactControls sortState={{ id: sort.key, direction: sort.direction }} />
    </SortContext.Provider>
    <p className="text-xs text-muted-foreground">Ordenar acomoda las filas; no asigna posiciones. «Sin datos suficientes» significa que no hubo muestra en el periodo, no un cero, y esas filas van al final. Placements: dir. = crédito directo, part. = participación, comp. = compartido.</p>
  </section>;
}
