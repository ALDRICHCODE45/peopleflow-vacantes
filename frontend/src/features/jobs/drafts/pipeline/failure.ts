import "server-only";

import type { DraftPipelineFailure } from "./client";

export type DraftPipelineActionFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "company_inactive" | "not_found" | "company_not_active" |
    "invalid_request" | "validation_error" | "version_conflict" | "precondition_required" |
    "payload_too_large" | "server_error" | "no_response" | "unrecognized_response" | "non_business_date" | "cutoff_stage_in_use";
  reference: { status?: number; code?: string };
};

/** Publication extends the shared vocabulary without widening unrelated configuration forms. */
export type DraftPublicationActionFailure = DraftPipelineActionFailure | {
  ok: false;
  reason: "already_published" | "idempotency_conflict";
  reference: { status?: number; code?: string };
} | {
  ok: false;
  reason: "publication_incomplete";
  missing: string[];
  reference: { status?: number; code?: string };
};

const safeCodes = new Set([
  "invalid_request", "validation_error", "unauthenticated", "forbidden", "company_inactive", "non_business_date", "cutoff_stage_in_use",
  "not_found", "company_not_active", "version_conflict", "precondition_required", "payload_too_large", "internal_error",
  "publication_incomplete", "already_published", "idempotency_conflict",
]);

/** Only public classifications and allowlisted references cross the action boundary. */
export function mapDraftPipelineFailure({ error, envelope }: Omit<DraftPipelineFailure, "envelope"> & { envelope?: { error: string; code: string; missing?: string[] } }): DraftPipelineActionFailure {
  const status = error.status;
  const code = envelope && safeCodes.has(envelope.code) ? envelope.code : undefined;
  let reason: DraftPipelineActionFailure["reason"] = "unrecognized_response";
  if (error.kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (error.kind === "invalid_request" || (status === 400 && code === "invalid_request")) reason = "invalid_request";
  else if (error.kind === "network" || error.kind === "timeout") reason = "no_response";
  else if (status === 400 && code === "validation_error") reason = "validation_error";
  else if (status === 400 && code === "non_business_date") reason = "non_business_date";
  else if (status === 409 && code === "cutoff_stage_in_use") reason = "cutoff_stage_in_use";
  else if (status === 403) reason = code === "company_inactive" ? "company_inactive" : "forbidden";
  else if (status === 404) reason = "not_found";
  else if (status === 409 && code === "company_not_active") reason = "company_not_active";
  else if (status === 412) reason = "version_conflict";
  else if (status === 428) reason = "precondition_required";
  else if (status === 413) reason = "payload_too_large";
  else if (status !== undefined && status >= 500 && status < 600) reason = "server_error";
  return { ok: false, reason, reference: { ...(status !== undefined ? { status } : {}), ...(code ? { code } : {}) } };
}

export function mapDraftPublicationFailure(input: Omit<DraftPipelineFailure, "envelope"> & { envelope?: { error: string; code: string; missing?: string[] } }): DraftPublicationActionFailure {
  const { error, envelope } = input;
  const status = error.status;
  const code = envelope?.code;
  if (status === 422 && code === "publication_incomplete" && Array.isArray(envelope?.missing) && envelope.missing.every(item => typeof item === "string" && item.trim())) {
    return { ok: false, reason: "publication_incomplete", missing: envelope.missing, reference: { status, code } };
  }
  if (status === 409 && (code === "already_published" || code === "idempotency_conflict")) return { ok: false, reason: code, reference: { status, code } };
  return mapDraftPipelineFailure(input);
}
