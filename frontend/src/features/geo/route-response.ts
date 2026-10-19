import { failureStatus, type GeoFailure, type GeoResult } from "./model";
export function routeError(code: GeoFailure): Response {
  return Response.json({ code }, { status: failureStatus[code], headers: { "cache-control": "no-store" } });
}
export async function geoResponse<T>(request: Request, load: () => Promise<GeoResult<T>>): Promise<Response> {
  try {
    if (new URL(request.url).search) return routeError("invalid_request");
    const result = await load();
    return result.ok ? Response.json(result.data, { headers: { "cache-control": "public, max-age=86400" } }) : routeError(result.error);
  } catch { return routeError("no_response"); }
}
