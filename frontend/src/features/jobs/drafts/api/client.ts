import { z } from "zod";

import { requestJson } from "../../../../lib/api/server";
import type { RequestJsonError } from "../../../../lib/api/server";
import { isValidJobId } from "../../jobId";
import { draftPatchBodySchema, draftPostBodySchema } from "../fields";
import type { DraftPatchBody, DraftPostBody } from "../fields";
import { draftReadEnvelopeSchema } from "../read";
import type { DraftReadEnvelope } from "../read";

/**
 * Server-only draft transport client for the private vacancy draft contract
 * (`docs/contracts/private-vacancy-drafts-v1.md` §1, §2, §6, §8).
 *
 * Surface:
 * - `createDraft` → `POST /me/company/job-drafts`  (201 + `ETag` + `Idempotency-Replayed`)
 * - `getDraft`    → `GET  /me/company/job-drafts/{id}`      (200 + `ETag`)
 * - `saveDraft`   → `PATCH /me/company/job-drafts/{id}`     (200 + `ETag`, `If-Match`)
 *
 * The credential, the idempotency key and the `If-Match` tag are explicit
 * caller inputs. This module never reads cookies, headers, a session store or
 * `process.env` for identity, so it cannot invent authentication; it also never
 * consults the sample-jobs switch. A missing or blank credential fails closed
 * before the environment module or the network is touched.
 *
 * Write bodies are validated through the approved T3e schemas before any
 * request: an unknown/read-only field, a malformed UUID, or a blank/absent
 * `If-Match` is a local `invalid_request`, never a network call. The caller's
 * objects are never mutated, and no idempotency key is ever generated — a
 * failed `POST` keeps the caller's frozen key + payload so it can be replayed.
 *
 * Success requires exactly 201 (`POST`) or 200 (`GET`/`PATCH`), an opaque
 * non-blank `ETag`, and for `POST` a raw `Idempotency-Replayed` of `"true"` or
 * `"false"`. Missing or malformed required headers are an `invalid_response`,
 * never a success. The `ETag` is treated as opaque and is never parsed or
 * reconstructed. `GET`/`PATCH` responses must carry the requested draft id
 * (UUID case-insensitive).
 *
 * Failures preserve the backend `{ error, code }` envelope only; `data` and
 * unknown error fields are discarded here. The client performs no automatic
 * retries and reports every mutation failure as `retryable: false`, even when
 * the generic transport flags a network error or 5xx as retryable: an uncertain
 * write must be reconciled with an explicit `GET`.
 *
 * Limitations: this does not verify tokens or tenant ownership, does not prove
 * backend endpoint availability, and does not touch the response cache. The
 * underlying server `fetch` has no ambient cookie jar; redirect behavior is the
 * transport default and is left unchanged.
 */
const DRAFTS_PATH = "/me/company/job-drafts";
const CREATE_STATUS = 201;
const READ_STATUS = 200;
const CAPTURE_HEADERS = ["etag", "idempotency-replayed"] as const;

/**
 * Backend error envelope (`httpjson.ErrorEnvelope`). Only `error` and `code`
 * are part of this slice: `data` is defined for the requester-catalog duplicate
 * path only, so it is dropped rather than surfaced through the draft client.
 */
const draftErrorEnvelopeSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1),
});
export type DraftErrorEnvelope = z.infer<typeof draftErrorEnvelopeSchema>;

/** Local pre-flight guards; both fail before the environment or the network. */
export type DraftGuardError =
  | { kind: "missing_token"; retryable: false }
  | { kind: "invalid_request"; retryable: false };

/**
 * Every draft-client failure. Shaped like `RequestJsonError` so read callers
 * keep the exact transport classification, but `retryable` stays a plain
 * boolean so a mutation can force `false` for network/timeout/5xx too.
 */
export type DraftClientError =
  | { kind: "missing_token"; retryable: false }
  | { kind: "invalid_request"; retryable: false }
  | { kind: "invalid_response"; retryable: false }
  | { kind: "not_found"; retryable: false; status: number }
  | { kind: "status"; retryable: boolean; status: number }
  | { kind: "network"; retryable: boolean }
  | { kind: "timeout"; retryable: boolean };

export type CreateDraftInput = { token: string; idempotencyKey: string; body: unknown };
export type GetDraftInput = { token: string; id: string };
export type SaveDraftInput = { token: string; id: string; ifMatch: string; body: unknown };

export type DraftFailure = {
  ok: false;
  error: DraftClientError;
  envelope?: DraftErrorEnvelope;
};
export type DraftCreateSuccess = {
  ok: true;
  data: DraftReadEnvelope;
  etag: string;
  idempotencyReplayed: "true" | "false";
};
export type DraftReadSuccess = { ok: true; data: DraftReadEnvelope; etag: string };
export type CreateDraftResult = DraftCreateSuccess | DraftFailure;
export type GetDraftResult = DraftReadSuccess | DraftFailure;
export type SaveDraftResult = DraftReadSuccess | DraftFailure;

function failure(error: DraftClientError, envelope?: DraftErrorEnvelope): DraftFailure {
  return envelope === undefined ? { ok: false, error } : { ok: false, error, envelope };
}

/**
 * Mutation failures are never retryable: a transport `network`/`timeout`/5xx
 * flag describes the generic transport, not a safe automatic write retry.
 */
function withoutRetry(error: RequestJsonError): DraftClientError {
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
  envelope: DraftErrorEnvelope | undefined,
  keepRetryable: boolean,
): DraftFailure {
  return failure(keepRetryable ? error : withoutRetry(error), envelope);
}

function isBlank(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

/** Validates the payload, then enforces the requested draft identity. */
function decodeReadEnvelope(expectedId: string) {
  return (value: unknown): DraftReadEnvelope => {
    const envelope = draftReadEnvelopeSchema.parse(value);
    if (envelope.id.toLowerCase() !== expectedId.toLowerCase()) {
      throw new Error("draft response id does not match the requested draft");
    }
    return envelope;
  };
}

const decodeErrorEnvelope = (value: unknown): DraftErrorEnvelope => draftErrorEnvelopeSchema.parse(value);

/** Creates one private draft. `POST /me/company/job-drafts`. */
export async function createDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
  if (isBlank(input.token)) return failure({ kind: "missing_token", retryable: false });
  if (!isValidJobId(input.idempotencyKey)) return failure({ kind: "invalid_request", retryable: false });

  let body: DraftPostBody;
  try {
    body = draftPostBodySchema.parse(input.body);
  } catch {
    return failure({ kind: "invalid_request", retryable: false });
  }

  // Imported lazily so every guard above runs without environment validation.
  const { serverEnv } = await import("../../../../lib/env/server");

  const result = await requestJson<DraftReadEnvelope, DraftErrorEnvelope>(
    new URL(DRAFTS_PATH, serverEnv.apiBaseUrl).toString(),
    {
      decoder: (value: unknown) => draftReadEnvelopeSchema.parse(value),
      errorDecoder: decodeErrorEnvelope,
      method: "POST",
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

/** Reads one private draft by id. `GET /me/company/job-drafts/{id}`. */
export async function getDraft(input: GetDraftInput): Promise<GetDraftResult> {
  if (isBlank(input.token)) return failure({ kind: "missing_token", retryable: false });
  if (!isValidJobId(input.id)) return failure({ kind: "invalid_request", retryable: false });

  const { serverEnv } = await import("../../../../lib/env/server");

  const result = await requestJson<DraftReadEnvelope, DraftErrorEnvelope>(
    new URL(`${DRAFTS_PATH}/${input.id}`, serverEnv.apiBaseUrl).toString(),
    {
      decoder: decodeReadEnvelope(input.id),
      errorDecoder: decodeErrorEnvelope,
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

/** Explicitly saves changed fields under compare-and-set. `PATCH /me/company/job-drafts/{id}`. */
export async function saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  if (isBlank(input.token)) return failure({ kind: "missing_token", retryable: false });
  if (!isValidJobId(input.id)) return failure({ kind: "invalid_request", retryable: false });
  if (isBlank(input.ifMatch)) return failure({ kind: "invalid_request", retryable: false });

  let body: DraftPatchBody;
  try {
    body = draftPatchBodySchema.parse(input.body);
  } catch {
    return failure({ kind: "invalid_request", retryable: false });
  }

  const { serverEnv } = await import("../../../../lib/env/server");

  const result = await requestJson<DraftReadEnvelope, DraftErrorEnvelope>(
    new URL(`${DRAFTS_PATH}/${input.id}`, serverEnv.apiBaseUrl).toString(),
    {
      decoder: decodeReadEnvelope(input.id),
      errorDecoder: decodeErrorEnvelope,
      method: "PATCH",
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
