import "server-only";

import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { deadlineStream } from "@/features/org-candidates/detail/deadline-stream";
import { decodeDocumentEnvelope, type DocumentEnvelope } from "./failure";
import { DOCUMENT_CONTENT_TYPES, itemWriteSchema, type ItemWrite } from "./model";

/**
 * Server-only binary transport for the BFF routes: the multipart upload/replace is STREAMED to the backend (never buffered whole) while
 * a counter enforces the request cap, and downloads are streamed back. Credentials, redirects and inherited headers are never forwarded.
 */
export type BinaryFailure = {
  ok: false;
  error: { kind: "invalid_request" | "invalid_response" | "status" | "network" | "timeout"; status?: number };
  envelope?: DocumentEnvelope;
  /** The request body went over the cap while it streamed. */
  tooLarge?: boolean;
};
export type UploadSuccess = { ok: true; data: ItemWrite; replayed?: "true" | "false" };
/** The backend's own deadline for a 10 MB body on a slow link is generous; this one only stops a stalled connection. */
export const UPLOAD_DEADLINE_MS = 120_000;
export const DOWNLOAD_DEADLINE_MS = 60_000;
const RESPONSE_JSON_MAX_BYTES = 65_536;
const ERROR_JSON_MAX_BYTES = 8192;

class BodyTooLarge extends Error {}

async function backendUrl(path: string): Promise<URL | undefined> {
  const { serverEnv } = await import("@/lib/env/server");
  const base = new URL(serverEnv.apiBaseUrl);
  const url = new URL(path, base);
  return ["http:", "https:"].includes(url.protocol) && url.origin === base.origin && !url.username && !url.password ? url : undefined;
}

async function failureFrom(response: Response, signal: AbortSignal): Promise<BinaryFailure> {
  let envelope: DocumentEnvelope | undefined;
  try { envelope = decodeDocumentEnvelope(await boundedJson(response, ERROR_JSON_MAX_BYTES, signal)); } catch { /* Never expose upstream text. */ }
  return { ok: false, error: { kind: "status", status: response.status }, ...(envelope ? { envelope } : {}) };
}

export type MultipartInput = {
  token: string; path: string; contentType: string; body: ReadableStream<Uint8Array>; capBytes: number;
  idempotencyKey?: string; signal?: AbortSignal;
};

/** `POST` the incoming multipart body as is (same `Content-Type` and boundary), counting bytes against `capBytes` as they pass. */
export async function postMultipart(input: MultipartInput): Promise<UploadSuccess | BinaryFailure> {
  const url = await backendUrl(input.path);
  if (!url) return { ok: false, error: { kind: "invalid_request" } };
  const deadline = AbortSignal.timeout(UPLOAD_DEADLINE_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  let seen = 0;
  let tooLarge = false;
  const counted = input.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > input.capBytes) { tooLarge = true; controller.error(new BodyTooLarge()); return; }
      controller.enqueue(chunk);
    },
  }));
  const headers = new Headers({ authorization: `Bearer ${input.token}`, "content-type": input.contentType, accept: "application/json" });
  if (input.idempotencyKey) headers.set("idempotency-key", input.idempotencyKey);
  try {
    const response = await fetch(url, { method: "POST", headers, body: counted, duplex: "half", cache: "no-store", redirect: "error", signal } as RequestInit);
    if (tooLarge) { void response.body?.cancel().catch(() => {}); return { ok: false, error: { kind: "status", status: 413 }, tooLarge: true }; }
    if (!response.ok) return await failureFrom(response, signal);
    if (response.status !== 201) { void response.body?.cancel().catch(() => {}); return { ok: false, error: { kind: "invalid_response" } }; }
    try {
      const data = itemWriteSchema.parse(await boundedJson(response, RESPONSE_JSON_MAX_BYTES, signal));
      const replayed = response.headers.get("idempotency-replayed");
      return { ok: true, data, ...(input.idempotencyKey && (replayed === "true" || replayed === "false") ? { replayed } : {}) };
    } catch { return { ok: false, error: { kind: signal.aborted ? "timeout" : "invalid_response" } }; }
  } catch {
    if (tooLarge) return { ok: false, error: { kind: "status", status: 413 }, tooLarge: true };
    return { ok: false, error: { kind: deadline.aborted ? "timeout" : "network" } };
  }
}

export type DocumentDownload = { body: ReadableStream<Uint8Array>; contentType: string; disposition: string; contentLength?: string };
const downloadTypes: readonly (string | null)[] = DOCUMENT_CONTENT_TYPES;

/** `GET …/file`: only an `attachment` of one of the five closed content types is streamed back; anything else is `invalid_response`. */
export async function openDocumentFile(token: string, path: string): Promise<{ ok: true; data: DocumentDownload } | BinaryFailure> {
  const url = await backendUrl(path);
  if (!url) return { ok: false, error: { kind: "invalid_request" } };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, DOWNLOAD_DEADLINE_MS);
  let owned = false;
  try {
    const response = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.ok) return await failureFrom(response, controller.signal);
    const contentType = response.headers.get("content-type");
    const disposition = response.headers.get("content-disposition");
    if (response.status !== 200 || !response.body || !downloadTypes.includes(contentType) || !disposition || !/^attachment(?:;|$)/i.test(disposition) || /[\r\n]/.test(disposition)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: { kind: "invalid_response" } };
    }
    const length = response.headers.get("content-length");
    const body = deadlineStream(response.body, controller.signal, () => clearTimeout(timer));
    owned = true; // The stream now owns the deadline cleanup.
    return { ok: true, data: { body, contentType: contentType!, disposition, ...(length && /^\d+$/.test(length) && !response.headers.has("content-encoding") ? { contentLength: length } : {}) } };
  } catch { return { ok: false, error: { kind: timedOut ? "timeout" : "network" } }; }
  finally { if (!owned) clearTimeout(timer); }
}

