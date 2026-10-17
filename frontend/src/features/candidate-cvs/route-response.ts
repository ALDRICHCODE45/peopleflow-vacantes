import "server-only";
import type { CvFailure, CvCode } from "./model";
export function routeError(status: number, code: CvCode): Response {
  return Response.json({ error: code, code }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export function routeFailure(failure: CvFailure): Response {
  const status = failure.reference.status;
  return routeError(status && status >= 400 && status < 600 ? status : failure.reason === "no_response" ? 503 : 502, failure.reason === "storage_unavailable" ? "cv_storage_unavailable" : failure.reason);
}
