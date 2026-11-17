import { CHANNEL_LABEL, dayLabel, momentLabel, number, plural, STAGE_KIND_LABEL, type StageKind } from "@/features/company-metrics/model";
import { VACANCY_UNAVAILABLE } from "@/features/company-metrics/detail/titles";
import type { FilterChip } from "@/features/company-metrics/detail/detail-parts";
import type { DashboardApplied, DashboardDetailPage } from "./model";
import { ORGANIC_CHANNELS, type DashboardDetailState } from "./query";

/**
 * The words of the dashboard detail page (artboard 08, `design/system.md` rule 16), like «Métricas»: the title names the
 * figure («Entregas vencidas», «Candidatos en proceso · Analista de crédito Sr.»), chips name each active filter, one
 * summary line counts the records. The vacancy's name comes from `applied_filters` and only for the id in the URL.
 */
const LOADING_NAME = "…";
export const STATE_LABEL: Record<string, string> = { overdue: "Vencidas", due_this_week: "Vencen esta semana" };
export const STATUS_LABEL: Record<string, string> = { published: "Publicadas", paused: "Pausadas", closed: "Cerradas", finished: "Finalizadas" };
const single = (value: string | undefined) => value && !value.includes(",") ? value : undefined;
const list = (value: string | undefined, labels: Record<string, string>) => (value ?? "").split(",").filter(Boolean).map(key => labels[key] ?? key).join(", ");
/** «1 nov 2026» or «1 nov 2026 – 5 nov 2026». */
const days = (from: string | undefined, to: string | undefined) => from && to && from !== to ? `${dayLabel(from)} – ${dayLabel(to)}` : from || to ? dayLabel((from ?? to)!) : null;

function vacancyTitle(state: DashboardDetailState, applied: DashboardApplied | undefined): string | null {
  const id = state.params.vacancy_id;
  const vacancy = applied?.vacancy;
  if (!id || !vacancy || vacancy.draft_id !== id) return null;
  return vacancy.title?.trim() || VACANCY_UNAVAILABLE;
}

/** The board's «Posiciones» figures: the published vacancies sorted by open positions. */
const positionsView = ({ params }: Pick<DashboardDetailState, "params">) => params.status === "published" && params.sort === "positions_open";

/** The figure without its subjects: the breadcrumb's current page. */
export function figureTitle({ kind, params }: DashboardDetailState): string {
  switch (kind) {
    case "candidates": {
      const base = params.stalled === "true" ? "Candidatos detenidos" : params.in_process === "true" ? "Candidatos en proceso" : "Candidatos";
      const stage = single(params.stage_kind);
      return stage ? `${base} en ${STAGE_KIND_LABEL[stage as StageKind]}` : base;
    }
    case "deliveries": return params.state === "overdue" ? "Entregas vencidas" : params.state === "due_this_week" ? "Entregas que vencen esta semana" : "Entregas por atender";
    case "vacancies":
      // «Posiciones» on the board (covered and open alike) opens the published vacancies with the most open positions first.
      if (params.status === "published") return positionsView({ params }) ? "Posiciones de las vacantes publicadas" : "Vacantes publicadas";
      return "Vacantes";
    case "applications":
      if (params.channel === ORGANIC_CHANNELS) return "Postulaciones orgánicas";
      return params.channel === "manual" ? "Postulaciones de registro manual" : "Postulaciones";
  }
}

/** «Candidatos en proceso · Analista de crédito Sr. · 12 oct 2026». */
export function detailTitle(state: DashboardDetailState, applied?: DashboardApplied): string {
  const when = state.kind === "candidates" ? days(state.params.on, undefined) : state.kind === "applications" ? days(state.params.from, state.params.to) : null;
  return [figureTitle(state), vacancyTitle(state, applied), when].filter(Boolean).join(" · ");
}

/** One removable chip per active filter; sort, order and the window are not filters. */
export function filterChips(state: DashboardDetailState, applied?: DashboardApplied): FilterChip[] {
  const { params } = state;
  const chips: FilterChip[] = [];
  const add = (key: string, label: string, remove = [key]) => chips.push({ key, label, remove });
  if (params.vacancy_id) add("vacancy_id", `Vacante: ${vacancyTitle(state, applied) ?? LOADING_NAME}`);
  // A day of the series belongs to «en proceso» (the backend requires both), so the day leaves with it.
  if (params.in_process) add("in_process", "En proceso", ["in_process", "on"]);
  if (params.on) add("on", `Al cierre del ${dayLabel(params.on)}`);
  if (params.stage_kind) add("stage_kind", `Etapa: ${list(params.stage_kind, STAGE_KIND_LABEL)}`);
  if (params.stalled) add("stalled", "Solo detenidos");
  if (params.state) add("state", `Estado: ${STATE_LABEL[params.state]}`);
  if (params.status) add("status", `Estado: ${STATUS_LABEL[params.status]}`);
  if (params.from || params.to) add("dates", `Fechas: ${days(params.from, params.to)}`, ["from", "to"]);
  if (params.channel) add("channel", `Canal: ${list(params.channel, CHANNEL_LABEL).replace("Registro manual", "Manual")}`);
  return chips;
}

/** Summary parts: `[text, bold]`. */
export type SummaryPart = readonly [string, boolean];
/** «14 candidatos en proceso hoy.», «2 entregas vencidas hoy.», «14 postulaciones orgánicas en el periodo.» */
export function summaryLine(state: DashboardDetailState, data: DashboardDetailPage): SummaryPart[] {
  const total = data.page.total;
  const one = total === 1;
  switch (data.kind) {
    case "candidates": {
      const { stalled, in_process: inProcess, on } = state.params;
      const what = stalled === "true" ? plural(total, "candidato detenido", "candidatos detenidos") : inProcess === "true" ? plural(total, "candidato en proceso", "candidatos en proceso") : plural(total, "candidato", "candidatos");
      return [[what, true], [on ? ` al cierre del ${dayLabel(on)}.` : " hoy.", false]];
    }
    case "deliveries":
      if (state.params.state === "due_this_week") return [[plural(total, "entrega", "entregas"), true], [one ? " vence esta semana." : " vencen esta semana.", false]];
      if (state.params.state === "overdue") return [[plural(total, "entrega vencida", "entregas vencidas"), true], [" hoy.", false]];
      return [[plural(total, "entrega", "entregas"), true], [one ? " vencida o por vencer esta semana." : " vencidas o por vencer esta semana.", false]];
    case "vacancies": {
      const published = plural(total, "vacante publicada", "vacantes publicadas");
      if (positionsView(state)) {
        // The list's own aggregate over every filtered row (not this page), so it states the figures the board linked.
        const { covered, required } = data.page.positions;
        if (required === 0 && covered === 0) return [[published, true], [" sin posiciones definidas.", false]];
        return [[`${number.format(covered)} de ${plural(required, "posición", "posiciones")}`, true], [` ${required === 1 ? "cubierta" : "cubiertas"} en ${published}; `, false],
          [number.format(Math.max(required - covered, 0)), true], [" por cubrir.", false]];
      }
      return state.params.status === "published" ? [[published, true], [" hoy.", false]] : [[plural(total, "vacante", "vacantes"), true], [".", false]];
    }
    case "applications": {
      // Named after the board figure it came from: «Orgánicas» (every channel but manual) or «Manuales».
      const where = state.params.channel === ORGANIC_CHANNELS ? ["postulación orgánica", "postulaciones orgánicas"]
        : state.params.channel === "manual" ? ["postulación de registro manual", "postulaciones de registro manual"] : ["postulación", "postulaciones"];
      return [[plural(total, where[0], where[1]), true], [" en el periodo.", false]];
    }
  }
}

/** Current-state lists say «Foto de hoy»; applications and a past day of the series say the window they come from. */
const windowBound = (state: DashboardDetailState) => state.kind === "applications" || (state.kind === "candidates" && Boolean(state.params.on));
/** «Actualizado … · Últimos 30 días (10 oct 2026 – 8 nov 2026) · Solo tus vacantes · Definiciones d2». */
export function freshnessLine(state: DashboardDetailState, page: DashboardDetailPage["page"] | null): string {
  const range = page ? ` (${dayLabel(page.window.from)} – ${dayLabel(page.window.to)})` : "";
  return [
    page && `Actualizado ${momentLabel(page.as_of)}`,
    windowBound(state) ? `Últimos ${state.window} días${range}` : "Foto de hoy",
    page?.scope === "own_vacancies" && "Solo tus vacantes",
    page && `Definiciones ${page.definitions_version}`,
  ].filter(Boolean).join(" · ");
}
