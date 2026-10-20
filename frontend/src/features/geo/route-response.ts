import { failureStatus, type GeoFailure, type GeoResult } from "./model";
export function routeError(code: GeoFailure): Response {
  return Response.json({ code }, { status: failureStatus[code], headers: { "cache-control": "no-store" } });
}
export async function geoResponse<T>(request: Request, load: () => Promise<GeoResult<T>>): Promise<Response> {
  try {
    if (new URL(request.url).search) return routeError("invalid_request");
    const result = await load();
    if (!result.ok) return routeError(result.error);
    // An empty catalog list only exists before `make geo-import`; caching it for a day hid the
    // imported data until a hard reload. Real catalogs are never empty, so only they are cached.
    const empty = typeof result.data === "object" && result.data !== null && "items" in result.data && Array.isArray(result.data.items) && result.data.items.length === 0;
    return Response.json(result.data, { headers: { "cache-control": empty ? "no-store" : "public, max-age=86400" } });
  } catch { return routeError("no_response"); }
}
