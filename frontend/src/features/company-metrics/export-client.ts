import "server-only";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { deadlineStream } from "@/features/org-candidates/detail/deadline-stream";
import type { MetricsClientFailure } from "./client";
import { errorEnvelopeSchema, type MetricsErrorEnvelope } from "./model";
import type { ListKind } from "./detail/query";

const PATH = "/v2/me/company/metrics";
/** The count runs before the first byte, so headers answer fast; the file itself may stream for a while. */
const EXPORT_STREAM_TIMEOUT_MS = 120_000;
const CSV_CONTENT_TYPE = /^text\/csv(?:\s*;|$)/i;
const ATTACHMENT = /^attachment(?:\s*;|$)/i;
/** `kind` picks a fixed path segment; nothing from input becomes part of the API path. */
const EXPORT_SEGMENT: Record<ListKind, string> = {
  deliveries: "deliveries", vacancies: "vacancies", placements: "placements", reassignments: "reassignments", candidates: "candidates", applications: "applications",
};

let envModule: Promise<typeof import("@/lib/env/server")> | undefined;
const loadServerEnv = async () => (await (envModule ??= import("@/lib/env/server"))).serverEnv;

const noToken: MetricsClientFailure = { ok: false, error: { kind: "missing_token", retryable: false } };
const invalidRequest: MetricsClientFailure = { ok: false, error: { kind: "invalid_request", retryable: false } };

export type MetricsCsv = { body: ReadableStream<Uint8Array>; contentType: string; disposition: string };

/**
 * v2 §8 `GET …/{kind}/export`: the list's filters, sort and order, no cursor or limit. Every error is decided before the
 * first byte (placements and candidates write their audit row first), so a 200 is the CSV, streamed without buffering.
 */
export async function exportDetail(token: string, kind: ListKind, query: URLSearchParams): Promise<{ ok: true; data: MetricsCsv } | MetricsClientFailure> {
  if (typeof token !== "string" || !token.trim()) return noToken;
  const segment = Object.hasOwn(EXPORT_SEGMENT, kind) ? EXPORT_SEGMENT[kind] : undefined;
  if (!segment || query.has("cursor") || query.has("limit")) return invalidRequest;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => { timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms); };
  try {
    const serverEnv = await loadServerEnv();
    arm(serverEnv.apiTimeoutMs);
    const base = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`${PATH}/${segment}/export${query.size ? `?${query}` : ""}`, base);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) return invalidRequest;
    const response = await fetch(url, {
      method: "GET", cache: "no-store", redirect: "error", signal: controller.signal,
      headers: { authorization: `Bearer ${token.trim()}`, accept: "text/csv" },
    });
    if (!response.ok) {
      let envelope: MetricsErrorEnvelope | undefined;
      try { envelope = errorEnvelopeSchema.parse(await boundedJson(response, 8192, controller.signal)); } catch { /* Never expose upstream text. */ }
      return { ok: false, error: { kind: "status", retryable: false, status: response.status }, ...(envelope ? { envelope } : {}) };
    }
    const contentType = response.headers.get("content-type");
    const disposition = response.headers.get("content-disposition");
    if (response.status !== 200 || !response.body || !contentType || !CSV_CONTENT_TYPE.test(contentType) || !disposition || !ATTACHMENT.test(disposition) || /[\r\n]/.test(disposition)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: { kind: "invalid_response", retryable: false } };
    }
    clearTimeout(timer);
    arm(EXPORT_STREAM_TIMEOUT_MS);
    const deadline = timer;
    const stream = deadlineStream(response.body, controller.signal, () => clearTimeout(deadline));
    timer = undefined; // The stream now owns deadline cleanup.
    return { ok: true, data: { body: stream, contentType, disposition } };
  } catch { return { ok: false, error: { kind: timedOut ? "timeout" : "network", retryable: false } }; }
  finally { if (timer) clearTimeout(timer); }
}
