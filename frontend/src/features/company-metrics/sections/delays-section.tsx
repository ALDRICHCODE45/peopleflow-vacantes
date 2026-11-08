"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarCheck, CheckCircle2, ChevronRight, Shuffle } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { drilldownHref, type Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { number, personName, REASSIGNMENT_REASON_LABEL, requesterLabel, type DelaysSection as DelaysSectionData } from "../model";
import { CHART_ACCENT, CHART_MUTED, DELIVERY_TONE } from "../palette";
import { MetricsSection } from "../section";
import type { SectionProps } from "./types";

type Href = (target: Drilldown, count: number) => string | null;
type Overdue = DelaysSectionData["overdue"]["top"][number];
type Reason = keyof DelaysSectionData["reassignments_by_reason"];

/** «Ver la 1 entrega» / «Ver las 3 entregas»: the accessible name of a drillable figure (rule 16). */
const see = (count: number, singular: string, plural: string, tail = "") => `Ver ${count === 1 ? `la 1 ${singular}` : `las ${number.format(count)} ${plural}`}${tail}`;

const HELP = [
  ["Meta de cierre", "Compara la fecha del cierre como cubierta de cada vacante con su fecha meta de cierre. «Sin meta»: vacantes cubiertas sin fecha meta."],
  ["Entregas vencidas", "Entregas cuya fecha meta ya pasó sin enviar los candidatos. Se muestran las más atrasadas; «Hace N días» cuenta días hábiles desde la fecha meta."],
  ["Reasignaciones por motivo", "Cambios de responsable en el periodo, por el motivo registrado al reasignar. Sumar o quitar colaboradores no cuenta."],
] as const;

/** Card frame of artboard 07: one job per card, `p-6`, title 15/600 with one muted caption line. */
function DelayCard({ title, caption, children }: { title: string; caption?: ReactNode; children: ReactNode }) {
  return <Card className="gap-4 p-6 xl:col-span-4">
    <div className="flex flex-col gap-1">
      <h3 className="text-[15px] leading-[22px] font-semibold">{title}</h3>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
    {children}
  </Card>;
}

/** «Retrasos y reasignaciones» (artboard 07): closing target, the most overdue deliveries and reassignments by reason. */
export function DelaysSection({ state, filters, period }: SectionProps<DelaysSectionData>) {
  const href: Href = (target, count) => drilldownHref(target, { ...filters, ...period }, { count });
  return <MetricsSection title="Retrasos y reasignaciones" state={state}
    help={{ title: "Cómo se calculan retrasos y reasignaciones", body: <dl className="flex flex-col gap-3">
      {HELP.map(([term, text]) => <div key={term} className="flex flex-col gap-1"><dt className="font-medium text-foreground">{term}</dt><dd>{text}</dd></div>)}
    </dl> }}
    skeleton={<DelaysSkeleton />}>
    {data => <div className="grid gap-6 xl:grid-cols-12">
      <ClosingTarget target={data.closing_target} href={href} />
      <OverdueDeliveries overdue={data.overdue} href={href} />
      <ReassignmentReasons reasons={data.reassignments_by_reason} href={href} />
    </div>}
  </MetricsSection>;
}

const closedFilled = (closingTarget?: string): Drilldown => ({ kind: "vacancies", params: { scope: "closed", close_reason: "filled", ...(closingTarget && { closing_target: closingTarget }) } });

function ClosingTarget({ target, href }: { target: DelaysSectionData["closing_target"]; href: Href }) {
  const total = target.on_time + target.late + target.no_target;
  const segments = [
    { key: "on_time", word: "A tiempo", value: target.on_time, tone: DELIVERY_TONE.on_time, label: see(target.on_time, "vacante cubierta a tiempo", "vacantes cubiertas a tiempo") },
    { key: "late", word: "Tarde", value: target.late, tone: DELIVERY_TONE.late, label: see(target.late, "vacante cubierta tarde", "vacantes cubiertas tarde") },
    { key: "no_target", word: "Sin meta", value: target.no_target, tone: DELIVERY_TONE.not_configured, label: see(target.no_target, "vacante cubierta sin meta", "vacantes cubiertas sin meta") },
  ].map(segment => ({ ...segment, href: href(closedFilled(segment.key), segment.value) }));
  const barLabel = `Meta de cierre: ${segments.map(segment => `${number.format(segment.value)} ${segment.word.toLowerCase()}`).join(", ")}`;
  const linked = segments.some(segment => segment.href);
  return <DelayCard title="Meta de cierre" caption={total > 0 && <>De <Figure href={href(closedFilled(), total)} label={see(total, "vacante cubierta", "vacantes cubiertas")}>{number.format(total)}</Figure> vacantes cerradas</>}>
    {total === 0 ? <SectionEmpty icon={CalendarCheck} tone="empty" title="Sin vacantes cubiertas en este periodo" description="Aquí verás si cerraron antes o después de su fecha meta." />
      : <>
        <p className="flex items-baseline gap-2">
          <Figure href={href(closedFilled("late"), target.late)} label={see(target.late, "vacante que cerró después de su meta", "vacantes que cerraron después de su meta")}
            className="text-[32px] leading-10 font-semibold tabular-nums">{number.format(target.late)}</Figure>
          <span className="text-muted-foreground">{target.late === 1 ? "cerró después de su meta" : "cerraron después de su meta"}</span>
        </p>
        <div role={linked ? "group" : "img"} aria-label={barLabel} className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
          {segments.filter(segment => segment.value > 0).map(segment => {
            const style = { width: `${(segment.value / total) * 100}%`, background: segment.tone };
            return segment.href
              ? <Link key={segment.key} href={segment.href} aria-label={segment.label} style={style} className="block h-full outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
              : <span key={segment.key} aria-hidden="true" style={style} className="block h-full" />;
          })}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
          {segments.map(segment => <li key={segment.key} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: segment.tone }} />
            {segment.word}
            <Figure href={segment.href} label={segment.label} className="font-semibold text-foreground tabular-nums">{number.format(segment.value)}</Figure>
          </li>)}
        </ul>
      </>}
  </DelayCard>;
}

const overdueList: Drilldown = { kind: "deliveries", params: { result: "overdue", sort: "business_days_overdue", order: "desc" } };

function OverdueDeliveries({ overdue, href }: { overdue: DelaysSectionData["overdue"]; href: Href }) {
  const all = href(overdueList, overdue.total);
  const allLabel = see(overdue.total, "entrega vencida", "entregas vencidas");
  return <DelayCard title="Entregas vencidas" caption={overdue.total > 0 && <><Figure href={all} label={allLabel}>{number.format(overdue.total)}</Figure> sin enviar a la fecha</>}>
    {overdue.total === 0 ? <SectionEmpty icon={CheckCircle2} tone="empty" title="Todo al día" description="Ninguna entrega tiene su fecha meta vencida." />
      : <>
        <ul className="flex flex-col divide-y">
          {overdue.top.map(row => <OverdueRow key={row.vacancy.draft_id} row={row} href={href} />)}
        </ul>
        {all && <Link href={all} className="-ml-2 mt-auto inline-flex min-h-10 items-center gap-1 self-start rounded-lg px-2 font-medium text-primary outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
          {allLabel}<ChevronRight aria-hidden="true" className="size-4" />
        </Link>}
      </>}
  </DelayCard>;
}

function OverdueRow({ row, href }: { row: Overdue; href: Href }) {
  const title = row.vacancy.title?.trim() || "Vacante sin título";
  const people = row.attributed_to?.map(person => `${personName(person)}${person.former_member ? " (Ex miembro)" : ""}`).join(", ");
  const meta = [row.requester !== undefined && requesterLabel(row.requester), people].filter(Boolean).join(" · ");
  const days = row.business_days_overdue;
  return <li className="flex min-h-14 items-center justify-between gap-4 py-2">
    <div className="flex min-w-0 flex-col">
      <Figure href={href({ kind: "deliveries", params: { result: "overdue", vacancy_id: row.vacancy.draft_id } }, 1)} label={`Ver la entrega vencida de ${title}`}
        className={cn("truncate font-medium", !row.vacancy.title?.trim() && "text-muted-foreground")}>{title}</Figure>
      {meta && <span className="truncate text-xs text-muted-foreground">{meta}</span>}
    </div>
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className="inline-flex h-[22px] items-center rounded-md border border-destructive/30 bg-destructive/10 px-2 text-xs font-medium whitespace-nowrap text-destructive">
        {`Hace ${number.format(days)} ${days === 1 ? "día" : "días"}`}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{`Entregó ${number.format(row.delivered)} de ${number.format(row.target)}`}</span>
    </div>
  </li>;
}

function ReassignmentReasons({ reasons, href }: { reasons: DelaysSectionData["reassignments_by_reason"]; href: Href }) {
  // Sorted descending (rule 8); a tie keeps the contract order.
  const sorted = (Object.keys(REASSIGNMENT_REASON_LABEL) as Reason[]).map(reason => ({ reason, value: reasons[reason] })).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, item) => sum + item.value, 0);
  const max = sorted[0]?.value ?? 0;
  return <DelayCard title="Reasignaciones por motivo" caption={total > 0 && <><Figure href={href({ kind: "reassignments", params: {} }, total)} label={see(total, "reasignación", "reasignaciones")}>{number.format(total)}</Figure> en el periodo</>}>
    {total === 0 ? <SectionEmpty icon={Shuffle} tone="empty" title="Sin reasignaciones en este periodo" description="Aquí verás los cambios de responsable por motivo." />
      : <ul className="flex flex-col gap-4">
        {sorted.map(({ reason, value }, index) => {
          const label = REASSIGNMENT_REASON_LABEL[reason];
          return <li key={reason} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            <span className="truncate font-medium">{label}</span>
            <Figure href={href({ kind: "reassignments", params: { reason } }, value)} label={see(value, "reasignación", "reasignaciones", ` por ${label.toLowerCase()}`)}
              className="text-right font-semibold tabular-nums">{number.format(value)}</Figure>
            <span aria-hidden="true" className="col-span-2 h-2.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full" style={{ width: `${max > 0 ? (value / max) * 100 : 0}%`, background: index === 0 ? CHART_ACCENT : CHART_MUTED }} />
            </span>
          </li>;
        })}
      </ul>}
  </DelayCard>;
}

/** Rule 15: the skeleton mirrors the three cards. */
function DelaysSkeleton() {
  return <div aria-hidden="true" className="grid gap-6 xl:grid-cols-12">
    {[0, 1, 2].map(index => <Card key={index} className="gap-4 p-6 xl:col-span-4">
      <div className="flex flex-col gap-2"><Skeleton className="h-5 w-36" /><Skeleton className="h-3 w-28" /></div>
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-3 w-full rounded-full" />
      <div className="flex flex-col gap-3">{[0, 1, 2].map(row => <Skeleton key={row} className="h-4 w-full" />)}</div>
    </Card>)}
  </div>;
}
