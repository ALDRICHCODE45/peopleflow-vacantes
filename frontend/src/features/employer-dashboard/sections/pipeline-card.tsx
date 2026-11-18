"use client";
import { useId } from "react";
import { Users } from "lucide-react";
import { SectionEmpty } from "@/components/feedback/state-card";
import { Figure } from "@/features/company-metrics/figure";
import { number, plural, STAGE_KIND_LABEL, STAGE_KINDS } from "@/features/company-metrics/model";
import { CHART_ACCENT } from "@/features/company-metrics/palette";
import { CARD } from "@/features/company-metrics/sections/summary-strip";
import { cn } from "@/lib/utils";
import type { Drill } from "../drilldown";
import type { PipelineSection } from "../model";
import { CardHead, FootLink } from "../section";

type Stage = PipelineSection["stages"][number];
const STAGE_BAR = "color-mix(in oklab, var(--primary) 28%, var(--pf-tint-base))";
const see = (count: number, singular: string, pluralForm: string, tail = "") => `Ver ${count === 1 ? `el 1 ${singular}` : `los ${number.format(count)} ${pluralForm}`}${tail}`;

/** «Pipeline por etapa» (artboard 09, 4 columns): today's candidates per stage kind, stalled people and the stage that holds most of them. */
export function PipelineCard({ data, drill }: { data: PipelineSection; drill: Drill }) {
  const headingId = useId();
  const total = data.stages.reduce((sum, stage) => sum + stage.candidates, 0);
  const stalled = data.stages.reduce((sum, stage) => sum + stage.stalled, 0);
  const max = Math.max(0, ...data.stages.map(stage => stage.candidates));
  // Rule 8: one accent bar, the stage holding the most stalled people.
  const hot = data.stages.reduce<Stage | null>((top, stage) => stage.stalled > (top?.stalled ?? 0) ? stage : top, null);
  const caption = total > 0 && <>Hoy · <Figure href={drill({ kind: "candidates", params: { stage_kind: STAGE_KINDS.join(",") } }, total)}
    label={see(total, "candidato activo", "candidatos activos")} className="font-medium">{number.format(total)}</Figure> {total === 1 ? "candidato" : "candidatos"}</>;
  return <article aria-labelledby={headingId} className={cn(CARD, "flex-1")}>
    <CardHead id={headingId} title="Pipeline por etapa" caption={caption} />
    {total === 0
      ? <SectionEmpty icon={Users} tone="empty" title="Sin candidatos en proceso" description="Aquí verás cuántas personas hay en cada etapa de tus vacantes abiertas." />
      : <ul className="flex flex-col gap-4">
        {data.stages.map(stage => {
          const label = STAGE_KIND_LABEL[stage.kind];
          const isHot = stage === hot;
          return <li key={stage.kind} className="grid grid-cols-[minmax(0,1fr)_auto_32px] items-center gap-x-3 gap-y-1.5">
            <span className="truncate font-medium">{label}</span>
            {/* Stalled never counts in placement (§4.4). */}
            {stage.kind === "placement" ? <span className="text-xs text-muted-foreground">No aplica</span>
              : stage.stalled > 0
                ? <Figure href={drill({ kind: "candidates", params: { stage_kind: stage.kind, stalled: "true" } }, stage.stalled)}
                  label={see(stage.stalled, "candidato detenido", "candidatos detenidos", ` en ${label}`)}
                  className={cn("text-xs whitespace-nowrap", isHot ? "font-medium text-status-danger" : "text-muted-foreground")}>{plural(stage.stalled, "detenido", "detenidos")}</Figure>
                : <span className="text-xs text-muted-foreground">Al día</span>}
            <Figure href={drill({ kind: "candidates", params: { stage_kind: stage.kind } }, stage.candidates)} label={see(stage.candidates, "candidato", "candidatos", ` en ${label}`)}
              className="text-right text-base font-semibold tabular-nums">{number.format(stage.candidates)}</Figure>
            <span aria-hidden="true" className="col-span-3 h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full" style={{ width: `${max > 0 ? (stage.candidates / max) * 100 : 0}%`, background: isHot ? CHART_ACCENT : STAGE_BAR }} />
            </span>
          </li>;
        })}
      </ul>}
    <FootLink href={drill({ kind: "candidates", params: { stalled: "true" } }, stalled)}>{see(stalled, "detenido", "detenidos")}</FootLink>
  </article>;
}
