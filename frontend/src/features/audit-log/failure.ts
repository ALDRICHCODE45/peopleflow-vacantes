import type { AuditFailure } from "./model";

type ClientFailure = {
  error: { kind: string; status?: number };
  envelope?: { code: string; fields?: { field: string; code: string }[] };
};
const SAFE_CODES = new Set(["unauthenticated", "forbidden", "invalid_filter", "invalid_cursor", "audit_export_too_large", "internal_error"]);

/** Only an allowlisted code and the status cross the boundary, and only for the status/code pairs the contract defines. */
export function toAuditFailure({ error, envelope }: ClientFailure): AuditFailure {
  const status = error.status;
  const code = envelope && SAFE_CODES.has(envelope.code) ? envelope.code : undefined;
  const reference = { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) };
  const fail = (reason: AuditFailure["reason"], extra: Partial<AuditFailure> = {}): AuditFailure => ({ ok: false, reason, reference, ...extra });
  if (error.kind === "missing_token" || status === 401) return fail("unauthenticated");
  if (status === 403) return fail("forbidden");
  if (status === 422 && code === "invalid_filter") return fail("invalid_filter", envelope?.fields ? { fields: envelope.fields } : {});
  if (status === 400 && code === "invalid_cursor") return fail("invalid_cursor");
  if (status !== undefined && status >= 500 && status < 600) return fail("server_error");
  if (error.kind === "network" || error.kind === "timeout") return fail("no_response");
  return fail("unrecognized_response");
}
