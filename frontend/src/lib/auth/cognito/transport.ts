import "server-only";
import { DEFAULT_API_TIMEOUT_MS } from "../../env/validate";

/** Same cap the backend applies to Cognito answers (contract D11). */
export const COGNITO_MAX_RESPONSE_BYTES = 16 * 1024;

export type CognitoOperation =
  | "InitiateAuth"
  | "SignUp"
  | "ConfirmSignUp"
  | "ResendConfirmationCode"
  | "ForgotPassword"
  | "ConfirmForgotPassword";

/**
 * Transport outcome. A `service_error` carries only the sanitized error name
 * (e.g. `NotAuthorizedException`); Cognito's message never leaves this module.
 */
export type CognitoTransportResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; kind: "service_error"; errorName: string }
  | { ok: false; kind: "unavailable"; errorName?: string };

const UNAVAILABLE = { ok: false, kind: "unavailable" } as const;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,99}$/;

/**
 * awsJson1_1 error names may carry a `namespace#` prefix or a `:uri` suffix
 * (https://smithy.io/2.0/aws/protocols/aws-json-1_1-protocol.html).
 */
function sanitizeErrorName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.split(":")[0].split("#").at(-1)?.trim() ?? "";
  return ERROR_NAME.test(name) ? name : undefined;
}

/** Counts real bytes (not Content-Length) and stops a stalled body at the deadline. */
async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("empty body");
  const reader = response.body.getReader();
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error("deadline"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > COGNITO_MAX_RESPONSE_BYTES) throw new Error("too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    // Do not await cancellation: an uncooperative stream must not hold the call open.
    void reader.cancel().catch(() => {});
    throw new Error("unreadable body");
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One unsigned awsJson1_1 call to the Cognito IdP endpoint: POST `/`, no AWS
 * credentials, no redirects, no caching, bounded time and size. Never throws,
 * never logs: the payload holds passwords, codes and tokens.
 */
export async function callCognito(
  endpoint: string,
  operation: CognitoOperation,
  payload: Record<string, unknown>,
  { timeoutMs = DEFAULT_API_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<CognitoTransportResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-amz-json-1.1",
        "x-amz-target": `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify(payload),
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status === 200) {
      const body = await readBoundedJson(response, controller.signal);
      return isObject(body) ? { ok: true, body } : UNAVAILABLE;
    }
    if (response.status < 400 || response.status >= 500) {
      void response.body?.cancel().catch(() => {});
      // A 5xx may name itself in the header; kept only for the operator signal (never the body).
      const name = response.status >= 500 ? sanitizeErrorName(response.headers.get("x-amzn-errortype")) : undefined;
      return name === undefined ? UNAVAILABLE : { ok: false, kind: "unavailable", errorName: name };
    }

    let errorName = sanitizeErrorName(response.headers.get("x-amzn-errortype"));
    if (errorName === undefined) {
      const body = await readBoundedJson(response, controller.signal).catch(() => undefined);
      errorName = isObject(body) ? sanitizeErrorName(body.__type) : undefined;
    } else {
      void response.body?.cancel().catch(() => {});
    }
    return errorName === undefined ? UNAVAILABLE : { ok: false, kind: "service_error", errorName };
  } catch {
    return UNAVAILABLE;
  } finally {
    clearTimeout(timer);
  }
}
