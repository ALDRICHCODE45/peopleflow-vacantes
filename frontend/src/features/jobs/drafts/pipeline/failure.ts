import "server-only";

import { z } from "zod";
import type { DraftPipelineFailure } from "./client";

/** A missing list is legal only for publication_incomplete, on publish or save. */
export const publicationErrorEnvelopeSchema = z.union([
  z.object({ error: z.string().min(1), code: z.literal("publication_incomplete"), missing: z.array(z.string().refine(value => value.trim().length > 0)) }).strict(),
  z.object({ error: z.string().min(1), code: z.string().min(1).refine(code => code !== "publication_incomplete") }).strict(),
]);

export type DraftPipelineActionFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "company_inactive" | "not_found" | "company_not_active" |
    "invalid_request" | "validation_error" | "version_conflict" | "precondition_required" |
    "payload_too_large" | "server_error" | "no_response" | "unrecognized_response" | "non_business_date" | "cutoff_stage_in_use";
  reference: { status?: number; code?: string };
};

/** Only content, delivery and management saves must preserve published readiness. */
export type PublicationIncompleteFailure = {
  ok: false;
  reason: "publication_incomplete";
  missing: string[];
  reference: { status?: number; code?: string };
};
export type DraftPublishedSaveActionFailure = DraftPipelineActionFailure | PublicationIncompleteFailure;
export type DraftPublicationActionFailure = DraftPublishedSaveActionFailure | {
  ok: false;
  reason: "already_published" | "idempotency_conflict";
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

/** Recheck the strict envelope at the action boundary; never forward backend messages. */
export function publicationIncompleteFailure(input: { error: { kind: string; status?: number }; envelope?: unknown }): PublicationIncompleteFailure | undefined {
  if (input.error.status !== 422) return;
  const parsed = publicationErrorEnvelopeSchema.safeParse(input.envelope);
  if (parsed.success && parsed.data.code === "publication_incomplete" && "missing" in parsed.data) {
    return { ok: false, reason: "publication_incomplete", missing: parsed.data.missing, reference: { status: 422, code: "publication_incomplete" } };
  }
}
export function mapDraftPublishedSaveFailure(input: Omit<DraftPipelineFailure, "envelope"> & { envelope?: { error: string; code: string; missing?: string[] } }): DraftPublishedSaveActionFailure {
  return publicationIncompleteFailure(input) ?? mapDraftPipelineFailure(input);
}
export function mapDraftPublicationFailure(input: Omit<DraftPipelineFailure, "envelope"> & { envelope?: { error: string; code: string; missing?: string[] } }): DraftPublicationActionFailure {
  const status = input.error.status;
  const code = input.envelope?.code;
  if (status === 409 && (code === "already_published" || code === "idempotency_conflict")) return { ok: false, reason: code, reference: { status, code } };
  return mapDraftPublishedSaveFailure(input);
}
