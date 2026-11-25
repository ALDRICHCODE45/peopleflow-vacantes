"use client";
import Link from "next/link";
import { ChevronRight, Users } from "lucide-react";
import { STACKED_CELL, STACKED_TABLE } from "@/components/data-table/stacked-table";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accentAvatar } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { initials } from "@/features/pipeline-movement/pipeline-presentation";
import { drilldownHref, type Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { formatRate, NO_SAMPLE, number, onTimeRate, personName, placementTotal, type RecruiterCard } from "../model";
import type { Period } from "../period";
import { ProcessNote } from "../process-kind";
import { tablePath } from "../recruiter-view";
import { MetricsSection } from "../section";
import { sortRecruiters } from "../sorting";
import { serializeFilters, type MetricsFilters } from "../url-state";
import type { SectionProps } from "./types";

/** Rows shown on the board (rule 12); «Ver tabla completa» links to the table page with every person and every column. */
const VISIBLE_ROWS = 5;

const HELP = [
  ["Vacantes asignadas", "Vacantes donde la persona tuvo un tramo como responsable o integrante durante el periodo."],
  ["Entregas a tiempo", "Entregas a tiempo entre las entregas con fecha cumplida de sus vacantes (a tiempo, tarde o vencidas). El porcentaje abre las entregas a tiempo; «N de M» abre todas."],
  ["Placements", "Contrataciones acreditadas a la persona: directas, por participación o compartidas."],
  ["Conversión", "Vacantes con al menos un placement suyo entre sus vacantes cerradas en el periodo."],
  ["Orden", "De mayor a menor porcentaje de entregas a tiempo; quien no tuvo entregas con fecha va al final. Ordenar no asigna posiciones."],
] as const;

/** Highest on-time rate first (then the larger count), rows without a sample last: the table's order for «Entregas a tiempo» (S3). */
export const byOnTime = (items: RecruiterCard[]): RecruiterCard[] => sortRecruiters(items, { key: "on_time", direction: "descending" });
/** The existing recruiter detail route with the board period and the process filter (the page reads no other filter). */
export const recruiterHref = (card: Pick<RecruiterCard, "user_id">, scope: Period & Pick<MetricsFilters, "process_kind">) => `/empresa/metricas/reclutadores/${card.user_id}?${serializeFilters(scope)}`;
/** «Vacantes asignadas» and «Conversión» are vacancy level (replacement-processes-v1 «Metrics»): the process filter does not change them. */
const IGNORED_COLUMNS = "«Vacantes asignadas» y «Conversión» no cambian con el filtro de proceso.";

type Href = (target: Drilldown, count: number) => string | null;

/** «Desempeño por reclutador» (artboard 07): a six-column comparison, the first five rows, the full table on its own page (S2). */
export function RecruitersSection({ state, filters, period }: SectionProps<RecruiterCard[]>) {
  const items = state.data ?? [];
  const href: Href = (target, count) => drilldownHref(target, { ...filters, ...period } satisfies MetricsFilters, { count });
  const scope = { ...period, process_kind: filters.process_kind };
  return <MetricsSection title="Desempeño por reclutador" state={state} helpFirst
    help={{ title: "Cómo se calcula por reclutador", body: <dl className="flex flex-col gap-3">
      {HELP.map(([term, text]) => <div key={term} className="flex flex-col gap-1"><dt className="font-medium text-foreground">{term}</dt><dd>{text}</dd></div>)}
    </dl> }}
    actions={state.status !== "failed" && items.length > 0 && <Button variant="ghost" className="min-h-10" nativeButton={false} role="link" render={<Link href={tablePath({ ...filters, ...period })} />}>
      Ver tabla completa<ChevronRight aria-hidden="true" data-icon="inline-end" />
    </Button>}
    skeleton={<RecruitersSkeleton />}>
    {data => <>
      <Card className="gap-4 p-6">
        {data.length === 0 ? <SectionEmpty icon={Users} tone="empty" title="Aún no hay reclutadores con actividad en este periodo" description="Aquí verás la comparación por persona cuando tengan vacantes asignadas." />
          : <Table className={cn("text-sm", STACKED_TABLE)}>
            <caption className="sr-only">Reclutadores ordenados por entregas a tiempo</caption>
            <TableHeader className="[&_tr]:border-0">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-auto pb-3 pl-0 text-xs text-muted-foreground">Reclutador</TableHead>
                <TableHead className="h-auto pb-3 text-right text-xs text-muted-foreground">Vacantes asignadas</TableHead>
                <TableHead className="h-auto pb-3 text-right text-xs text-muted-foreground">Entregas a tiempo</TableHead>
                <TableHead className="h-auto pb-3 text-right text-xs text-muted-foreground">Placements</TableHead>
                <TableHead className="h-auto pb-3 text-right text-xs text-muted-foreground">Conversión</TableHead>
                <TableHead className="h-auto w-14 pr-0 pb-3"><span className="sr-only">Detalle</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr]:border-t [&_tr]:border-b-0">
              {byOnTime(data).slice(0, VISIBLE_ROWS).map(card => <RecruiterRow key={card.user_id} card={card} detail={recruiterHref(card, scope)} href={href} />)}
            </TableBody>
          </Table>}
        <ProcessNote filters={filters}>{IGNORED_COLUMNS}</ProcessNote>
      </Card>
    </>}
  </MetricsSection>;
}

function RecruiterRow({ card, detail, href }: { card: RecruiterCard; detail: string; href: Href }) {
  const name = personName(card);
  const user = card.user_id;
  const onTime = onTimeRate(card);
  const onTimeText = formatRate(onTime);
  const conversion = card.placements.conversion;
  const conversionText = formatRate(conversion);
  const placements = placementTotal(card.placements);
  // Rule 14: below `md` the row is the name, the on-time rate (the ranking's figure) and the chevron; the other figures
  // wait for the wide table and the recruiter page.
  const cell = cn("h-14 px-3 text-right tabular-nums", STACKED_CELL);
  const narrowHidden = "max-md:hidden";
  const delivered = (result: string): Drilldown => ({ kind: "deliveries", params: { attributed_to: user, result } });
  const closed = (credited: boolean): Drilldown => ({ kind: "vacancies", params: { scope: "closed_assigned", recruiter_id: user, ...(credited && { credited_to: user }) } });
  return <TableRow className="hover:bg-muted/60 max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto_40px] max-md:items-center max-md:gap-x-3 max-md:py-2">
    <TableCell className="h-14 pr-3 pl-0 max-md:col-start-1 max-md:row-start-1 max-md:block max-md:h-auto max-md:min-w-0 max-md:p-0 max-md:whitespace-normal">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-medium", accentAvatar)}>{initials(name)}</span>
        {/* Rule 14: below `md` the name wraps rather than give way to the figure beside it. TableCell sets `whitespace-nowrap`, so the name cell resets it (`max-md:whitespace-normal`); the figure cell keeps it and its `auto` column never shrinks below its content. */}
        <span className="min-w-0 md:truncate max-md:break-words">
          <Link href={detail} className="rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring">{name}</Link>
          {card.former_member && <span className="text-muted-foreground"> (Ex miembro)</span>}
        </span>
      </div>
    </TableCell>
    <TableCell data-label="Vacantes asignadas" className={cn(cell, narrowHidden)}>
      <Figure href={href({ kind: "vacancies", params: { scope: "assigned", recruiter_id: user } }, card.vacancies.assigned)}
        label={`Ver ${card.vacancies.assigned === 1 ? "la 1 vacante asignada" : `las ${number.format(card.vacancies.assigned)} vacantes asignadas`} a ${name}`}>{number.format(card.vacancies.assigned)}</Figure>
    </TableCell>
    <TableCell data-label="Entregas a tiempo" className="h-14 px-3 text-right tabular-nums max-md:col-start-2 max-md:row-start-1 max-md:block max-md:h-auto max-md:p-0">
      {onTime.value === null ? <span className="text-muted-foreground max-md:block max-md:max-w-20 max-md:text-xs max-md:leading-4 max-md:whitespace-normal">{NO_SAMPLE}</span>
        : <span className="inline-flex items-center justify-end gap-3 max-md:gap-1">
          <span aria-hidden="true" className="h-2 w-28 overflow-hidden rounded-full bg-muted max-md:hidden">
            <span className="block h-full rounded-full" style={{ width: `${onTime.value * 100}%`, background: "color-mix(in oklab, var(--primary) 60%, var(--pf-tint-base))" }} />
          </span>
          <Figure href={href(delivered("on_time"), onTime.numerator)} className="min-w-10 font-semibold"
            label={`${onTimeText.value} a tiempo: ver ${onTime.numerator === 1 ? "la 1 entrega a tiempo" : `las ${number.format(onTime.numerator)} entregas a tiempo`} de ${name}`}>{onTimeText.value}</Figure>
          {/* Below `md` the header is hidden, so the one figure says what it is. */}
          {" "}<span aria-hidden="true" className="text-xs text-muted-foreground md:hidden">a tiempo</span>
          <Figure href={href(delivered("on_time,late,overdue"), onTime.denominator)} className="min-w-16 text-muted-foreground max-md:hidden"
            label={`${onTimeText.detail}: ver ${onTime.denominator === 1 ? "la 1 entrega con fecha" : `las ${number.format(onTime.denominator)} entregas con fecha`} de ${name}`}>{onTimeText.detail}</Figure>
        </span>}
    </TableCell>
    <TableCell data-label="Placements" className={cn(cell, narrowHidden)}>
      <Figure href={href({ kind: "placements", params: { recipient: user } }, placements)}
        label={`Ver ${placements === 1 ? "el 1 placement" : `los ${number.format(placements)} placements`} de ${name}`}>{number.format(placements)}</Figure>
    </TableCell>
    <TableCell data-label="Conversión" className={cn(cell, narrowHidden)}>
      {conversion.value === null ? <span className="text-muted-foreground">{NO_SAMPLE}</span>
        : <>
          <Figure href={href(closed(true), conversion.numerator)} className="font-semibold"
            label={`${conversionText.value} de conversión: ver ${conversion.numerator === 1 ? "la 1 vacante cerrada" : `las ${number.format(conversion.numerator)} vacantes cerradas`} con placement de ${name}`}>{conversionText.value}</Figure>
          <span className="text-muted-foreground">{" · "}
            <Figure href={href(closed(false), conversion.denominator)}
              label={`${conversionText.detail}: ver ${conversion.denominator === 1 ? "la 1 vacante cerrada" : `las ${number.format(conversion.denominator)} vacantes cerradas`} de ${name}`}>{conversionText.detail}</Figure>
          </span>
        </>}
    </TableCell>
    <TableCell className="h-14 w-14 pr-0 pl-3 max-md:col-start-3 max-md:row-start-1 max-md:block max-md:h-auto max-md:w-auto max-md:p-0">
      <Button variant="ghost" size="icon" className="ml-auto flex size-10 text-muted-foreground" nativeButton={false} role="link" aria-label={`Ver detalle de ${name}`} render={<Link href={detail} />}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </TableCell>
  </TableRow>;
}

/** Rule 15: the skeleton mirrors the table card, header and five rows. */
function RecruitersSkeleton() {
  return <Card aria-hidden="true" className="gap-4 p-6">
    <div className="flex justify-between gap-6"><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-1/2" /></div>
    {[0, 1, 2, 3, 4].map(row => <div key={row} className="flex h-14 items-center gap-3 border-t">
      <Skeleton className="size-8 rounded-full" /><Skeleton className="h-4 w-40" />
      <Skeleton className="ml-auto h-4 w-10" /><Skeleton className="h-2 w-28 rounded-full" /><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-10" /><Skeleton className="h-4 w-20" />
    </div>)}
  </Card>;
}
