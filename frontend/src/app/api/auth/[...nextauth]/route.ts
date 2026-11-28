import NextAuth from "next-auth";
import { authEnv, authOptions } from "@/lib/auth/options";
import { guardAuthRoute } from "@/lib/auth/route-guard";
import { getSocialProviders } from "@/lib/auth/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = guardAuthRoute(NextAuth(authOptions), {
  secret: authEnv.secret,
  siteUrl: authEnv.siteUrl,
  socialProviders: getSocialProviders(),
});

export { handler as GET, handler as POST };
