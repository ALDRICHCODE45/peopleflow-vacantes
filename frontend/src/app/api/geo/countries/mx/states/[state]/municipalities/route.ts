import { getMunicipalities } from "@/features/geo/client";
import { stateCodeSchema } from "@/features/geo/model";
import { geoResponse, routeError } from "@/features/geo/route-response";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ state: string }> }): Promise<Response> {
  const { state } = await context.params;
  if (!stateCodeSchema.safeParse(state).success) return routeError("invalid_request");
  return geoResponse(request, () => getMunicipalities(state));
}
