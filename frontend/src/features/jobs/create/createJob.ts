import { requestJson } from "../../../lib/api/server";
import type { RequestJsonError } from "../../../lib/api/server";
import { apiErrorEnvelopeSchema, createJobSuccessSchema } from "./schemas";
import type {
  ApiErrorEnvelope,
  CreateJobRequest,
  JobEditorView,
} from "./schemas";

/** Local pre-flight guard: without a token no request is attempted at all. */
export type MissingTokenError = { kind: "missing_token"; retryable: false };

/** Every way `createJob` can fail: the local guard or a transport classification. */
export type CreateJobError = RequestJsonError | MissingTokenError;

/**
 * Result of the authenticated create call.
 *
 * `envelope` carries the backend `{error, code, data?}` body when the backend
 * sent one, so the screen can explain `unauthenticated` or `company_not_active`
 * without a second request. When the backend sent a non-envelope body the
 * classification is preserved and `envelope` stays undefined.
 */
export type CreateJobResult =
  | { ok: true; data: JobEditorView }
  | { ok: false; error: CreateJobError; envelope?: ApiErrorEnvelope };

/**
 * Server-only client for `POST /jobs`.
 *
 * The bearer token is an explicit dependency: this module never reads cookies,
 * headers, or any session store, so it cannot invent authentication. A missing
 * or blank token fails closed before the environment or the network is touched.
 *
 * The request is sent as JSON with `Authorization: Bearer <token>`, and the
 * response must carry exactly HTTP `201` before its body is validated as the
 * editor view, so neither a malformed success payload nor a success-class
 * status the create endpoint never promised can reach the caller as typed data.
 * Importing the transport through the guarded `lib/api/server` façade keeps this
 * module server-only transitively.
 *
 * No route calls it yet: live submission stays unavailable until a real
 * recruiter token source exists.
 */
export async function createJob(
  request: CreateJobRequest,
  token: string,
): Promise<CreateJobResult> {
  const bearer = token.trim();
  if (bearer === "") {
    return { ok: false, error: { kind: "missing_token", retryable: false } };
  }

  // Loaded lazily so the token guard above never triggers the eager environment
  // validation or the server-only import resolution.
  const { serverEnv } = await import("../../../lib/env/server");

  return requestJson<JobEditorView, ApiErrorEnvelope>(
    new URL("/jobs", serverEnv.apiBaseUrl).toString(),
    {
      decoder: (value: unknown) => createJobSuccessSchema.parse(value),
      errorDecoder: (value: unknown) => apiErrorEnvelopeSchema.parse(value),
      method: "POST",
      // `POST /jobs` answers `201` only; any other success class is a contract violation.
      expectedStatus: 201,
      body: request,
      // The transport owns the JSON content type; the caller owns authorization.
      headers: { authorization: `Bearer ${bearer}` },
      timeoutMs: serverEnv.apiTimeoutMs,
    },
  );
}
