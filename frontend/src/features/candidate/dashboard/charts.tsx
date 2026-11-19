"use client";
import { memo, useId, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Bookmark, BriefcaseBusiness, Clock, Flame, Sparkles, type LucideIcon } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import type { SavedJobs } from "@/features/saved-vacancies/model";
import { cn } from "@/lib/utils";
import type { Insights, Status, Week } from "./insights";
import { SourceError, SourceLoading, type Source } from "./source";
import { capitalize, monthName, SHORT_MONTHS } from "./format";
import motion from "./dashboard.module.css";
import { useEntrance } from "./entrance";

/* Thresholds from research.md §5: no chart under 5 records, a sparkline only with 4 active weeks or more. */
const SPARKLINE_WEEKS = 4;
const STATUS_BAR_MIN = 5;
const HISTOGRAM_MIN = 5;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const number = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
const weekLabel = (start: string) => { const [, month, day] = start.split("-").map(Number); return `${day} ${SHORT_MONTHS[month - 1]}`; };
const ORDER: Status[] = ["submitted", "in_process", "closed"];
const LABEL: Record<Status, string> = { submitted: "Enviada", in_process: "En proceso", closed: "Cerrada" };
const PLURAL: Record<Status, [string, string]> = { submitted: ["enviada", "enviadas"], in_process: ["en proceso", "en proceso"], closed: ["cerrada", "cerradas"] };
const VALUE = "flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[26px] leading-8 font-semibold tracking-tight tabular-nums sm:text-[32px] sm:leading-10";
const VALUE_TEXT = "text-xl leading-7 font-semibold tracking-tight";
// A worded figure («El mismo día») at the tiles' figure size; it may wrap to two lines in a 173 px mobile tile.
const VALUE_WORDS = "text-[28px] leading-[34px] font-semibold tracking-tight text-balance sm:text-[32px] sm:leading-10";
const UNIT = "text-sm font-medium tracking-normal text-muted-foreground";
const CONTEXT = "text-xs text-muted-foreground";
const INLINE_LINK = "font-medium text-primary-text underline-offset-3 hover:underline";
const FOOT_LINK = "mt-auto -mb-2 inline-flex min-h-10 items-center self-start sm:-mb-3 text-xs font-medium text-primary-text underline-offset-3 hover:underline";
const delay = (d: number) => ({ "--d": d }) as CSSProperties;

/** Part of a whole with a goal (profile %, assessment n/63): one SVG, the arc drawn with stroke-dashoffset. */
export const Ring = memo(function Ring({ value, total, size, stroke, label, brand = false, children }: { value: number; total: number; size: number; stroke: number; label: string; brand?: boolean; children: ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(value, total) / total);
  return <div role="img" aria-label={label} className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-muted dark:stroke-border" />
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
        className={cn("fill-none", value >= total && !brand ? "stroke-status-success" : "stroke-primary-text", motion.arc)} style={{ "--c": circumference } as CSSProperties} />
    </svg>
    <span aria-hidden="true" className="absolute inset-0 grid place-items-center font-semibold tabular-nums">{children}</span>
  </div>;
});

/** 12 ISO weeks × 1 row (GitHub contributions): reads well with a single dot; the running week is outlined dashed. */
const DotStrip = memo(function DotStrip({ weeks, streak, active }: { weeks: Week[]; streak: number; active: number }) {
  const level = (count: number) => count === 0 ? "bg-muted dark:bg-border" : count === 1 ? "bg-(--pf-tone-late)" : count === 2 ? "bg-[color-mix(in_oklab,var(--primary-text)_75%,var(--pf-tint-base))]" : "bg-primary-text";
  return <div role="img" aria-label={`Constancia de las últimas 12 semanas: ${active} con postulaciones, racha de ${plural(streak, "semana", "semanas")}`} className={cn("grid grid-cols-12 items-center gap-1", motion.fade)}>
    {weeks.map(week => <span key={week.start} data-week={week.start} data-current={week.current} title={`Semana del ${weekLabel(week.start)}${week.current ? " (en curso)" : ""}: ${plural(week.count, "postulación", "postulaciones")}`}
      className={cn("aspect-square w-full max-w-7 justify-self-center rounded-full", level(week.count), week.current && "outline-[1.5px] outline-offset-1 outline-primary-text outline-dashed")} />)}
  </div>;
});

/** Tufte sparkline: no axes, last point marked; only drawn from SPARKLINE_WEEKS active weeks. */
const Sparkline = memo(function Sparkline({ weeks }: { weeks: Week[] }) {
  const width = 480, height = 64, max = Math.max(1, ...weeks.map(week => week.count)), step = width / (weeks.length - 1);
  const points = weeks.map((week, index) => [index * step, height - 4 - week.count / max * (height - 12)] as const);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points.at(-1)!;
  return <div className="flex flex-col gap-1.5">
    <span aria-hidden="true" className="text-xs text-background/70">Postulaciones por semana</span>
    <svg role="img" aria-label={`Postulaciones por semana, últimas 12 semanas: ${weeks.map(week => week.count).join(", ")}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block h-16 w-full overflow-visible">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} className={cn("fill-[color-mix(in_srgb,var(--hero-accent)_18%,transparent)]", motion.late)} />
      <path d={line} pathLength={1} strokeDasharray={1} vectorEffect="non-scaling-stroke" className={cn("fill-none stroke-(--hero-accent) [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:2]", motion.draw)} />
      <circle cx={lastX} cy={lastY} r={3.5} className={cn("fill-(--hero-accent)", motion.late)} />
    </svg>
    <div aria-hidden="true" className="flex justify-between text-xs text-background/70"><span>{weekLabel(weeks[0].start)}</span><span>Esta semana</span></div>
  </div>;
});

/** Composition by status (replaces the donut and «Estado de tus postulaciones»): a segmented bar from 5 applications. */
const StatusSummary = memo(function StatusSummary({ statuses, total }: { statuses: Record<Status, number>; total: number }) {
  const label = ORDER.map(status => plural(statuses[status], ...PLURAL[status])).join(", ");
  return <div className="flex flex-col gap-3">
    {total >= STATUS_BAR_MIN && <div role="img" aria-label={`Postulaciones por estado: ${label}`} className={cn("flex h-2 gap-[3px] overflow-hidden rounded-full", motion.grow)}>
      {ORDER.filter(status => statuses[status]).map(status => <span key={status} className="block h-full min-w-1.5" style={{ flex: statuses[status], background: `var(--st-${status})` }} />)}
    </div>}
    {/* Tighter gaps below sm keep «Enviada 1 · En proceso 2 · Cerrada 1» on one line in a 390 px hero (318 px). */}
    <ul aria-label="Postulaciones por estado" className="flex flex-wrap gap-x-3.5 gap-y-2 sm:gap-x-5">
      {ORDER.map(status => <li key={status} className="inline-flex items-center gap-1.5 text-background/70 sm:gap-2">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(--st-${status})` }} />{LABEL[status]} <b className="font-semibold text-background tabular-nums">{statuses[status]}</b>
      </li>)}
    </ul>
  </div>;
});

const Histogram = memo(function Histogram({ bins }: { bins: number[] }) {
  const max = Math.max(...bins);
  const names = ["el mismo día", "1 día", "2 días", "3 días", "4 días", "5 días", "6 o más días"];
  return <div className="mt-auto flex flex-col gap-1.5">
    <div role="img" aria-label={`Días hasta la primera respuesta: ${bins.map((count, index) => `${names[index]} ${count}`).join(", ")}`} className={cn("grid h-10 grid-cols-7 items-end gap-1", motion.growY)}>
      {bins.map((count, index) => <span key={index} className={cn("block min-h-[3px] rounded-t-[4px] rounded-b-[2px]", count === max ? "bg-primary-text" : "bg-(--pf-tone-late)", !count && "opacity-50")} style={{ height: `${count ? Math.max(10, count / max * 100) : 6}%` }} />)}
    </div>
    <div aria-hidden="true" className="flex justify-between text-[11px] leading-3.5 text-muted-foreground"><span>Mismo día</span><span>6+ días</span></div>
  </div>;
});

/** Bento tile (rule 6): label 14/500 muted with its icon, value 32/600, one line of context, a link at the foot. */
export function Tile({ title, icon: Icon, className, order, ready = true, children }: { title: string; icon: LucideIcon; className?: string; order: number; ready?: boolean; children: ReactNode }) {
  const id = useId();
  const entrance = useEntrance(ready);
  return <article aria-labelledby={id} className={cn(CARD, "gap-3 p-4 sm:p-6", entrance, className)} style={delay(order)}>
    <h3 id={id} className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon aria-hidden="true" className="size-4 shrink-0 text-primary-text" />{title}</h3>
    {children}
  </article>;
}

function MonthHero({ insights }: { insights: Insights }) {
  const id = useId();
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const { month, statuses, total, responses, active, weeks } = insights;
  const difference = month.current - month.previous;
  const advanced = statuses.in_process;
  const sameDay = advanced > 0 && responses.average === 0 ? ", el mismo día que postulaste" : "";
  const Arrow = difference > 0 ? ArrowUp : difference < 0 ? ArrowDown : ArrowRight;
  const entrance = useEntrance();
  return <section aria-labelledby={id} className={cn(CARD, "pf-kpi-hero relative isolate col-span-2 justify-between gap-5 overflow-hidden bg-foreground p-5 text-background shadow-none ring-0 sm:p-7 xl:col-span-6 xl:row-span-2", motion.hero, entrance)}>
    <div className="flex items-center justify-between gap-3 text-sm font-medium text-background/70"><h3 id={id}>Este mes</h3><span>{capitalize(monthName(now))}</span></div>
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1"><span className="text-[56px] leading-[56px] font-semibold tracking-[-0.04em] tabular-nums sm:text-[72px] sm:leading-[72px]">{month.current}</span><span className="text-lg font-medium">{month.current === 1 ? "postulación" : "postulaciones"}</span></p>
      {month.first
        ? <span className="inline-flex h-6 items-center self-start rounded-full bg-background/12 px-2.5 text-xs font-medium">Primer mes de actividad</span>
        : <span className={cn("inline-flex h-6 items-center gap-1.5 self-start rounded-full px-2.5 text-xs font-medium tabular-nums", difference > 0 ? "bg-[color-mix(in_oklab,var(--status-success)_30%,transparent)] text-[color-mix(in_oklab,var(--status-success)_45%,var(--background))]" : "bg-background/12")}>
          <Arrow aria-hidden="true" className="size-3" strokeWidth={2.5} />
          {difference === 0 ? `Igual que en ${monthName(previous)}` : `${Math.abs(difference)} ${difference > 0 ? "más" : "menos"} que en ${monthName(previous)}`}
        </span>}
    </div>
    {active >= SPARKLINE_WEEKS && <Sparkline weeks={weeks} />}
    <p className="max-w-[420px] text-lg leading-[26px] font-semibold tracking-tight text-balance sm:text-xl sm:leading-7">
      {advanced === 0 ? "Aún ninguna avanzó a proceso." : <><em className="text-(--hero-accent) not-italic">{advanced} de {total}</em> {advanced === 1 ? "ya avanzó" : "ya avanzaron"} a proceso{sameDay}.</>}
    </p>
    <StatusSummary statuses={statuses} total={total} />
  </section>;
}

function ResponseValue({ insights }: { insights: Insights }) {
  const { responses, total } = insights;
  if (!responses.available) return <p className={VALUE_TEXT}>Sin datos de respuesta</p>;
  if (responses.average === null) return <><p className={VALUE_TEXT}>Sin respuestas aún</p><p className={CONTEXT}>{plural(responses.waiting, "postulación espera", "postulaciones esperan")} su primer cambio</p></>;
  if (responses.average === 0) return <><p className={VALUE_WORDS}>El mismo día</p><p className={CONTEXT}>{plural(responses.count, "respuesta", "respuestas")} de {total}</p></>;
  return <><p className={VALUE}>{number.format(responses.average)} <small className={UNIT}>{responses.average === 1 ? "día" : "días"}</small></p><p className={CONTEXT}>en promedio · {plural(responses.count, "respuesta", "respuestas")}</p></>;
}

function FirstVisit() {
  const entrance = useEntrance();
  return <section aria-label="Tu búsqueda" className={cn(CARD, "col-span-2 xl:col-span-9", entrance)}>
    <SectionEmpty tone="empty" icon={BriefcaseBusiness} title="Aquí empieza tu búsqueda" description="Cuando envíes tu primera postulación verás tu ritmo del mes, tu racha semanal y cuánto tardan las empresas en responder." primaryAction={{ href: "/vacantes", label: "Explorar vacantes" }} />
  </section>;
}

function TileLoading({ label }: { label: string }) {
  return <SourceLoading label={label} compact />;
}

/**
 * Hero «Este mes» and the Racha / Avanzaron / Primera respuesta tiles from the applications read. Memoized on stable
 * props (the source object and the insights memo), so another source resolving never re-renders or re-animates them.
 */
export const ApplicationsBento = memo(function ApplicationsBento({ source, insights }: { source: Source<unknown>; insights?: Insights }) {
  if (!source.result) return <>
    <div aria-busy="true" className={cn(CARD, "col-span-2 gap-4 xl:col-span-6 xl:row-span-2")}><SourceLoading label="Cargando este mes" /></div>
    {[["Racha", Flame], ["Avanzaron", Sparkles], ["Primera respuesta", Clock]].map(([title, icon], index) => <Tile key={title as string} title={title as string} icon={icon as LucideIcon} order={index + 1} ready={false} className="xl:col-span-3"><TileLoading label="Cargando postulaciones" /></Tile>)}
  </>;
  // The recent applications card owns the error and its retry; the bento has nothing true to show.
  if (!source.result.ok || !insights) return null;
  if (insights.total === 0) return <FirstVisit />;
  const { streak, active, weeks, statuses, total, responses } = insights;
  return <>
    <MonthHero insights={insights} />
    <Tile title="Racha" icon={Flame} order={1} className="xl:col-span-3">
      <div><p className={VALUE}>{streak} <small className={UNIT}>{streak === 1 ? "semana" : streak === 0 ? "semanas" : "semanas seguidas"}</small></p><p className={CONTEXT}>{streak === 1 && active === 1 ? "Tu primera semana activa" : `${active} de 12 semanas activas`}</p></div>
      <div className="mt-auto"><DotStrip weeks={weeks} streak={streak} active={active} /></div>
    </Tile>
    <Tile title="Avanzaron" icon={Sparkles} order={2} className="xl:col-span-3">
      <div><p className={VALUE}>{statuses.in_process} <small className={UNIT}>de {total}</small></p><p className={CONTEXT}>{statuses.in_process === 1 ? "pasó a proceso" : "pasaron a proceso"}</p></div>
      <Link href="/candidato/postulaciones" className={FOOT_LINK}>Ver en proceso</Link>
    </Tile>
    <Tile title="Primera respuesta" icon={Clock} order={3} className="xl:col-span-3">
      <div><ResponseValue insights={insights} /></div>
      {responses.count >= HISTOGRAM_MIN && <Histogram bins={responses.histogram} />}
    </Tile>
  </>;
});

/** Saved vacancies not applied to: a bento tile, never a pending step (L8). */
export const SavedTile = memo(function SavedTile({ source }: { source: Source<SavedJobs> }) {
  const data = source.result?.ok ? source.result.data : undefined;
  const pending = data?.items.filter(item => item.application === null) ?? [];
  const open = pending.filter(item => item.availability === "open").length;
  return <Tile title="Guardadas" icon={Bookmark} order={4} ready={source.result !== undefined} className="xl:col-span-3">
    {!source.result ? <TileLoading label="Cargando guardadas" /> : !source.result.ok ? <SourceError failure={source.result} retry={source.retry} label="tus guardadas" /> : !data?.items.length ? <>
      <div><p className={VALUE}>0</p><p className={CONTEXT}>Aún no guardas vacantes</p></div>
      <Link href="/vacantes" className={FOOT_LINK}>Explorar vacantes</Link>
    </> : !pending.length ? <>
      <div><p className={VALUE}>0 <small className={UNIT}>sin postular</small></p><p className={CONTEXT}>Ya postulaste a todas las que guardaste</p></div>
      <Link href="/vacantes" className={FOOT_LINK}>Explorar vacantes</Link>
    </> : <>
      <div><p className={VALUE}>{pending.length}</p><p className={CONTEXT}>sin postular · {open === pending.length ? (open === 1 ? "sigue abierta" : "todas abiertas") : `${open} de ${pending.length} abiertas`}</p></div>
      <Link href="/candidato/guardadas" className={FOOT_LINK}>Ver guardadas</Link>
    </>}
  </Tile>;
});

export { CONTEXT, FOOT_LINK, INLINE_LINK, VALUE, UNIT };
