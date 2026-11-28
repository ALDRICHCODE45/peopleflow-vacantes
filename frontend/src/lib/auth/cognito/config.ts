import "server-only";
import { AUTH_ENV_KEYS, validateAuthEnv, type AuthEnvSource } from "../env";

/**
 * Loopback-only override of the Cognito IdP endpoint for the local preview and
 * tests (mock Cognito). Mirrors the backend's IDENTITY_COGNITO_ENDPOINT rule
 * (docs/contracts/embedded-auth-v1.md D8, §Configuration): refused outside
 * test mode / PEOPLEFLOW_LOCAL_PREVIEW=true, loopback host only, bare origin.
 */
export const COGNITO_IDP_ENDPOINT_KEY = "COGNITO_IDP_ENDPOINT";

export type CognitoClientConfig = {
  endpoint: string;
  clientId: string;
  clientSecret: string;
};

const REGION = "[a-z]{2}(?:-[a-z]+)+-[0-9]+";
const COGNITO_HOST = new RegExp(`^cognito-idp\\.(${REGION})\\.amazonaws\\.com$`);

function fail(key: string, reason: string): never {
  throw new Error(`${key}: ${reason}`);
}

function isLoopback(hostname: string): boolean {
  const host = hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host === "::1") return true;
  const octets = host.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  );
}

function overrideAllowed(env: AuthEnvSource): boolean {
  const preview = env.PEOPLEFLOW_LOCAL_PREVIEW;
  if (preview !== undefined && preview !== "true" && preview !== "false")
    fail("PEOPLEFLOW_LOCAL_PREVIEW", "must be true or false when provided");
  const nodeEnv = typeof env.NODE_ENV === "string" ? env.NODE_ENV.trim() : "";
  return nodeEnv === "test" || preview === "true";
}

function parseOverride(raw: string, env: AuthEnvSource): string {
  const key = COGNITO_IDP_ENDPOINT_KEY;
  if (!overrideAllowed(env))
    fail(key, "is only allowed in test mode or with PEOPLEFLOW_LOCAL_PREVIEW=true");
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(key, "must be an absolute http(s) loopback origin");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") fail(key, "must use the http or https scheme");
  if (url.username !== "" || url.password !== "") fail(key, "must not embed credentials");
  if (url.pathname !== "/" || value.includes("?") || value.includes("#"))
    fail(key, "must be a bare origin without path, query, or fragment");
  if (!isLoopback(url.hostname)) fail(key, "must be a loopback origin");
  return `${url.origin}/`;
}

/**
 * The Cognito IdP endpoint: the override when set and allowed, otherwise
 * `https://cognito-idp.<region>.amazonaws.com/` with the region read from the
 * (already validated) user pool issuer. The pool id must belong to the same
 * region. Errors name the key, never the value.
 */
export function resolveCognitoEndpoint(issuer: string, env: AuthEnvSource): string {
  const override = env[COGNITO_IDP_ENDPOINT_KEY];
  if (override !== undefined && (typeof override !== "string" || override.trim() !== ""))
    return parseOverride(typeof override === "string" ? override : "", env);

  const key = AUTH_ENV_KEYS.issuer;
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    fail(key, "must be a Cognito user pool issuer URL");
  }
  const match = COGNITO_HOST.exec(url.hostname);
  if (url.protocol !== "https:" || url.port !== "" || match === null)
    fail(key, "must be a Cognito user pool issuer on cognito-idp.<region>.amazonaws.com");
  const region = match[1];
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1 || !segments[0].startsWith(`${region}_`))
    fail(key, "user pool id must belong to the issuer's region");
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

/** Server configuration for the Cognito client, from the validated auth env. */
export function cognitoConfigFromEnv(env: AuthEnvSource): CognitoClientConfig {
  const auth = validateAuthEnv(env);
  return {
    endpoint: resolveCognitoEndpoint(auth.issuer, env),
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
  };
}
