import { z } from "zod";
import { parseGeographyErrors, type GeographyErrors } from "@/features/geo/model";

import { requestJson } from "../../../../lib/api/server";
import type { RequestJsonError } from "../../../../lib/api/server";
import { isValidJobId } from "../../jobId";
import { draftReadEnvelopeV2Schema, draftWriteEnvelopeV2Schema } from "../read-v2";
import type { DraftReadEnvelopeV2, DraftWriteEnvelopeV2 } from "../read-v2";
import { draftV2PatchBodySchema, draftV2PostBodySchema } from "../screening-v2/wire";
import type { DraftV2PatchBody, DraftV2PostBody } from "../screening-v2/wire";
import { publicationErrorEnvelopeSchema } from "../pipeline/failure";

/**
 * Additive server-only v2 draft transport client for the private vacancy draft
 * contract (`docs/contracts/private-vacancy-drafts-v2-screening.md` §1, §3, §4).
 *
 * Surface (v2 routes only; the v1 client and its routes stay untouched):
 * - `createDraftV2` → `POST /v2/me/company/job-drafts` (201 + `ETag` + `Idempotency-Replayed`)
 * - `getDraftV2`    → `GET  /v2/me/company/job-drafts/{id}`     (200 + `ETag`)
 * - `saveDraftV2`   → `PATCH /v2/me/company/job-drafts/{id}`    (200 + `ETag`, `If-Match`)
 *
 * Write bodies are validated through the approved v2 schemas
 * (`draftV2PostBodySchema` / `draftV2PatchBodySchema`) before any request, and
 * read responses through `draftReadEnvelopeV2Schema`: a v1 write shape, an
 * unknown/read-only field, a malformed UUID, or a blank/absent `If-Match` is a
 * local `invalid_request`/`invalid_response`, never a network call. The caller's
 * objects are never mutated and no idempotency key is ever generated — a failed
 * `POST` keeps the caller's key + payload so it can be replayed.
 *
 * The credential, the idempotency key and the `If-Match` tag are explicit
 * caller inputs. This module never reads cookies, headers, a session store or
 * `process.env` for identity, and never consults the sample-jobs switch, so a
 * missing or blank credential fails closed before the environment module or the
 * network is touched.
 *
 * Success requires exactly 201 (`POST`) or 200 (`GET`/`PATCH`), an opaque
 * non-blank `ETag`, and for `POST` a raw `Idempotency-Replayed` of `"true"` or
 * `"false"`. The `ETag` stays a separate opaque header: it is never parsed,
 * reconstructed or folded into the envelope. `GET`/`PATCH` responses must carry
 * the requested draft id (UUID case-insensitive); the private
 * `correct_option_id`, UUID hex case and question/option order survive verbatim.
 *
 * The client performs no automatic retries and has no v1 fallback: every
 * mutation failure is `retryable: false`, even when the generic transport flags
 * a network error or 5xx as retryable, because an uncertain write must be
 * reconciled with an explicit `GET`. Failures preserve the backend
 * `{ error, code }` envelope; PATCH additionally preserves the strictly decoded
 * publication_incomplete missing list. Other errors keep the existing behavior
 * of dropping `data` and unknown fields (v2 has no error `data`).
 *
 * Limitations: this does not verify tokens or tenant ownership, does not prove
 * the v2 endpoints exist, and does not touch the response cache or the editor.
 * It makes no editor/session/UI saving, publication, migration or database
 * claim. The underlying server `fetch` has no ambient cookie jar; redirect
 * behavior is the transport default and is left unchanged.
 */
import { draftValidationEnvelopeSchema, type DraftValidationIssue } from "../validation-errors";
const DRAFTS_V2_PATH = "/v2/me/company/job-drafts";
const CREATE_STATUS = 201;
const READ_STATUS = 200;
const CAPTURE_HEADERS = ["etag", "idempotency-replayed"] as const;

/**
 * Backend error envelope. Only `error` and `code` are part of the v2 taxonomy;
 * any other key (including a stray `data`) is dropped rather than surfaced.
 */
const draftV2ErrorEnvelopeSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1),
});
export type DraftV2ErrorEnvelope = z.infer<typeof draftV2ErrorEnvelopeSchema> & { missing?: string[]; geography?: GeographyErrors; fields?: DraftValidationIssue[] };

/**
 * Every v2 draft-client failure. Shaped like `RequestJsonError` so read callers
 * keep the exact transport classification, but `retryable` stays a plain boolean
 * so a mutation can force `false` for network/timeout/5xx too.
 */
export type DraftV2ClientError =
  | { kind: "missing_token"; retryable: false }
  | { kind: "invalid_request"; retryable: false }
  | { kind: "invalid_response"; retryable: false }
  | { kind: "not_found"; retryable: false; status: number }
  | { kind: "status"; retryable: boolean; status: number }
  | { kind: "network"; retryable: boolean }
  | { kind: "timeout"; retryable: boolean };

export type CreateDraftV2Input = { token: string; idempotencyKey: string; body: unknown };
export type GetDraftV2Input = { token: string; id: string };
export type SaveDraftV2Input = { token: string; id: string; ifMatch: string; body: unknown };

export type DraftV2Failure = {
  ok: false;
  error: DraftV2ClientError;
  envelope?: DraftV2ErrorEnvelope;
};
export type DraftV2CreateSuccess = {
  ok: true;
  data: DraftWriteEnvelopeV2;
  etag: string;
  idempotencyReplayed: "true" | "false";
};
export type DraftV2ReadSuccess = { ok: true; data: DraftReadEnvelopeV2; etag: string };
export type CreateDraftV2Result = DraftV2CreateSuccess | DraftV2Failure;
export type GetDraftV2Result = DraftV2ReadSuccess | DraftV2Failure;
export type DraftV2SaveSuccess = { ok: true; data: DraftWriteEnvelopeV2; etag: string };
export type SaveDraftV2Result = DraftV2SaveSuccess | DraftV2Failure;

function failure(error: DraftV2ClientError, envelope?: DraftV2ErrorEnvelope): DraftV2Failure {
  return envelope === undefined ? { ok: false, error } : { ok: false, error, envelope };
}

/**
 * Mutation failures are never retryable: a transport `network`/`timeout`/5xx
 * flag describes the generic transport, not a safe automatic write retry.
 */
function withoutRetry(error: RequestJsonError): DraftV2ClientError {
  switch (error.kind) {
    case "timeout":
      return { kind: "timeout", retryable: false };
    case "network":
      return { kind: "network", retryable: false };
    case "status":
      return { kind: "status", retryable: false, status: error.status };
    case "not_found":
    case "invalid_response":
      return error;
  }
}

function transportFailure(
  error: RequestJsonError,
  envelope: DraftV2ErrorEnvelope | undefined,
  keepRetryable: boolean,
): DraftV2Failure {
  return failure(keepRetryable ? error : withoutRetry(error), envelope);
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** Validates the v2 payload, then enforces the requested draft identity. */
function decodeReadEnvelopeV2(expectedId: string) {
  return (value: unknown): DraftReadEnvelopeV2 => {
    const envelope = draftReadEnvelopeV2Schema.parse(value);
    if (envelope.id.toLowerCase() !== expectedId.toLowerCase()) {
      throw new Error("draft response id does not match the requested draft");
    }
    return envelope;
  };
}

/** Same identity guard for create/save responses, which carry no `lifecycle`. */
function decodeWriteEnvelopeV2(expectedId: string) {
  return (value: unknown): DraftWriteEnvelopeV2 => {
    const envelope = draftWriteEnvelopeV2Schema.parse(value);
    if (envelope.id.toLowerCase() !== expectedId.toLowerCase()) {
      throw new Error("draft response id does not match the requested draft");
    }
    return envelope;
  };
}

const decodeErrorEnvelope = (value: unknown): DraftV2ErrorEnvelope => {
  const envelope = draftV2ErrorEnvelopeSchema.parse(value);
  if (envelope.code === "validation_error") return draftValidationEnvelopeSchema.parse(value);
  if (envelope.code === "invalid_location" || envelope.code === "invalid_remote_scope") {
    const geography = parseGeographyErrors(422, value);
    if (!geography) throw new Error("Invalid geography error envelope");
    return { ...envelope, geography };
  }
  return envelope;
};
function decodeSaveErrorEnvelope(value: unknown): DraftV2ErrorEnvelope {
  // A missing list is legal only for this code. All other draft error handling
  // keeps its existing stripping behavior, including create and read failures.
  if (value !== null && typeof value === "object" &&
    (("code" in value && value.code === "publication_incomplete") || "missing" in value)) {
    return publicationErrorEnvelopeSchema.parse(value);
  }
  return decodeErrorEnvelope(value);
}

/** Creates one private v2 draft. `POST /v2/me/company/job-drafts`. */
export async function createDraftV2(input: CreateDraftV2Input): Promise<CreateDraftV2Result> {
  if (isBlank(input.token)) return failure({ kind: "missing_token", retryable: false });
  if (!isValidJobId(input.idempotencyKey)) return failure({ kind: "invalid_request", retryable: false });

  let body: DraftV2PostBody;
  try {
    body = draftV2PostBodySchema.parse(input.body);
  } catch {
    return failure({ kind: "invalid_request", retryable: false });
  }

  // Imported lazily so every guard above runs without environment validation.
  const { serverEnv } = await import("../../../../lib/env/server");

  const result = await requestJson<DraftWriteEnvelopeV2, DraftV2ErrorEnvelope>(
    new URL(DRAFTS_V2_PATH, serverEnv.apiBaseUrl).toString(),
    {
      decoder: (value: unknown) => draftWriteEnvelopeV2Schema.parse(value),
      errorDecoder: decodeErrorEnvelope,
      method: "POST",
      redirect: "error",
      expectedStatus: CREATE_STATUS,
      body,
      headers: {
        authorization: `Bearer ${input.token.trim()}`,
        "idempotency-key": input.idempotencyKey,
      },
      captureResponseHeaders: CAPTURE_HEADERS,
      timeoutMs: serverEnv.apiTimeoutMs,
    },
  );

  if (!result.ok) return transportFailure(result.error, result.envelope, false);

  const etag = result.headers?.etag;
  const replayed = result.headers?.["idempotency-replayed"];
  if (!isPresent(etag) || (replayed !== "true" && replayed !== "false")) {
    return failure({ kind: "invalid_response", retryable: false });
  }
  return { ok: true, data: result.data, etag, idempotencyReplayed: replayed };
}

/** Reads one private v2 draft by id. `GET /v2/me/company/job-drafts/{id}`. */
export async function getDraftV2(input: GetDraftV2Input): Promise<GetDraftV2Result> {
  if (isBlank(input.token)) return failure({ kind: "missing_token", retryable: false });
  if (!isValidJobId(input.id)) return failure({ kind: "invalid_request", retryable: false });

  const { serverEnv } = await import("../../../../lib/env/server");

  const result = await requestJson<DraftReadEnvelopeV2, DraftV2ErrorEnvelope>(
    new URL(`${DRAFTS_V2_PATH}/${input.id}`, serverEnv.apiBaseUrl).toString(),
    {
      decoder: decodeReadEnvelopeV2(input.id),
      errorDecoder: decodeErrorEnvelope,
      redirect: "error",
      expectedStatus: READ_STATUS,
      headers: { authorization: `Bearer ${input.token.trim()}` },
      captureResponseHeaders: CAPTURE_HEADERS,
      timeoutMs: serverEnv.apiTimeoutMs,
    },
  );

  // A read may be retried by the caller; keep the transport classification.
  if (!result.ok) return transportFailure(result.error, result.envelope, true);

  const etag = result.headers?.etag;
  if (!isPresent(etag)) return failure({ kind: "invalid_response", retryable: false });
  return { ok: true, data: result.data, etag };
}

/** Explicitly saves changed v2 fields under compare-and-set. `PATCH /v2/me/company/job-drafts/{id}`. */
export async function saveDraftV2(input: SaveDraftV2Input): Promise<SaveDraftV2Result> {
  if (isBlank(input.token)) return failure({ kind: "missing_token", retryable: false });
  if (!isValidJobId(input.id)) return failure({ kind: "invalid_request", retryable: false });
  if (isBlank(input.ifMatch)) return failure({ kind: "invalid_request", retryable: false });

  let body: DraftV2PatchBody;
  try {
    body = draftV2PatchBodySchema.parse(input.body);
  } catch {
    return failure({ kind: "invalid_request", retryable: false });
  }

  const { serverEnv } = await import("../../../../lib/env/server");

  const result = await requestJson<DraftWriteEnvelopeV2, DraftV2ErrorEnvelope>(
    new URL(`${DRAFTS_V2_PATH}/${input.id}`, serverEnv.apiBaseUrl).toString(),
    {
      decoder: decodeWriteEnvelopeV2(input.id),
      errorDecoder: decodeSaveErrorEnvelope,
      method: "PATCH",
      redirect: "error",
      expectedStatus: READ_STATUS,
      body,
      headers: {
        authorization: `Bearer ${input.token.trim()}`,
        "if-match": input.ifMatch,
      },
      captureResponseHeaders: CAPTURE_HEADERS,
      timeoutMs: serverEnv.apiTimeoutMs,
    },
  );

  if (!result.ok) return transportFailure(result.error, result.envelope, false);

  const etag = result.headers?.etag;
  if (!isPresent(etag)) return failure({ kind: "invalid_response", retryable: false });
  return { ok: true, data: result.data, etag };
}
