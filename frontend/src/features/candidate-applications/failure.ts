import { CODES, type ErrorEnvelope, type Failure } from "./model";
export type ClientFailure = { ok: false; error: { kind: string; status?: number }; envelope?: ErrorEnvelope };
const statuses: Record<string, readonly number[]> = { vacancy_unavailable: [410], vacancy_not_accepting_applications: [409], applicant_country_required: [422], applicant_country_not_allowed: [422], already_applied: [409], questionnaire_changed: [409], invalid_answers: [422], cv_unavailable: [422], invalid_request: [400], idempotency_conflict: [409], invalid_idempotency_key: [400], idempotency_key_required: [400], precondition_required: [428] };
export function applicationFailure({ error, envelope }: ClientFailure): Failure {
  const status = error.status;
  const code = envelope && (CODES as readonly string[]).includes(envelope.code) ? envelope.code : undefined;
  let reason: Failure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request") reason = "invalid_request";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 403) reason = code === "wrong_role" ? "wrong_role" : "forbidden";
  else if (status === 404) reason = "not_found";
  else if (status !== undefined && status >= 500) reason = "server_error";
  else if (code && status !== undefined && statuses[code]?.includes(status)) reason = code as Failure["reason"];
  if (reason === "vacancy_unavailable" && envelope?.code === "vacancy_unavailable" && "data" in envelope && "id" in envelope.data) return { ok: false, reason, vacancy: envelope.data, reference: { status, code } };
  if (reason === "vacancy_not_accepting_applications" && envelope && "data" in envelope && "availability" in envelope.data) return { ok: false, reason, availability: envelope.data.availability, reference: { status, code } };
  return { ok: false, reason, ...((reason === "applicant_country_required" || reason === "applicant_country_not_allowed") && envelope && "data" in envelope && "allowed" in envelope.data ? { allowed: envelope.data.allowed } : {}), reference: { ...(status === undefined ? {} : { status }), ...(code ? { code } : {}) }, ...(reason === "invalid_answers" && envelope && "details" in envelope ? { details: envelope.details } : {}) };
}
