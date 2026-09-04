import { DEFAULT_API_TIMEOUT_MS } from "../env/validate";

export type RequestJsonError =
  | { kind: "timeout"; retryable: true }
  | { kind: "network"; retryable: true }
  | { kind: "status"; retryable: boolean; status: number }
  | { kind: "not_found"; retryable: false; status: number }
  | { kind: "invalid_response"; retryable: false };

export type RequestJsonResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: RequestJsonError };

export type RequestJsonOptions<T> = {
  /** Feature-owned decoder; the shared transport never imports feature schemas. */
  decoder: (value: unknown) => T;
  timeoutMs?: number;
  /** Exact status that maps to a not-found result; every other status never does. */
  notFoundStatus?: number;
};

export async function requestJson<T>(
  url: string,
  options: RequestJsonOptions<T>,
): Promise<RequestJsonResult<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      if (
        options.notFoundStatus !== undefined &&
        status === options.notFoundStatus
      ) {
        return {
          ok: false,
          error: { kind: "not_found", retryable: false, status },
        };
      }
      return {
        ok: false,
        error: {
          kind: "status",
          retryable: status === 429 || status >= 500,
          status,
        },
      };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // A transport-owned timeout that fires while the body is still being
      // consumed must stay classified as a retryable timeout, not a content defect.
      if (timedOut) {
        return { ok: false, error: { kind: "timeout", retryable: true } };
      }
      return {
        ok: false,
        error: { kind: "invalid_response", retryable: false },
      };
    }
    try {
      return { ok: true, data: options.decoder(payload) };
    } catch {
      return {
        ok: false,
        error: { kind: "invalid_response", retryable: false },
      };
    }
  } catch {
    return {
      ok: false,
      error: timedOut
        ? { kind: "timeout", retryable: true }
        : { kind: "network", retryable: true },
    };
  } finally {
    clearTimeout(timer);
  }
}
