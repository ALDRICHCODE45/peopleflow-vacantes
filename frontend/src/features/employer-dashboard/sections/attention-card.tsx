"use client";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { CircleCheck, ChevronRight } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import { number, personName, requesterLabel, STAGE_KIND_LABEL } from "@/features/company-metrics/model";
import { vacancyPipelineHref } from "@/features/employer-vacancies/model";
import { cn } from "@/lib/utils";
import type { Drill } from "../drilldown";
import { dueLabel, initials, overdueLabel, shortfall, stageTone, stalledLabel } from "../format";
import type { AttentionSection } from "../model";
import { CardHead, FootLink } from "../section";

type Tab = "overdue" | "due_this_week" | "stalled";
const TABS: { key: Tab; label: string; empty: (threshold: number) => string }[] = [
  { key: "overdue", label: "Entregas vencidas", empty: () => "Ninguna entrega tiene la fecha meta vencida." },
  { key: "due_this_week", label: "Vencen esta semana", empty: () => "Ninguna entrega vence de hoy al domingo." },
  { key: "stalled", label: "Candidatos detenidos", empty: threshold => `Nadie lleva ${number.format(threshold)} días hábiles o más en la misma etapa.` },
];
const ROW = "-mx-2 grid min-h-15 grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-4 rounded-lg px-2 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring md:grid-cols-[minmax(0,1fr)_188px_148px_16px]";
const title = (value: string) => value.trim() || "Vacante sin título";
const lower = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

/** «Necesita atención» (rule 13, artboard 09): three tabs, up to five rows each naming the consequence and opening the board. */
export function AttentionCard({ data, drill, today }: { data: AttentionSection; drill: Drill; today: string }) {
  const headingId = useId();
  const tabsId = useId();
  const [selected, setSelected] = useState<Tab>(() => TABS.find(tab => data[tab.key].total > 0)?.key ?? "overdue");
  const buttons = useRef<Record<Tab, HTMLButtonElement | null>>({ overdue: null, due_this_week: null, stalled: null });
  const onKey = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length].key;
    setSelected(next);
    buttons.current[next]?.focus();
  };
  const foot = {
    overdue: { href: drill({ kind: "deliveries", params: { state: "overdue" } }, data.overdue.total), text: seeDeliveries(data.overdue.total, "vencida", "vencidas") },
    due_this_week: { href: drill({ kind: "deliveries", params: { state: "due_this_week" } }, data.due_this_week.total), text: seeDeliveries(data.due_this_week.total, "que vence esta semana", "que vencen esta semana") },
    stalled: { href: drill({ kind: "candidates", params: { stalled: "true" } }, data.stalled.total), text: data.stalled.total === 1 ? "Ver 1 candidato detenido" : `Ver los ${number.format(data.stalled.total)} candidatos detenidos` },
  }[selected];
  const rows = data[selected].top;
  return <article aria-labelledby={headingId} className={cn(CARD, "flex-1")}>
    <CardHead id={headingId} title="Necesita atención" />
    <div role="tablist" aria-label="Tipo de pendiente" className="flex self-start overflow-x-auto rounded-xl border bg-card p-0.5">
      {TABS.map((tab, index) => {
        const active = tab.key === selected;
        const total = data[tab.key].total;
        return <button key={tab.key} ref={node => { buttons.current[tab.key] = node; }} type="button" role="tab" id={`${tabsId}-${tab.key}`} aria-selected={active}
          aria-controls={`${tabsId}-panel`} tabIndex={active ? 0 : -1} onClick={() => setSelected(tab.key)} onKeyDown={event => onKey(event, index)}
          className={cn("min-h-10 rounded-lg px-3 font-medium whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            active && "bg-primary/10 font-semibold text-brand-decorative-strong hover:bg-primary/15 hover:text-brand-decorative-strong")}>
          {tab.label}<span className={cn("ml-1.5 tabular-nums", tab.key === "overdue" && total > 0 ? "font-semibold text-status-danger" : !active && "text-muted-foreground")}>{number.format(total)}</span>
        </button>;
      })}
    </div>
    <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${selected}`} className="flex flex-1 flex-col gap-2">
      {rows.length === 0
        ? <SectionEmpty icon={CircleCheck} tone="empty" title="Todo al día" description={TABS.find(tab => tab.key === selected)!.empty(data.stalled.threshold_business_days)} />
        : <ul className="flex flex-col divide-y">
          {selected === "overdue" && data.overdue.top.map(row => <DeliveryRow key={row.vacancy.draft_id} row={row} badge={{ text: overdueLabel(row.business_days_overdue), danger: true, long: overdueLabel(row.business_days_overdue).replace("Venció", "entrega vencida") }} />)}
          {selected === "due_this_week" && data.due_this_week.top.map(row => {
            const due = dueLabel(row.commitment_date, today);
            return <DeliveryRow key={row.vacancy.draft_id} row={row} badge={{ text: due.short, long: `entrega ${due.long}` }} />;
          })}
          {selected === "stalled" && data.stalled.top.map(row => <StalledRow key={row.participation_id} row={row} />)}
        </ul>}
      <FootLink href={foot.href}>{foot.text}</FootLink>
    </div>
  </article>;
}

const seeDeliveries = (count: number, singular: string, pluralForm: string) => count === 1 ? `Ver 1 entrega ${singular}` : `Ver las ${number.format(count)} entregas ${pluralForm}`;

function DeliveryRow({ row, badge }: { row: AttentionSection["overdue"]["top"][number] | AttentionSection["due_this_week"]["top"][number]; badge: { text: string; long: string; danger?: boolean } }) {
  const name = title(row.vacancy.title);
  const consequence = shortfall(row.delivered, row.target);
  const meta = [requesterLabel(row.requester), row.responsible ? personName(row.responsible) : "Sin responsable"].join(" · ");
  return <li>
    <Link href={vacancyPipelineHref(row.vacancy.draft_id)} aria-label={`Abrir el pipeline de ${name}: ${badge.long}, ${lower(consequence)}`} className={cn(ROW, "group/row")}>
      <span className="min-w-0">
        <b className="block truncate font-medium group-hover/row:underline group-focus-visible/row:underline">{name}</b>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
      <span className="hidden whitespace-nowrap tabular-nums md:block">{consequence}</span>
      <Badge variant={badge.danger ? "danger" : "neutral"} className="h-[22px] justify-self-end">{badge.text}</Badge>
      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
    </Link>
  </li>;
}

function StalledRow({ row }: { row: AttentionSection["stalled"]["top"][number] }) {
  const name = row.candidate.full_name.trim() || "Candidato sin nombre";
  const vacancy = title(row.vacancy.title);
  const stage = row.stage.name.trim() || STAGE_KIND_LABEL[row.stage.kind];
  const days = stalledLabel(row.business_days_in_stage);
  return <li>
    <Link href={vacancyPipelineHref(row.vacancy.draft_id)} aria-label={`Abrir el pipeline de ${vacancy}: ${name} lleva ${days.replace(" sin avanzar", "")} sin avanzar en ${stage}`} className={cn(ROW, "group/row")}>
      <span className="flex min-w-0 items-center gap-3">
        <Avatar className="size-8 shrink-0"><AvatarFallback className="bg-secondary text-xs font-medium text-foreground">{initials(name)}</AvatarFallback></Avatar>
        <span className="min-w-0">
          <b className="block truncate font-medium group-hover/row:underline group-focus-visible/row:underline">{name}</b>
          <span className="block truncate text-xs text-muted-foreground">{vacancy}</span>
        </span>
      </span>
      <span className="hidden whitespace-nowrap tabular-nums md:block">{days}</span>
      <Badge className={cn("stage-badge h-[22px] justify-self-end", stageTone(row.stage.kind))}>{stage}</Badge>
      <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
    </Link>
  </li>;
}
