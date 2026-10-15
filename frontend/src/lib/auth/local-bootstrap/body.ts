import { LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS } from "./config";
import { isOperationCode } from "./contract";

/**
 * Strict request-body readers for the bootstrap routes.
 *
 * Every read is bounded by an actual-byte cap AND a single whole-read deadline
 * (not reset per chunk). On overflow, timeout or any stream error the stream is
 * cancelled, the lock is released without extending the deadline, and the
 * caller receives `null`, so the route fails closed with zero Go calls.
 */
export const LOCAL_BOOTSTRAP_APPLY_BODY_MAX_BYTES = 1024;
export const LOCAL_BOOTSTRAP_STAGE_BODY_MAX_BYTES = 256;

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
  timeoutMs: number = LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS,
): Promise<string | null> {
  if (!isJsonContentType(request.headers.get("content-type"))) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("body deadline exceeded")), timeoutMs);
  });

  try {
    let bytes = 0;
    let text = "";
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("body too large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    // Never await a potentially unbounded cancellation: cleanup must not extend
    // the deadline, and the caller already fails closed.
    void reader.cancel().catch(() => {});
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      reader.releaseLock();
    } catch {
      /* The stream is already cancelled with a read still settling. */
    }
  }
}

/** The stage contract accepts only the exact empty JSON object `{}`. */
export function parseStageRequest(raw: string): true | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return Object.keys(value as Record<string, unknown>).length === 0 ? true : null;
}

/**
 * The apply contract accepts only `{"operation_code":"..."}`. Any unknown or
 * extra field (for example browser-supplied PII) invalidates the whole body.
 */
export function parseApplyRequest(raw: string): { operation_code: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || keys[0] !== "operation_code") return null;
  const code = record.operation_code;
  return isOperationCode(code) ? { operation_code: code } : null;
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  return value.split(";", 1)[0].trim().toLowerCase() === "application/json";
}
