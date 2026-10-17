import type { CvFailure } from "./model";
import { isCvCode } from "./model";
export type ClientFailure = { ok: false; error: { kind: string; status?: number }; envelope?: { error: string; code: string } };
const expected: Record<string, number> = { cv_too_large: 413, cv_unsupported_type: 415, cv_content_mismatch: 400, cv_library_full: 409, invalid_request: 400 };
/** No backend messages, exception details or arbitrary error codes cross this boundary. */
export function cvFailure({ error, envelope }: ClientFailure): CvFailure {
  const status = error.status;
  const code = envelope && isCvCode(envelope.code) ? envelope.code : undefined;
  let reason: CvFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request") reason = "invalid_request";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 403) reason = code === "wrong_role" ? "wrong_role" : "forbidden";
  else if (status === 503 && code === "cv_storage_unavailable") reason = "storage_unavailable";
  else if (status === 404) reason = "not_found";
  else if (status !== undefined && status >= 500) reason = "server_error";
  else if (code && code !== "cv_storage_unavailable" && expected[code] === status) reason = code;
  return { ok: false, reason, reference: { ...(status === undefined ? {} : { status }), ...(code ? { code } : {}) } };
}
