import NextAuth from "next-auth";
import { authEnv, authOptions } from "@/lib/auth/options";
import { createAuthAttemptLimiter } from "@/lib/auth/rate-limit";
import { guardAuthRoute } from "@/lib/auth/route-guard";
import { resolveSocialProviders } from "@/lib/auth/social";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Social flags are read per social sign-in, never at module load: an invalid
// AUTH_SOCIAL_* value disables only identity_provider sign-ins (L16 R3/R4).
// The password-callback limiter is in-memory per instance (rate-limit.ts).
const handler = guardAuthRoute(NextAuth(authOptions), {
  secret: authEnv.secret,
  siteUrl: authEnv.siteUrl,
  socialProviders: () => resolveSocialProviders(),
  rateLimiter: createAuthAttemptLimiter(),
});

export { handler as GET, handler as POST };
