import "server-only";

import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { isValidJobId } from "@/features/jobs/jobId";
import { decodeLifecycleEtag } from "@/features/vacancy-lifecycle/model";
import { isReplacementErrorCode, replacementErrorEnvelopeSchema, validationErrorEnvelopeSchema } from "@/features/vacancy-lifecycle/replacement-errors";
import { replacementsViewSchema, startBodySchema, startedSchema, type ReplacementsView, type StartBody, type Started } from "./model";

/** Same single envelope for every error of the two endpoints; anything else keeps only `{ error, code }`. */
const genericErrorSchema = z.object({ error: z.string(), code: z.string().min(1) }).passthrough();
const incompleteSchema = z.object({ error: z.string(), code: z.literal("publication_incomplete"), missing: z.array(z.string()) }).passthrough();
export function decodeReplacementError(value: unknown) {
  const code = z.object({ code: z.string() }).parse(value).code;
  if (isReplacementErrorCode(code)) return replacementErrorEnvelopeSchema.parse(value);
  if (code === "validation_error") return validationErrorEnvelopeSchema.parse(value);
  if (code === "publication_incomplete") return incompleteSchema.parse(value);
  return genericErrorSchema.parse(value);
}
export type ReplacementFailure = {
  ok: false;
  error: { kind: "missing_token" | "invalid_request" | "invalid_response" | "not_found" | "status" | "network" | "timeout"; retryable: false; status?: number };
  envelope?: ReturnType<typeof decodeReplacementError>;
};
export type ReplacementsResult = { ok: true; data: ReplacementsView } | ReplacementFailure;
export type StartResult = { ok: true; data: Started; etag: string; idempotencyReplayed: "true" | "false" } | ReplacementFailure;
type ReadInput = { token: string; draftId: string };
export type StartInput = ReadInput & { ifMatch: string; idempotencyKey: string; body: StartBody };

const invalid = (kind: ReplacementFailure["error"]["kind"]): ReplacementFailure => ({ ok: false, error: { kind, retryable: false } });
const endpoint = async (draftId: string) => {
  const { serverEnv } = await import("@/lib/env/server");
  return { url: new URL(`/v2/me/company/job-drafts/${draftId}/replacements`, serverEnv.apiBaseUrl).toString(), serverEnv };
};

/**
 * `GET V/replacements`: the chain, the startable credits, `publish_ready`/`missing[]` and the carry candidates of `draftId`.
 * The backend sends NO `ETag` here (it is derived from several resources): none is read or required; the lifecycle ETag for
 * `If-Match` comes from `GET V/lifecycle`. A draft that never published answers 200 with `items: []` and `source_not_closed`.
 */
export async function getReplacements(input: ReadInput): Promise<ReplacementsResult> {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (!isValidJobId(input.draftId)) return invalid("invalid_request");
  const { url, serverEnv } = await endpoint(input.draftId);
  const result = await requestJson(url, {
    method: "GET", redirect: "error", expectedStatus: 200, headers: { authorization: `Bearer ${input.token.trim()}` },
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192, decoder: value => replacementsViewSchema.parse(value), errorDecoder: decodeReplacementError,
  });
  return result.ok ? { ok: true, data: result.data } : { ...result, error: { ...result.error, retryable: false } };
}

/**
 * `POST V/replacements` with the SOURCE's lifecycle ETag as `If-Match` and one `Idempotency-Key` per confirmed intent.
 * The 201 decodes only `{ id, kind, lifecycle }` (the rest is informative) plus the `ETag` and `Idempotency-Replayed` headers.
 * `Location` is not read: the transport only captures allowlisted headers and the body `id` is authoritative.
 * No retries here: the caller replays the SAME key.
 */
export async function startReplacement(input: StartInput): Promise<StartResult> {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (!isValidJobId(input.draftId) || !isValidJobId(input.idempotencyKey)) return invalid("invalid_request");
  const body = startBodySchema.safeParse(input.body);
  if (!body.success) return invalid("invalid_request");
  try { decodeLifecycleEtag(input.ifMatch, input.draftId); } catch { return invalid("invalid_request"); }
  const { url, serverEnv } = await endpoint(input.draftId);
  const result = await requestJson(url, {
    method: "POST", redirect: "error", expectedStatus: 201, body: body.data,
    headers: { authorization: `Bearer ${input.token.trim()}`, "if-match": input.ifMatch, "idempotency-key": input.idempotencyKey },
    captureResponseHeaders: ["etag", "idempotency-replayed"], timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
    decoder: value => startedSchema.parse(value), errorDecoder: decodeReplacementError,
  });
  if (!result.ok) return { ...result, error: { ...result.error, retryable: false } };
  let etag: string;
  try { etag = decodeLifecycleEtag(result.headers?.etag, result.data.id, result.data.lifecycle.version); } catch { return invalid("invalid_response"); }
  const replayed = result.headers?.["idempotency-replayed"];
  if (replayed !== "true" && replayed !== "false") return invalid("invalid_response");
  return { ok: true, data: result.data, etag, idempotencyReplayed: replayed };
}
