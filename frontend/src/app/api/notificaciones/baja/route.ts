import { BodyTooLarge, readBoundedBody } from "@/features/candidate-cvs/bounded-body";
import { postUnsubscribe, UNSUBSCRIBE_MAX_BODY_BYTES } from "@/features/notifications/client";
import { toNotificationFailure } from "@/features/notifications/failure";
import { logUnsubscribeFailure } from "@/features/notifications/unsubscribe-log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Minimal JSON answer: a code at most, never the token or anything the backend said. */
function answer(status: number, body: object, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...extra } });
}

/**
 * One-click unsubscribe target (RFC 8058; contract v2 E7, Q4, L23). Mail providers POST here cross-site, so there is
 * no session, cookie or same-origin check: the signed `token` in the query is the only credential. The raw body
 * (≤ 1 KiB) goes to `POST /v2/notifications/unsubscribe` with the proxy headers built by the notifications client.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > UNSUBSCRIBE_MAX_BODY_BYTES) return answer(413, { code: "payload_too_large" });
  let body: Uint8Array;
  try {
    body = request.body ? await readBoundedBody(request.body, UNSUBSCRIBE_MAX_BODY_BYTES) : new Uint8Array();
  } catch (error) {
    if (error instanceof BodyTooLarge) return answer(413, { code: "payload_too_large" });
    return answer(400, { code: "invalid_request" });
  }
  const result = await postUnsubscribe({ token, incoming: request.headers, body, contentType: request.headers.get("content-type") });
  // Any backend 200 is committed, even when its body does not parse (R4).
  if (result.ok) return answer(200, { ok: true });
  const failure = toNotificationFailure(result);
  if (failure.reason === "unsubscribe_link_invalid") return answer(422, { code: "unsubscribe_link_invalid" });
  if (failure.reason === "rate_limited") return answer(429, { code: "rate_limited" }, failure.retryAfter ? { "Retry-After": failure.retryAfter } : {});
  if (failure.reference.status === 413) return answer(413, { code: "payload_too_large" });
  logUnsubscribeFailure("one_click", failure);
  return answer(502, { code: "unavailable" });
}

const notAllowed = () => answer(405, { code: "method_not_allowed" }, { Allow: "POST" });
export const GET = notAllowed;
export const HEAD = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = notAllowed;
