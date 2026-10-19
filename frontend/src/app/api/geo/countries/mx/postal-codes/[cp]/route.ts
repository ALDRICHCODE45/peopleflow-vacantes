import { getPostalCode } from "@/features/geo/client";
import { postalCodeSchema } from "@/features/geo/model";
import { geoResponse, routeError } from "@/features/geo/route-response";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ cp: string }> }): Promise<Response> {
  const { cp } = await context.params;
  if (!postalCodeSchema.safeParse(cp).success) return routeError("invalid_postal_code");
  return geoResponse(request, () => getPostalCode(cp));
}
