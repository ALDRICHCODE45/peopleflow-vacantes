import type { MetricsFailure } from "./model";

type ClientFailure = {
  error: { kind: string; status?: number };
  envelope?: { code: string; fields?: { field: string; code: string }[] };
};
const SAFE_CODES = new Set(["unauthenticated", "forbidden", "invalid_filter", "invalid_cursor", "not_found", "internal_error"]);

/** Only an allowlisted code and the status cross the boundary, and only for the status/code pairs the contract defines. */
export function toMetricsFailure({ error, envelope }: ClientFailure): MetricsFailure {
  const status = error.status;
  const code = envelope && SAFE_CODES.has(envelope.code) ? envelope.code : undefined;
  const reference = { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
  const fail = (reason: MetricsFailure["reason"], extra: Partial<MetricsFailure> = {}): MetricsFailure => ({ ok: false, reason, reference, ...extra });
  if (error.kind === "missing_token" || status === 401) return fail("unauthenticated");
  if (error.kind === "invalid_request") return fail("not_found");
  if (status === 403) return fail("forbidden");
  if (status === 404) return fail("not_found");
  if (status === 422 && code === "invalid_filter") return fail("invalid_filter", envelope?.fields ? { fields: envelope.fields } : {});
  if (status === 400 && code === "invalid_cursor") return fail("invalid_cursor");
  if (status !== undefined && status >= 500 && status < 600) return fail("server_error");
  if (error.kind === "network" || error.kind === "timeout") return fail("no_response");
  return fail("unrecognized_response");
}

/** The toolbar control each API field belongs to. */
export type FilterControl = "from" | "to" | "recruiter" | "requester";
const CONTROL: Record<string, FilterControl> = { from: "from", to: "to", recruiter_id: "recruiter", requester_kind: "requester", requester_id: "requester" };
const CONTROL_LABEL: Record<FilterControl, string> = { from: "Desde", to: "Hasta", recruiter: "Reclutador", requester: "Cliente o área" };
/** §3.7.10 codes get their own copy; any other code asks to pick a valid value of that control. */
function issueCopy(control: FilterControl, code: string): string {
  if ((control === "to" || control === "from") && code === "range") return "El periodo puede abarcar hasta 366 días.";
  if (control === "requester" && code === "required") return "Elige si el solicitante es un cliente o un área interna.";
  if (control === "recruiter") return "Elige un reclutador de la lista.";
  if (control === "requester") return "Elige un cliente o área de la lista.";
  return "Elige una fecha válida.";
}
/** One message per control, shown at that control; an unknown field has no control and is only listed in the card. */
export function fieldErrors(fields: MetricsFailure["fields"] = []): Partial<Record<FilterControl, string>> {
  const errors: Partial<Record<FilterControl, string>> = {};
  for (const issue of fields) { const control = CONTROL[issue.field]; if (control && !errors[control]) errors[control] = issueCopy(control, issue.code); }
  return errors;
}
/** The same messages for the failure card, each named by its control. */
export function filterIssueMessages(fields: MetricsFailure["fields"] = []): string[] {
  return Object.entries(fieldErrors(fields)).map(([control, message]) => control === "to" || control === "from"
    ? message! : `${CONTROL_LABEL[control as FilterControl]}: ${message!.charAt(0).toLowerCase()}${message!.slice(1)}`);
}

export function failureMessage(failure: MetricsFailure, subject = "las métricas"): string {
  switch (failure.reason) {
    case "forbidden": return "Solo el owner y los stakeholders de la empresa pueden consultar las métricas.";
    case "unauthenticated": return `Tu sesión expiró. Inicia sesión de nuevo para consultar ${subject}.`;
    case "invalid_filter": return "No pudimos aplicar el periodo o los filtros. Revísalos o restablece la vista.";
    case "invalid_cursor": return "La lista se actualizó. Volvimos a la primera página.";
    default: return `No pudimos calcular ${subject}. Nada cambió; puedes volver a intentarlo.`;
  }
}
