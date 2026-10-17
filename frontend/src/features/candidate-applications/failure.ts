import { CODES, type ErrorEnvelope, type Failure } from "./model";
export type ClientFailure = { ok: false; error: { kind: string; status?: number }; envelope?: ErrorEnvelope };
const statuses: Record<string, readonly number[]> = { already_applied: [409], questionnaire_changed: [409], invalid_answers: [422], cv_unavailable: [422], invalid_request: [400], idempotency_conflict: [409], invalid_idempotency_key: [400], idempotency_key_required: [400], precondition_required: [428] };
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
  return { ok: false, reason, reference: { ...(status === undefined ? {} : { status }), ...(code ? { code } : {}) }, ...(reason === "invalid_answers" && envelope && "details" in envelope ? { details: envelope.details } : {}) };
}
