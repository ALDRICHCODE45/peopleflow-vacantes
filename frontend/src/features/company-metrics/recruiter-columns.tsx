import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Figure } from "./figure";
import { formatMedian, formatRate, NO_SAMPLE, number, onTimeRate, personName, placementTotal, plural, type RecruiterCard } from "./model";
import { DELIVERY_TONE } from "./palette";
import { type Drill, see } from "./recruiter-detail/parts";
import { targets } from "./recruiter-detail/sections";
import type { ColumnId } from "./recruiter-view";

/**
 * The eight figure columns of «Desempeño por reclutador» (artboard `recruiter-table-redesign/01`). A cell is a primary figure, an
 * optional bar and up to two quiet lines; the desktop table and the phone cards render the same parts. Every count above 0 opens
 * its records (rule 16), a 0 is plain text, and «Sin datos suficientes» is a missing sample, never a zero.
 */
export type CellParts = { primary: ReactNode; bar?: ReactNode; secondary?: ReactNode; tertiary?: ReactNode };
export type CellContext = { card: RecruiterCard; drill: Drill };
export type ColumnDef = { id: ColumnId; label: string; /** Width in px: with the person and the chevron the eight add up to at most 1092 (1440 with the app sidebar open); each fits its longest header word. */ width: number; cell: (context: CellContext) => CellParts };

const MISSING = "font-normal text-muted-foreground";
const missing = <span className={MISSING}>{NO_SAMPLE}</span>;

function Bar({ parts }: { parts: { tone: string; share: number }[] }) {
  return <span aria-hidden="true" className="flex h-2 min-w-12 overflow-hidden rounded-full" style={{ background: DELIVERY_TONE.not_configured }}>
    {parts.map((part, index) => <i key={index} className="block h-full" style={{ width: `${part.share * 100}%`, background: part.tone }} />)}
  </span>;
}

/** A figure that opens its records; the label ends with the person so a screen reader tells rows apart. */
const open = (context: CellContext, target: Parameters<Drill>[0], count: number, label: string, text: ReactNode, className?: string) =>
  <Figure href={context.drill(target, count)} label={label} className={className}>{text}</Figure>;

export const COLUMNS: Record<ColumnId, ColumnDef> = {
  assigned: { id: "assigned", label: "Asignadas", width: 102, cell: context => {
    const { card } = context; const name = personName(card); const count = card.vacancies.assigned;
    return { primary: open(context, targets(card.user_id).assigned, count, `${see(count, "f", "vacante asignada", "vacantes asignadas")} a ${name}`, number.format(count)), secondary: plural(card.vacancies.started_in_period, "nueva", "nuevas") };
  } },
  reassignments: { id: "reassignments", label: "Reasignaciones", width: 140, cell: context => {
    const { card } = context; const name = personName(card); const { received, lost } = card.reassignments; const t = targets(card.user_id);
    return {
      primary: open(context, t.received, received, `${see(received, "f", "reasignación recibida", "reasignaciones recibidas")} de ${name}`, plural(received, "recibida", "recibidas")),
      secondary: open(context, t.lost, lost, `${see(lost, "f", "reasignación perdida", "reasignaciones perdidas")} de ${name}`, plural(lost, "perdida", "perdidas")),
    };
  } },
  business_days: { id: "business_days", label: "Días en tramos", width: 90, cell: ({ card }) => ({ primary: number.format(card.business_days_in_tramos), secondary: "hábiles" }) },
  on_time: { id: "on_time", label: "Entregas a tiempo", width: 112, cell: context => {
    const { card } = context; const name = personName(card); const rate = onTimeRate(card); const { late, overdue } = card.delivery; const t = targets(card.user_id);
    // S3: the percentage and «N de M», each opening its records; the bar and the line below carry the words and counts.
    if (rate.value === null) return { primary: missing, secondary: "Ninguna vencía en el periodo" };
    const text = formatRate(rate);
    const judged = rate.denominator;
    return {
      primary: <>
        {open(context, t.onTime, rate.numerator, `${text.value} a tiempo: ${see(rate.numerator, "f", "entrega a tiempo", "entregas a tiempo").toLowerCase()} de ${name}`, text.value, "font-semibold")}{" "}
        {open(context, t.due, judged, `${text.detail}: ${see(judged, "f", "entrega con fecha", "entregas con fecha").toLowerCase()} de ${name}`, text.detail, "font-normal text-muted-foreground")}
      </>,
      bar: <Bar parts={[{ tone: DELIVERY_TONE.on_time, share: rate.numerator / judged }, { tone: DELIVERY_TONE.late, share: late / judged }, { tone: DELIVERY_TONE.overdue, share: overdue / judged }]} />,
      secondary: late || overdue ? `${plural(late, "tarde", "tarde")} · ${plural(overdue, "vencida", "vencidas")}` : "Ninguna tarde ni vencida",
    };
  } },
  median: { id: "median", label: "Mediana a la meta", width: 92, cell: ({ card }) => ({ primary: card.delivery.median_business_days_to_target === null ? missing : formatMedian(card.delivery.median_business_days_to_target) }) },
  delivered: { id: "delivered", label: "Entregados", width: 110, cell: ({ card }) => ({ primary: number.format(card.delivery.delivered_in_tramo), secondary: "en su tramo" }) },
  placements: { id: "placements", label: "Placements", width: 110, cell: context => {
    const { card } = context; const name = personName(card); const { direct, participant, shared, did_not_hold } = card.placements; const total = placementTotal(card.placements);
    const credits = [direct && `${direct} dir.`, participant && `${participant} part.`, shared && `${shared} comp.`].filter(Boolean).join(" · ");
    return {
      primary: open(context, targets(card.user_id).placements, total, `${see(total, "m", "placement", "placements")} de ${name}`, number.format(total)),
      secondary: credits || "Sin placements",
      tertiary: did_not_hold ? `de ellos ${plural(did_not_hold, "no se sostuvo", "no se sostuvieron")}` : undefined,
    };
  } },
  conversion: { id: "conversion", label: "Conversión", width: 110, cell: context => {
    const { card } = context; const name = personName(card); const rate = card.placements.conversion; const text = formatRate(rate); const t = targets(card.user_id);
    if (rate.value === null) return { primary: missing, secondary: text.detail };
    // As the Métricas card: the bold percentage and «N de M», each opening its records; no bar.
    return {
      primary: <>
        {open(context, t.closedCredited, rate.numerator, `${text.value} de conversión: ${see(rate.numerator, "f", "vacante cerrada", "vacantes cerradas").toLowerCase()} con placement de ${name}`, text.value, "font-semibold")}{" "}
        {open(context, t.closed, rate.denominator, `${text.detail}: ${see(rate.denominator, "f", "vacante cerrada", "vacantes cerradas").toLowerCase()} de ${name}`, text.detail, "font-normal text-muted-foreground")}
      </>,
    };
  } },
};

/** One cell's content: the primary figure, then the bar and the quiet lines (artboard `.cv`). */
export function CellView({ parts, className }: { parts: CellParts; className?: string }) {
  const quiet = "text-[12.5px] leading-[17px] text-muted-foreground tabular-nums [overflow-wrap:anywhere]";
  return <div className={cn("grid min-w-0 gap-[3px]", className)}>
    <div className="font-medium tabular-nums [overflow-wrap:anywhere]">{parts.primary}</div>
    {parts.bar}
    {parts.secondary && <div className={quiet}>{parts.secondary}</div>}
    {parts.tertiary && <div className={quiet}>{parts.tertiary}</div>}
  </div>;
}
