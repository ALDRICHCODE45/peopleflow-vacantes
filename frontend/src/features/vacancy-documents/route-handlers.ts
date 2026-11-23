import "server-only";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { openDocumentFile, postMultipart, type BinaryFailure } from "./binary-client";
import { mapDocumentFailure, routeEnvelope } from "./failure";
import { DOCUMENT_REQUEST_CAP_BYTES, MAX_DOCUMENT_BYTES } from "./model";
import { backendScopePath, isId, type DocumentScope } from "./paths";

/**
 * Shared bodies of the BFF route handlers under `/api/company/job-drafts/[draftId]/…` (the paths mirror the backend's). Binary goes
 * through these routes, not through Server Actions: the multipart body is streamed with a hard cap, downloads are streamed back as
 * attachments. The routes hold no business rule: the backend authorizes, validates and audits; this layer only guards the transport.
 */
type Params = { draftId: string; participationId?: string };
const noStore = { "cache-control": "no-store", "x-content-type-options": "nosniff" } as const;
const UUID_HEADER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[1-9][0-9]{0,8}$/;

export const routeError = (status: number, code: string, extra: Record<string, unknown> = {}): Response =>
  Response.json({ error: code, code, ...extra }, { status, headers: noStore });
const tooLarge = (): Response => routeError(413, "payload_too_large", { data: { max_bytes: MAX_DOCUMENT_BYTES } });

/** The backend status is kept (400–599) and so are the allowlisted `data`/`fields`; its text never is. */
function failureResponse(failure: BinaryFailure): Response {
  if (failure.tooLarge) return tooLarge();
  const mapped = mapDocumentFailure({ error: failure.error, ...(failure.envelope ? { envelope: failure.envelope } : {}) });
  const status = failure.error.status;
  const out = status !== undefined && status >= 400 && status < 600 ? status : failure.error.kind === "invalid_request" ? 400 : failure.error.kind === "network" || failure.error.kind === "timeout" ? 503 : 502;
  const known = failure.envelope && mapped.reference.code ? routeEnvelope(failure.envelope) : undefined;
  return known ? Response.json(known, { status: out, headers: noStore }) : routeError(out, mapped.reason);
}

async function guard(params: Params): Promise<{ token: string; scope: string } | Response> {
  const token = await getActionAccessToken();
  if (!token?.trim()) return routeError(401, "unauthenticated");
  const scope = backendScopePath(params as DocumentScope);
  return scope === null ? routeError(404, "not_found") : { token: token.trim(), scope };
}

type WriteTarget = { path: string; idempotent: boolean };
async function writeMultipart(request: Request, params: Params, target: (scope: string) => WriteTarget | undefined): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return routeError(403, "forbidden");
    const ready = await guard(params);
    if (ready instanceof Response) return ready;
    const where = target(ready.scope);
    if (!where) return routeError(404, "not_found");
    let idempotencyKey: string | undefined;
    if (where.idempotent) {
      const key = request.headers.get("idempotency-key");
      if (key !== null && !UUID_HEADER.test(key)) return routeError(400, "invalid_idempotency_key");
      idempotencyKey = key ?? undefined;
    }
    const length = request.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length)))) return routeError(400, "invalid_request");
    if (length !== null && Number(length) > DOCUMENT_REQUEST_CAP_BYTES) return tooLarge();
    const type = request.headers.get("content-type") ?? "";
    if (!/^multipart\/form-data\s*;/i.test(type) || type.length > 256 || /[\r\n]/.test(type)) return routeError(400, "invalid_request");
    if (!request.body) return routeError(400, "invalid_request");
    const result = await postMultipart({
      token: ready.token, path: where.path, contentType: type, body: request.body, capBytes: DOCUMENT_REQUEST_CAP_BYTES,
      ...(idempotencyKey ? { idempotencyKey } : {}), signal: request.signal,
    });
    if (!result.ok) return failureResponse(result);
    return Response.json(result.data, { status: 201, headers: { ...noStore, ...(result.replayed ? { "idempotency-replayed": result.replayed } : {}) } });
  } catch { return routeError(503, "no_response"); }
}

/** `POST P/documents`: multipart `file` (+ optional `name`) and the optional `Idempotency-Key`, which is forwarded once it is a UUID. */
export const uploadDocument = (request: Request, params: Params): Promise<Response> =>
  writeMultipart(request, params, scope => ({ path: `${scope}/documents`, idempotent: true }));

/** `POST P/documents/{doc}/versions`: multipart `expected_version`, `file` (+ optional `name`); no idempotency key (the version check is the guard). */
export const replaceDocument = (request: Request, params: Params & { documentId: string }): Promise<Response> =>
  writeMultipart(request, params, scope => isId(params.documentId) ? { path: `${scope}/documents/${params.documentId}/versions`, idempotent: false } : undefined);

async function download(params: Params, path: (scope: string) => string | undefined): Promise<Response> {
  try {
    const ready = await guard(params);
    if (ready instanceof Response) return ready;
    const where = path(ready.scope);
    if (!where) return routeError(404, "not_found");
    const result = await openDocumentFile(ready.token, where);
    if (!result.ok) return failureResponse(result);
    return new Response(result.data.body, { status: 200, headers: {
      ...noStore, "content-type": result.data.contentType, "content-disposition": result.data.disposition,
      ...(result.data.contentLength ? { "content-length": result.data.contentLength } : {}),
    } });
  } catch { return routeError(503, "no_response"); }
}

/** `GET P/documents/{doc}/file`: the current version, always as an attachment (audited by the backend before the first byte). */
export const downloadDocument = (params: Params & { documentId: string }): Promise<Response> =>
  download(params, scope => isId(params.documentId) ? `${scope}/documents/${params.documentId}/file` : undefined);
/** `GET P/documents/{doc}/versions/{n}/file`: one numbered version (S5: history is downloadable). */
export const downloadDocumentVersion = (params: Params & { documentId: string; version: string }): Promise<Response> =>
  download(params, scope => isId(params.documentId) && VERSION.test(params.version) ? `${scope}/documents/${params.documentId}/versions/${params.version}/file` : undefined);
/** `GET P/document-links/{link}/file`: the PINNED version of a link (404 when the link is removed or inaccessible). */
export const downloadDocumentLink = (params: Params & { linkId: string }): Promise<Response> =>
  download(params, scope => isId(params.linkId) ? `${scope}/document-links/${params.linkId}/file` : undefined);
