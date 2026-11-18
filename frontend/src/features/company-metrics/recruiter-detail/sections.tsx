"use client";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Drilldown } from "../drilldown";
import { Figure } from "../figure";
import { formatMedian, formatRate, NO_SAMPLE, number, placementTotal, type Rate, type RecruiterDetail } from "../model";
import { DELIVERY_TONE } from "../palette";
import { MetricsSection } from "../section";
import type { SectionState } from "../use-section";
import { CardSkeleton, HelpList, INLINE_FIGURE, KPI_LINE, KPI_MISSING, KPI_VALUE, KpiCard, MetricCard, Rows, see, SplitBars, type Drill, type Who } from "./parts";

export type DetailState = Pick<SectionState<RecruiterDetail>, "status" | "data" | "stale" | "failure" | "ref" | "retry">;
type Props = { state: DetailState; drill: Drill; who: Who };

/** The queries behind each figure (artboard 10 `data-dd`), all accepted by `detail/query.ts`. */
export function targets(id: string) {
  const deliveries = (result: string): Drilldown => ({ kind: "deliveries", params: { attributed_to: id, result } });
  return {
    assigned: { kind: "vacancies", params: { scope: "assigned", recruiter_id: id } },
    onTime: deliveries("on_time"), late: deliveries("late"), overdue: deliveries("overdue"), due: deliveries("on_time,late,overdue"),
    closedCredited: { kind: "vacancies", params: { scope: "closed_assigned", recruiter_id: id, credited_to: id } },
    closed: { kind: "vacancies", params: { scope: "closed_assigned", recruiter_id: id } },
    placements: { kind: "placements", params: { recipient: id } },
    held: { kind: "placements", params: { recipient: id, held: "true" } },
    notHeld: { kind: "placements", params: { recipient: id, held: "false" } },
    received: { kind: "reassignments", params: { recruiter_id: id, direction: "received" } },
    lost: { kind: "reassignments", params: { recruiter_id: id, direction: "lost" } },
  } satisfies Record<string, Drilldown>;
}

const lower = (label: string) => `v${label.slice(1)}`;
/** On time among the judged deliveries (on time, late, overdue); pending ones do not count yet. */
export const onTimeRate = ({ delivery }: RecruiterDetail): Rate => {
  const denominator = delivery.on_time + delivery.late + delivery.overdue;
  return { value: denominator > 0 ? delivery.on_time / denominator : null, numerator: delivery.on_time, denominator };
};
const STRIP = "grid grid-cols-2 gap-6 max-md:gap-3 lg:grid-cols-12";
const PAIR = "grid gap-6 lg:grid-cols-12";

/** «Resumen»: four KPIs, one context line each, no ⓘ (rule 6). */
export function SummarySection({ state, drill, who }: Props) {
  return <MetricsSection title="Resumen" state={state} skeleton={<StripSkeleton />} help={{ title: "Cómo se calcula el resumen", body: <HelpList items={[
    ["Vacantes asignadas", `Vacantes publicadas al menos una vez con un tramo de ${who.first} que se cruza con el periodo. Cuenta una vez aunque haya salido y vuelto. «Nuevas» son las que empezaron en el periodo.`],
    ["Entregas a tiempo", "Entregas a tiempo entre las ya juzgadas: a tiempo, tarde y vencidas. Las pendientes todavía no cuentan."],
    ["Conversión a placement", `Vacantes con al menos un placement acreditado a ${who.first} entre las que tuvo asignadas y cerraron en el periodo. Si ninguna cerró, no hay porcentaje.`],
    ["Placements", `Contrataciones con fecha en el periodo acreditadas a ${who.first}, activas o que no se sostuvieron; las anuladas no cuentan.`],
  ]} /> }}>
    {data => <Strip data={data} drill={drill} who={who} />}
  </MetricsSection>;
}

function Strip({ data, drill, who }: { data: RecruiterDetail; drill: Drill; who: Who }) {
  const t = targets(who.id);
  const assigned = data.vacancies.assigned;
  const onTime = onTimeRate(data);
  const onTimeText = formatRate(onTime);
  const conversion = data.placements.conversion;
  const conversionText = formatRate(conversion);
  const placements = placementTotal(data.placements);
  const notHeld = data.placements.did_not_hold;
  const held = placements - notHeld;
  return <div className={STRIP}>
    <KpiCard label="Vacantes asignadas">
      <p className={KPI_VALUE}><Figure href={drill(t.assigned, assigned)} label={`${see(assigned, "f", "vacante asignada", "vacantes asignadas")} a ${who.name}`}>{number.format(assigned)}</Figure></p>
      <p className={KPI_LINE}>{`${number.format(data.vacancies.started_in_period)} ${data.vacancies.started_in_period === 1 ? "nueva" : "nuevas"} en el periodo`}</p>
    </KpiCard>
    <KpiCard label="Entregas a tiempo">
      {onTime.value === null ? <p className={KPI_MISSING}>{NO_SAMPLE}</p>
        : <p className={KPI_VALUE}><Figure href={drill(t.onTime, onTime.numerator)}
          label={`${onTimeText.value} a tiempo: ${lower(see(onTime.numerator, "f", "entrega a tiempo", "entregas a tiempo"))} de ${who.name}`}>{onTimeText.value}</Figure></p>}
      <p className={KPI_LINE}><Figure href={drill(t.due, onTime.denominator)} className={INLINE_FIGURE}
        label={`${onTimeText.detail}: ${lower(see(onTime.denominator, "f", "entrega con fecha", "entregas con fecha"))} de ${who.name}`}>{onTimeText.detail}</Figure>{" entregas con fecha"}</p>
    </KpiCard>
    <KpiCard label="Conversión a placement">
      {conversion.value === null ? <p className={KPI_MISSING}>{NO_SAMPLE}</p>
        : <p className={KPI_VALUE}><Figure href={drill(t.closedCredited, conversion.numerator)}
          label={`${conversionText.value} de conversión: ${lower(see(conversion.numerator, "f", "vacante cerrada con placement", "vacantes cerradas con placement"))} de ${who.name}`}>{conversionText.value}</Figure></p>}
      <p className={KPI_LINE}><Figure href={drill(t.closed, conversion.denominator)} className={INLINE_FIGURE}
        label={`${conversionText.detail}: ${lower(see(conversion.denominator, "f", "vacante cerrada", "vacantes cerradas"))} de ${who.name}`}>{conversionText.detail}</Figure>{" vacantes cerradas"}</p>
    </KpiCard>
    <KpiCard label="Placements">
      <p className={KPI_VALUE}><Figure href={drill(t.placements, placements)} label={`${see(placements, "m", "placement", "placements")} de ${who.name}`}>{number.format(placements)}</Figure></p>
      {/* Two whole parts: on a narrow card the line breaks between them, never inside «no se sostuvieron». */}
      <p className={KPI_LINE}>
        <span className="whitespace-nowrap">
          <Figure href={drill(t.held, held)} className={INLINE_FIGURE} label={`${see(held, "m", "placement", "placements")} de ${who.name} que ${held === 1 ? "se sostiene" : "se sostienen"}`}>{number.format(held)}</Figure>
          {held === 1 ? " se sostiene ·" : " se sostienen ·"}
        </span>{" "}
        <span className="whitespace-nowrap">
          <Figure href={drill(t.notHeld, notHeld)} className={INLINE_FIGURE} label={`${see(notHeld, "m", "placement", "placements")} de ${who.name} que no ${notHeld === 1 ? "se sostuvo" : "se sostuvieron"}`}>{number.format(notHeld)}</Figure>
          {notHeld === 1 ? " no se sostuvo" : " no se sostuvieron"}
        </span>
      </p>
    </KpiCard>
  </div>;
}

const DELIVERY_KEYS = [
  { key: "on_time", label: "A tiempo", singular: "entrega a tiempo", plural: "entregas a tiempo" },
  { key: "late", label: "Tarde", singular: "entrega tarde", plural: "entregas tarde" },
  { key: "overdue", label: "Vencidas", singular: "entrega vencida", plural: "entregas vencidas" },
] as const;

/** «Entregas y placements»: the delivery split against its dates (rule 9 palette) and the placements by credit. */
export function DeliveriesSection({ state, drill, who }: Props) {
  return <MetricsSection title="Entregas y placements" state={state} skeleton={<PairSkeleton />} help={{ title: "Cómo se calculan entregas y placements", body: <HelpList items={[
    ["Entregas con fecha cumplida", "Se juzga con el día en que el candidato que completó la meta llegó a la etapa de corte. A tiempo: igual o antes de la fecha compromiso vigente. Tarde: después. Vencida: sin cumplir y la fecha ya pasó."],
    ["Mediana a la meta", "Mediana de días hábiles entre la primera publicación y el día en que se completó la meta. Sin entregas cumplidas no hay mediana."],
    ["Candidatos entregados en su tramo", `Candidatos que ${who.first} movió a la etapa de corte mientras tenía la vacante asignada. Las postulaciones que llegan directo a esa etapa cuentan para la vacante, no para la persona.`],
    ["Placements por crédito", "Crédito directo, por participación o compartido. Los tres ya incluyen los que no se sostuvieron, que se muestran aparte sin sumarse de nuevo."],
  ]} footer="Días hábiles: lunes a viernes, sin festivos · Hora del centro de México" /> }}>
    {data => <div className={PAIR}><DeliveriesCard data={data} drill={drill} who={who} /><CreditCard data={data} drill={drill} who={who} /></div>}
  </MetricsSection>;
}

function DeliveriesCard({ data, drill, who }: { data: RecruiterDetail; drill: Drill; who: Who }) {
  const t = targets(who.id);
  const rate = onTimeRate(data);
  const shown = formatRate(rate);
  const total = rate.denominator;
  const dueLabel = `${see(total, "f", "entrega con fecha", "entregas con fecha")} de ${who.name}`;
  const parts = DELIVERY_KEYS.filter(({ key }) => data.delivery[key] > 0);
  return <MetricCard title="Entregas con fecha cumplida" className="lg:col-span-6"
    caption={<><Figure href={drill(t.due, total)} label={dueLabel} className={INLINE_FIGURE}>{number.format(total)}</Figure>{total === 1 ? " entrega en el periodo" : " entregas en el periodo"}</>}>
    {rate.value === null ? <p className="text-base leading-[52px] font-medium text-muted-foreground">{NO_SAMPLE}</p>
      : <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Figure href={drill(t.onTime, rate.numerator)} className="text-[44px] leading-[52px] font-semibold tracking-tight tabular-nums max-md:text-4xl"
          label={`${shown.value} a tiempo: ${lower(see(rate.numerator, "f", "entrega a tiempo", "entregas a tiempo"))} de ${who.name}`}>{shown.value}</Figure>
        <span className="text-muted-foreground">a tiempo · <Figure href={drill(t.due, total)} label={dueLabel} repeat className="tabular-nums">{shown.detail}</Figure></span>
      </p>}
    {total > 0 && <div role="img" aria-label={`${number.format(total)} ${total === 1 ? "entrega" : "entregas"} con fecha: ${DELIVERY_KEYS.map(({ key, label }) => `${number.format(data.delivery[key])} ${label.toLowerCase()}`).join(", ")}`}
      className="flex h-3 gap-0.5 overflow-hidden rounded-full">
      {parts.map(({ key }) => {
        const style = { width: `${(data.delivery[key] / total) * 100}%`, background: DELIVERY_TONE[key] };
        const href = drill(t[key === "on_time" ? "onTime" : key], data.delivery[key]);
        // The segment repeats the key below it: clickable, but not a second tab stop or announcement.
        return href ? <Link key={key} href={href} tabIndex={-1} aria-hidden="true" style={style} className="block h-full hover:brightness-110" />
          : <span key={key} style={style} className="block h-full" />;
      })}
    </div>}
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-muted-foreground">
      {DELIVERY_KEYS.map(({ key, label, singular, plural }) => <span key={key} className="inline-flex items-center gap-2">
        <i aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: DELIVERY_TONE[key] }} />{label} <Figure href={drill(t[key === "on_time" ? "onTime" : key], data.delivery[key])}
          label={`${see(data.delivery[key], "f", singular, plural)} de ${who.name}`} className="font-semibold text-foreground tabular-nums">{number.format(data.delivery[key])}</Figure>
      </span>)}
    </div>
    <Rows className="mt-auto" rows={[
      { label: "Mediana a la meta", value: formatMedian(data.delivery.median_business_days_to_target) },
      { label: "Candidatos entregados en su tramo", value: number.format(data.delivery.delivered_in_tramo) },
    ]} />
  </MetricCard>;
}

function CreditCard({ data, drill, who }: { data: RecruiterDetail; drill: Drill; who: Who }) {
  const t = targets(who.id);
  const total = placementTotal(data.placements);
  const notHeld = data.placements.did_not_hold;
  return <MetricCard title="Placements por crédito" className="lg:col-span-6">
    <p className="flex flex-wrap items-baseline gap-x-2">
      <Figure href={drill(t.placements, total)} label={`${see(total, "m", "placement", "placements")} de ${who.name}`} className="text-[32px] leading-10 font-semibold tabular-nums">{number.format(total)}</Figure>
      <span className="text-muted-foreground">{total === 1 ? "placement" : "placements"}</span>
    </p>
    <SplitBars total={total} rows={[
      { label: "Crédito directo", value: data.placements.direct },
      { label: "Por participación", value: data.placements.participant },
      { label: "Compartido", value: data.placements.shared },
    ]} />
    <Rows className="mt-auto" rows={[{ label: "No se sostuvieron", value: <Figure href={drill(t.notHeld, notHeld)}
      label={`${see(notHeld, "m", "placement", "placements")} de ${who.name} que no ${notHeld === 1 ? "se sostuvo" : "se sostuvieron"}`}>{number.format(notHeld)}</Figure> }]} />
  </MetricCard>;
}

/** «Carga de trabajo»: the role split, the reassignments and the business days in tramos. */
export function WorkloadSection({ state, drill, who }: Props) {
  return <MetricsSection title="Carga de trabajo" state={state} skeleton={<WorkloadSkeleton />} help={{ title: "Cómo se calcula la carga de trabajo", body: <HelpList items={[
    ["Vacantes por función", "Función que tuvo en cada vacante: responsable, colaborador o miembro. Una vacante puede contar en más de una función, así que la suma puede ser mayor que el total."],
    ["Reasignaciones", "Recibidas: pasó a ser responsable. Perdidas: dejó de serlo, incluidas las bajas de la empresa. Sumar o quitar colaboradores no es una reasignación."],
    ["Tiempo en tramos", "Días hábiles con un tramo en cada vacante dentro del periodo, sumados por vacante."],
  ]} /> }}>
    {data => <Workload data={data} drill={drill} who={who} />}
  </MetricsSection>;
}

function Workload({ data, drill, who }: { data: RecruiterDetail; drill: Drill; who: Who }) {
  const t = targets(who.id);
  const assigned = data.vacancies.assigned;
  const { received, lost } = data.reassignments;
  const assignedFigure = <Figure href={drill(t.assigned, assigned)} label={`${see(assigned, "f", "vacante asignada", "vacantes asignadas")} a ${who.name}`} className={INLINE_FIGURE}>{number.format(assigned)}</Figure>;
  const assignedNoun = assigned === 1 ? " vacante asignada" : " vacantes asignadas";
  const receivedLabel = `${see(received, "f", "reasignación recibida", "reasignaciones recibidas")} por ${who.name}`;
  const days = data.business_days_in_tramos;
  return <div className={PAIR}>
    <MetricCard title="Vacantes por función" className="lg:col-span-4" caption={<>De {assignedFigure}{assignedNoun}</>}>
      <SplitBars total={assigned} rows={[
        { label: "Responsable", value: data.vacancies.as_responsible },
        { label: "Colaborador", value: data.vacancies.as_collaborator },
        { label: "Miembro", value: data.vacancies.as_member },
      ]} />
    </MetricCard>
    <MetricCard title="Reasignaciones" className="lg:col-span-4">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <Figure href={drill(t.received, received)} label={receivedLabel} className="text-[32px] leading-10 font-semibold tabular-nums">{number.format(received)}</Figure>
        <span className="text-muted-foreground">{received === 1 ? "recibida" : "recibidas"}</span>
      </p>
      <Rows className="mt-auto" rows={[
        { label: "Recibidas", value: <Figure href={drill(t.received, received)} label={receivedLabel} repeat>{number.format(received)}</Figure> },
        { label: "Perdidas", value: <Figure href={drill(t.lost, lost)} label={`${see(lost, "f", "reasignación perdida", "reasignaciones perdidas")} por ${who.name}`}>{number.format(lost)}</Figure> },
      ]} />
    </MetricCard>
    <MetricCard title="Tiempo en tramos" className="lg:col-span-4" caption={<>En {assignedFigure}{assignedNoun}</>}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <b className="text-[32px] leading-10 font-semibold tabular-nums">{number.format(days)}</b>
        <span className="text-muted-foreground">{days === 1 ? "día hábil" : "días hábiles"}</span>
      </p>
    </MetricCard>
  </div>;
}

/** Rule 15: the strip's four KPI cards. */
function StripSkeleton() {
  return <div aria-hidden="true" className={STRIP}>
    {[0, 1, 2, 3].map(index => <div key={index} className={cn("flex min-w-0 flex-col gap-3 rounded-[min(var(--radius-4xl),24px)] bg-card p-6 shadow-sm ring-1 ring-foreground/5 max-md:p-4 lg:col-span-3")}>
      <Skeleton className="h-5 w-32" /><Skeleton className="h-10 w-20" /><Skeleton className="h-4 w-40" />
    </div>)}
  </div>;
}
/** Rule 15: the delivery card (rate, bar, keys, two rows) and the credit card (total, three bars, one row). */
function PairSkeleton() {
  return <div aria-hidden="true" className={PAIR}>
    <CardSkeleton className="lg:col-span-6">
      <Skeleton className="h-13 w-48" /><Skeleton className="h-3 w-full rounded-full" /><Skeleton className="h-5 w-64" />
      <div className="flex flex-col gap-3">{[0, 1].map(index => <Skeleton key={index} className="h-7 w-full" />)}</div>
    </CardSkeleton>
    <CardSkeleton className="lg:col-span-6">
      <Skeleton className="h-10 w-32" />
      <div className="flex flex-col gap-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9 w-full" />)}</div>
      <Skeleton className="h-7 w-full" />
    </CardSkeleton>
  </div>;
}
/** Rule 15: three 4-column cards. */
function WorkloadSkeleton() {
  return <div aria-hidden="true" className={PAIR}>
    <CardSkeleton className="lg:col-span-4"><div className="flex flex-col gap-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9 w-full" />)}</div></CardSkeleton>
    <CardSkeleton className="lg:col-span-4"><Skeleton className="h-10 w-24" /><div className="flex flex-col gap-3">{[0, 1].map(index => <Skeleton key={index} className="h-7 w-full" />)}</div></CardSkeleton>
    <CardSkeleton className="lg:col-span-4"><Skeleton className="h-10 w-40" /></CardSkeleton>
  </div>;
}

