import { getLanguages } from "@/features/languages/client";
import { geoResponse } from "@/features/geo/route-response";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> { return geoResponse(request, getLanguages); }
