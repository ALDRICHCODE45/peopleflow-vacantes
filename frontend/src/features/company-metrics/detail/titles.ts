import {
  CLOSE_REASON_LABEL, monthLabel, number, plural, REASSIGNMENT_REASON_LABEL, requesterLabel, share,
  type AppliedFilters, type DetailPage, type Person,
} from "../model";
import { NO_REQUESTER } from "../url-state";
import { isListKind, type DetailState } from "./query";

/**
 * The words of the detail page (artboard 08, `design/system.md` rule 16): the title names the figure («Entregas tarde ·
 * Jorge Paredes»), chips name each active filter, one summary line counts the records. Names come from the API's
 * `applied_filters` and are used only when they belong to the filter in the URL.
 */
export const PERSON_UNAVAILABLE = "Persona no disponible";
export const VACANCY_UNAVAILABLE = "Vacante no disponible";
const LOADING_NAME = "…";

export const RESULT_LABEL: Record<string, string> = { on_time: "A tiempo", late: "Tarde", overdue: "Vencidas", pending: "Pendientes", not_configured: "Sin meta" };
const RESULT_TITLE: Record<string, string> = {
  on_time: "Entregas a tiempo", late: "Entregas tarde", overdue: "Entregas vencidas", pending: "Entregas pendientes", not_configured: "Vacantes sin meta de entrega",
};
const LATE_BUCKET_LABEL: Record<string, string> = { up_to_2: "hasta 2 días hábiles", from_3_to_5: "3 a 5 días hábiles", over_5: "más de 5 días hábiles" };
const SCOPE_LABEL: Record<string, string> = { activity: "Con actividad", assigned: "Asignadas", closed: "Cerradas", closed_assigned: "Cerradas asignadas" };
const CLOSING_TARGET_LABEL: Record<string, string> = { on_time: "A tiempo", late: "Tarde", no_target: "Sin meta" };
export const HELD_LABEL: Record<string, string> = { true: "Se sostuvieron", false: "No se sostuvieron" };
const DIRECTION_LABEL: Record<string, string> = { received: "Recibidas", lost: "Perdidas" };

/** «octubre 2026» from `2026-10`. */
export const monthName = (month: string) => monthLabel(month).toLowerCase().replace(" de ", " ");
const list = (value: string | undefined, labels: Record<string, string>) => (value ?? "").split(",").filter(Boolean).map(key => labels[key] ?? key).join(", ");
const single = (value: string | undefined) => value && !value.includes(",") ? value : undefined;

type PersonKey = "recruiter" | "attributed_to" | "recipient" | "credited_to";
const PERSON_PARAM: Record<PersonKey, string> = { recruiter: "recruiter_id", attributed_to: "attributed_to", recipient: "recipient", credited_to: "credited_to" };
/** The name of a person filter; null while the API has not named this id yet. */
function personName(state: DetailState, applied: AppliedFilters | undefined, key: PersonKey): string | null {
  const id = state.params[PERSON_PARAM[key]];
  const person: Person | undefined = applied?.[key];
  if (!id || !person || person.user_id !== id) return null;
  return person.name?.trim() || PERSON_UNAVAILABLE;
}
function requesterName(state: DetailState, applied: AppliedFilters | undefined): string | null {
  const { requester_kind: kind, requester_id: id } = state.params;
  if (!kind && !id) return null;
  if (!id) return kind === "client" ? "Clientes" : "Áreas internas";
  if (id === NO_REQUESTER && !kind) return "Sin solicitante";
  if (id === NO_REQUESTER) return requesterLabel({ kind: kind as "client" | "internal_area", id: null, name: null });
  const requester = applied?.requester;
  if (!requester || requester === "none" || requester.id !== id) return null;
  return requester.name?.trim() || "Solicitante no disponible";
}
function vacancyTitle(state: DetailState, applied: AppliedFilters | undefined): string | null {
  const id = state.params.vacancy_id;
  const vacancy = applied?.vacancy;
  if (!id || !vacancy || vacancy.draft_id !== id) return null;
  return vacancy.title?.trim() || VACANCY_UNAVAILABLE;
}
/** The person a figure is about: the one it is attributed or credited to, else the recruiter filter. */
const subjectPerson = (state: DetailState, applied?: AppliedFilters) =>
  personName(state, applied, "attributed_to") ?? personName(state, applied, "recipient") ?? personName(state, applied, "credited_to") ?? personName(state, applied, "recruiter");

/** The figure without its subjects: the breadcrumb's current page. */
export function figureTitle({ kind, params }: DetailState): string {
  switch (kind) {
    case "deliveries": {
      const base = RESULT_TITLE[single(params.result) ?? ""] ?? "Entregas";
      return params.late_bucket ? `${base} · ${LATE_BUCKET_LABEL[params.late_bucket]}` : base;
    }
    case "vacancies": {
      const reason = single(params.close_reason);
      if (params.closing_target) return { on_time: "Vacantes cubiertas a tiempo", late: "Vacantes cubiertas tarde", no_target: "Vacantes cubiertas sin meta" }[params.closing_target] ?? "Vacantes";
      if (reason) return { filled: "Vacantes cubiertas", cancelled: "Vacantes canceladas", other: "Vacantes cerradas por otro motivo", no_reason: "Vacantes cerradas sin motivo" }[reason] ?? "Vacantes cerradas";
      if (params.scope === "closed" || params.scope === "closed_assigned" || params.closed_month || params.close_reason) return "Vacantes cerradas";
      if (params.credited_to) return "Vacantes con colocación";
      return params.scope === "assigned" ? "Vacantes asignadas" : "Vacantes";
    }
    case "placements": return params.held === "true" ? "Placements que se sostuvieron" : params.held === "false" ? "Placements que no se sostuvieron" : "Placements";
    case "reassignments": {
      const reason = single(params.reason);
      const base = params.direction === "received" ? "Reasignaciones recibidas" : params.direction === "lost" ? "Reasignaciones perdidas" : "Reasignaciones";
      return reason ? `${base} por ${REASSIGNMENT_REASON_LABEL[reason as keyof typeof REASSIGNMENT_REASON_LABEL].toLowerCase()}` : base;
    }
    case "candidates": return "Candidatos";
    case "applications": return "Postulaciones";
  }
}

/** «Entregas tarde · Jorge Paredes», «Vacantes cerradas · octubre 2026», «Placements · Grupo Bimbo». */
export function detailTitle(state: DetailState, applied?: AppliedFilters): string {
  const month = state.params.commitment_month ?? state.params.closed_month;
  const subjects = [subjectPerson(state, applied), requesterName(state, applied), vacancyTitle(state, applied), month && monthName(month)].filter(Boolean);
  return [figureTitle(state), ...subjects].join(" · ");
}

export type Chip = { key: string; label: string; remove: string[] };
/** One removable chip per active filter, in the order of the URL; sort and order are not filters. */
export function filterChips(state: DetailState, applied?: AppliedFilters): Chip[] {
  if (!isListKind(state.kind)) return [];
  const { params } = state;
  const chips: Chip[] = [];
  const add = (key: string, label: string, remove = [key]) => chips.push({ key, label, remove });
  const person = (key: PersonKey) => personName(state, applied, key) ?? LOADING_NAME;
  if (params.recruiter_id) add("recruiter_id", `Reclutador: ${person("recruiter")}`, ["recruiter_id", "direction"]);
  if (params.requester_kind || params.requester_id) add("requester", `Cliente o área: ${requesterName(state, applied) ?? LOADING_NAME}`, ["requester_kind", "requester_id"]);
  if (params.vacancy_id) add("vacancy_id", `Vacante: ${vacancyTitle(state, applied) ?? LOADING_NAME}`);
  if (params.attributed_to) add("attributed_to", `Responsable: ${person("attributed_to")}`);
  if (params.recipient) add("recipient", `Acreditado a: ${person("recipient")}`);
  if (params.credited_to) add("credited_to", `Con colocación de: ${person("credited_to")}`);
  if (params.result) add("result", `Estado: ${list(params.result, RESULT_LABEL)}`);
  if (params.late_bucket) add("late_bucket", `Retraso: ${LATE_BUCKET_LABEL[params.late_bucket]}`);
  if (params.commitment_month) add("commitment_month", `Mes de la fecha meta: ${monthName(params.commitment_month)}`);
  if (params.scope) add("scope", `Vacantes: ${SCOPE_LABEL[params.scope]}`);
  if (params.closed_month) add("closed_month", `Mes de cierre: ${monthName(params.closed_month)}`);
  if (params.close_reason) add("close_reason", `Motivo de cierre: ${list(params.close_reason, CLOSE_REASON_LABEL)}`);
  if (params.closing_target) add("closing_target", `Meta de cierre: ${CLOSING_TARGET_LABEL[params.closing_target]}`);
  if (params.held) add("held", `Permanencia: ${HELD_LABEL[params.held]}`);
  if (params.direction) add("direction", `Dirección: ${DIRECTION_LABEL[params.direction]}`);
  if (params.reason) add("reason", `Motivo: ${list(params.reason, REASSIGNMENT_REASON_LABEL)}`);
  return chips;
}

const ON_TIME_UNIVERSE = ["on_time", "late", "overdue"];
const VERB: Record<string, [string, string]> = {
  on_time: ["llegó a tiempo", "llegaron a tiempo"], late: ["llegó tarde", "llegaron tarde"], overdue: ["está vencida", "están vencidas"],
  pending: ["está pendiente", "están pendientes"], not_configured: ["no tiene meta de entrega", "no tienen meta de entrega"],
};
/** Summary parts: `[text, bold]`. */
export type SummaryPart = readonly [string, boolean];
/**
 * «4 de 5 entregas de Jorge Paredes llegaron tarde en el periodo — 80 %» for one delivery result, against the same
 * universe as the board's on-time rate (a tiempo + tarde + vencidas) or every delivery for pending and sin meta;
 * «N registros» otherwise.
 */
export function summaryLine(state: DetailState, data: DetailPage): SummaryPart[] {
  const result = single(state.params.result);
  if (data.kind === "deliveries" && result && VERB[result]) {
    const facets = data.page.facets.result;
    const universe = ON_TIME_UNIVERSE.includes(result) ? ON_TIME_UNIVERSE : Object.keys(facets);
    const of = universe.reduce((sum, key) => sum + facets[key as keyof typeof facets], 0);
    const count = facets[result as keyof typeof facets];
    const percent = share(count, of);
    if (percent !== null) {
      const person = subjectPerson(state, data.page.applied_filters);
      return [[`${number.format(count)} de ${number.format(of)}`, true], [` entregas${person ? ` de ${person}` : ""} ${VERB[result][count === 1 ? 0 : 1]} en el periodo — `, false], [percent, true], [".", false]];
    }
  }
  return [[plural(data.page.total, "registro", "registros"), false]];
}
