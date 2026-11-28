import "server-only";
import type { AuthEnvSource } from "./env";

/**
 * Social sign-in through the Cognito OAuth provider (S3): the button calls
 * `signIn("cognito", { callbackUrl }, { identity_provider: <identityProvider> })`
 * and Cognito sends the browser straight to that provider. Each provider is
 * hidden until its flag is `on` (L5: the IdPs are created in the AWS phase).
 * Only names reach the UI; there are no secrets here.
 */
export const IDENTITY_PROVIDER_PARAM = "identity_provider";

export const SOCIAL_PROVIDER_IDS = ["google", "microsoft", "linkedin"] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];

export type SocialProvider = { id: SocialProviderId; identityProvider: string };

export const SOCIAL_ENV_KEYS: Record<SocialProviderId, { flag: string; identityProvider: string }> = {
  google: { flag: "AUTH_SOCIAL_GOOGLE", identityProvider: "AUTH_SOCIAL_GOOGLE_IDP" },
  microsoft: { flag: "AUTH_SOCIAL_MICROSOFT", identityProvider: "AUTH_SOCIAL_MICROSOFT_IDP" },
  linkedin: { flag: "AUTH_SOCIAL_LINKEDIN", identityProvider: "AUTH_SOCIAL_LINKEDIN_IDP" },
};

/** Cognito's default names when the IdP is created with the provider's own name. */
const DEFAULT_IDENTITY_PROVIDER: Record<SocialProviderId, string> = {
  google: "Google",
  microsoft: "Microsoft",
  linkedin: "LinkedIn",
};

/** Conservative subset of Cognito's IdP-name alphabet: safe in a query string as is. */
const IDENTITY_PROVIDER_NAME = /^[A-Za-z0-9._-]{1,32}$/;

function fail(key: string, reason: string): never {
  throw new Error(`${key}: ${reason}`);
}

function readFlag(env: AuthEnvSource, key: string): boolean {
  const raw = env[key];
  if (raw === undefined) return false;
  const value = typeof raw === "string" ? raw.trim() : undefined;
  if (value === "" || value === "off") return false;
  if (value === "on") return true;
  return fail(key, "must be on or off");
}

function readIdentityProvider(env: AuthEnvSource, id: SocialProviderId): string {
  const key = SOCIAL_ENV_KEYS[id].identityProvider;
  const raw = env[key];
  if (raw === undefined || (typeof raw === "string" && raw.trim() === "")) return DEFAULT_IDENTITY_PROVIDER[id];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!IDENTITY_PROVIDER_NAME.test(value)) fail(key, "must be a Cognito identity provider name (letters, digits, . _ -; up to 32)");
  return value;
}

/** Enabled social providers in a fixed order. Errors name the key, never the value. */
export function socialProvidersFromEnv(env: AuthEnvSource): SocialProvider[] {
  const providers: SocialProvider[] = [];
  for (const id of SOCIAL_PROVIDER_IDS) {
    if (!readFlag(env, SOCIAL_ENV_KEYS[id].flag)) continue;
    const identityProvider = readIdentityProvider(env, id);
    if (providers.some((provider) => provider.identityProvider === identityProvider))
      fail(SOCIAL_ENV_KEYS[id].identityProvider, "duplicates another provider");
    providers.push({ id, identityProvider });
  }
  return providers;
}

/**
 * Server helper for the sign-in screens: the enabled providers (id + Cognito
 * IdP name), read from the server environment on each call.
 */
export function getSocialProviders(): SocialProvider[] {
  return socialProvidersFromEnv(process.env);
}
