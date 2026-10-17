import "server-only";
import type { ClientFailure } from "./me-client";
import type { IdentityFailure } from "./model";
const safeCodes = new Set(["unauthenticated", "account_exists", "email_in_use", "email_not_verified", "validation_error", "invalid_request", "identity_unavailable", "internal_error"]);
export function identityFailure({ error, envelope }: ClientFailure): IdentityFailure {
  const status = error.status;
  const code = envelope && safeCodes.has(envelope.code) ? envelope.code : undefined;
  let reason: IdentityFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request" || (status === 400 && (code === "validation_error" || code === "invalid_request"))) reason = "validation_error";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 409 && (code === "account_exists" || code === "email_in_use")) reason = code;
  else if (status === 422 && code === "email_not_verified") reason = code;
  else if (status === 503 && code === "identity_unavailable") reason = code;
  else if (status !== undefined && status >= 500 && status < 600) reason = "server_error";
  return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
}
