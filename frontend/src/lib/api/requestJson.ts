import { DEFAULT_API_TIMEOUT_MS } from "../env/validate";

export type RequestJsonError =
  | { kind: "timeout"; retryable: true }
  | { kind: "network"; retryable: true }
  | { kind: "status"; retryable: boolean; status: number }
  | { kind: "not_found"; retryable: false; status: number }
  | { kind: "invalid_response"; retryable: false };

/**
 * Transport outcome. `envelope` is the decoded non-2xx body and exists only for
 * callers that supply `errorDecoder`; every other caller keeps the exact
 * pre-envelope result shape (`E` defaults to `never`).
 */
export type RequestJsonResult<T, E = never> =
  | { ok: true; data: T }
  | { ok: false; error: RequestJsonError; envelope?: E };

export type RequestJsonOptions<T, E = never> = {
  /** Feature-owned decoder; the shared transport never imports feature schemas. */
  decoder: (value: unknown) => T;
  timeoutMs?: number;
  /** Exact status that maps to a not-found result; every other status never does. */
  notFoundStatus?: number;
  /** HTTP method. Omitting it keeps the GET-only default every read caller relies on. */
  method?: string;
  /**
   * JSON-serializable request body. When present the transport serializes it
   * with `JSON.stringify` and applies a `content-type: application/json` header
   * unless the caller supplied its own.
   */
  body?: unknown;
  /**
   * Extra request headers, merged over the transport defaults so a JSON caller
   * owns its content type and any tracing header. The transport never injects
   * `authorization`: authentication is the caller's explicit decision.
   */
  headers?: HeadersInit;
  /**
   * Optional decoder for a non-2xx JSON body. When supplied, the decoded value
   * is attached to the failure result as `envelope`; an absent, unparsable, or
   * rejected body leaves it undefined without changing the classification.
   */
  errorDecoder?: (value: unknown) => E;
};

export async function requestJson<T, E = never>(
  url: string,
  options: RequestJsonOptions<T, E>,
): Promise<RequestJsonResult<T, E>> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, buildRequestInit(options, controller.signal));

    if (!response.ok) {
      const status = response.status;
      const envelope = await decodeErrorEnvelope(response, options.errorDecoder);
      if (
        options.notFoundStatus !== undefined &&
        status === options.notFoundStatus
      ) {
        return failureResult(
          { kind: "not_found", retryable: false, status },
          envelope,
        );
      }
      return failureResult(
        {
          kind: "status",
          retryable: status === 429 || status >= 500,
          status,
        },
        envelope,
      );
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

/**
 * Builds a failure result. The `envelope` key is attached only when a decoder
 * actually produced a value, so a caller without `errorDecoder` (or whose body
 * could not be decoded) keeps the strict legacy runtime shape: no own
 * `envelope` property at all.
 */
function failureResult<T, E>(
  error: RequestJsonError,
  envelope: E | undefined,
): RequestJsonResult<T, E> {
  return envelope === undefined
    ? { ok: false, error }
    : { ok: false, error, envelope };
}

/**
 * Builds the fetch init from the transport defaults plus the caller's optional
 * method, JSON body, and header overrides. A read caller that passes none of
 * them keeps the previous request byte-for-byte: no `method`, no `body`, and
 * the single `accept` header.
 */
function buildRequestInit<T, E>(
  options: RequestJsonOptions<T, E>,
  signal: AbortSignal,
): RequestInit {
  const headers = new Headers({ accept: "application/json" });
  if (options.headers !== undefined) {
    new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  }

  const init: RequestInit = { cache: "no-store", headers, signal };
  if (options.method !== undefined) init.method = options.method;
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    // A JSON caller may set its own content type; the default only fills the gap.
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  return init;
}

/**
 * Decodes a non-2xx JSON body into the caller's envelope type. A missing
 * decoder, an unparsable body, or a rejecting decoder all collapse to
 * `undefined`: the failure classification never depends on the error body, and
 * no error-body detail can leak through the result.
 */
async function decodeErrorEnvelope<E>(
  response: Response,
  decoder?: (value: unknown) => E,
): Promise<E | undefined> {
  if (decoder === undefined) return undefined;
  try {
    return decoder(await response.json());
  } catch {
    return undefined;
  }
}
