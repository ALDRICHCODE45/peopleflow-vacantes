import "server-only";
import {
  decodeApplySuccess,
  decodeErrorEnvelope,
  decodeStageSuccess,
  type LocalBootstrapApplySuccess,
  type LocalBootstrapErrorCode,
  type LocalBootstrapStageSuccess,
} from "./contract";
import { LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS, type LocalBootstrapConfig } from "./config";

/**
 * Server-to-server bridge to the fixed loopback Go tool. It owns its bound:
 * a fixed deadline, a response cap, `redirect: "error"`, `cache: "no-store"`,
 * and no retries. Every non-whitelisted shape collapses to `failure`.
 */
export type LocalBootstrapFetch = (url: string, init: RequestInit) => Promise<Response>;

export type LocalBootstrapBridgeOutcome<T> =
  | { kind: "success"; status: number; data: T }
  | { kind: "error"; status: number; code: LocalBootstrapErrorCode }
  | { kind: "failure" };

/** 16 KiB is enough for the closed envelopes and blocks a hostile large body. */
const MAX_RESPONSE_BYTES = 16 * 1024;

export async function stageLocalIdentity(
  config: LocalBootstrapConfig,
  accessToken: string,
  fetchImpl: LocalBootstrapFetch = fetch,
): Promise<LocalBootstrapBridgeOutcome<LocalBootstrapStageSuccess>> {
  const result = await postFixedJson(config.stageUrl, {}, config, accessToken, fetchImpl);
  if (result === null) return { kind: "failure" };
  if (result.status === 202) {
    try {
      return { kind: "success", status: 202, data: decodeStageSuccess(result.value) };
    } catch {
      return { kind: "failure" };
    }
  }
  return decodeError(result.status, result.value);
}

export async function applyLocalIdentity(
  config: LocalBootstrapConfig,
  accessToken: string,
  operationCode: string,
  fetchImpl: LocalBootstrapFetch = fetch,
): Promise<LocalBootstrapBridgeOutcome<LocalBootstrapApplySuccess>> {
  const result = await postFixedJson(
    config.applyUrl,
    { operation_code: operationCode },
    config,
    accessToken,
    fetchImpl,
  );
  if (result === null) return { kind: "failure" };
  if (result.status === 200) {
    try {
      return { kind: "success", status: 200, data: decodeApplySuccess(result.value) };
    } catch {
      return { kind: "failure" };
    }
  }
  return decodeError(result.status, result.value);
}

function decodeError<T>(
  status: number,
  value: unknown,
): LocalBootstrapBridgeOutcome<T> {
  try {
    return { kind: "error", status, code: decodeErrorEnvelope(value, status) };
  } catch {
    return { kind: "failure" };
  }
}

async function postFixedJson(
  url: string,
  payload: unknown,
  config: LocalBootstrapConfig,
  accessToken: string,
  fetchImpl: LocalBootstrapFetch,
): Promise<{ status: number; value: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-local-bootstrap-key": config.key,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    return { status: response.status, value: await readBoundedJson(response, controller.signal) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Limits actual bytes and stops a stalled body at the shared deadline. */
async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("missing response body");
  const reader = response.body.getReader();
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new Error("deadline exceeded"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } catch {
    // Do not await cancellation: an uncooperative stream must not hold the request open.
    void reader.cancel().catch(() => {});
    throw new Error("unreadable response");
  } finally {
    reader.releaseLock();
  }
}
