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

const FIELD_LABEL: Record<string, string> = { from: "Desde", to: "Hasta", recruiter_id: "Reclutador", requester_kind: "Cliente o área", requester_id: "Cliente o área" };
/** One line per rejected filter, named by its control, never by the API's field name. */
export function filterIssueMessages(fields: MetricsFailure["fields"] = []): string[] {
  return [...new Set(fields.map(issue => issue.code === "range" && (issue.field === "to" || issue.field === "from")
    ? "El periodo puede abarcar hasta 366 días."
    : `Revisa el filtro «${FIELD_LABEL[issue.field] ?? "del periodo"}».`))];
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
