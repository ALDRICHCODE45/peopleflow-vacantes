import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { backendCheck, checkResponse } from "@/lib/auth/backend-check";
import { resolveBackendSession } from "@/lib/auth/backend-session";
import { validateServerEnv } from "@/lib/env/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const env = validateServerEnv(process.env);
    // Resolve configuration within this catch: a missing configuration must
    // produce a generic no-store response, never an import-time error page.
    const { authOptions } = await import("@/lib/auth/options");
    const url = request.nextUrl.clone();
    url.pathname = "/api/auth/session";
    url.search = "";
    const sessionRequest = new NextRequest(url, { headers: request.headers });
    return await backendCheck(env, () => resolveBackendSession(authOptions, (options) =>
      NextAuth(options)(sessionRequest, { params: Promise.resolve({ nextauth: ["session"] }) }),
    ));
  } catch {
    return checkResponse(503, "authentication_unavailable");
  }
}
