export const AUTH_ENV_KEYS = {
  url: "NEXTAUTH_URL",
  secret: "NEXTAUTH_SECRET",
  clientId: "COGNITO_CLIENT_ID",
  clientSecret: "COGNITO_CLIENT_SECRET",
  issuer: "COGNITO_ISSUER",
  domain: "COGNITO_DOMAIN",
} as const;

export const EMPLOYER_LOGIN_PATH = "/empresa/login";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export type AuthEnvSource = Record<string, unknown>;

export type AuthEnv = {
  siteUrl: string;
  secret: string;
  clientId: string;
  clientSecret: string;
  issuer: string;
  domain: string;
  tokenEndpoint: string;
  employerLoginUrl: string;
};

function fail(key: string, reason: string): never {
  throw new Error(`${key}: ${reason}`);
}

function isProduction(env: AuthEnvSource): boolean {
  const nodeEnv = env.NODE_ENV;
  return typeof nodeEnv === "string" && nodeEnv.trim() === "production";
}

function requireValue(env: AuthEnvSource, key: string): string {
  const raw = env[key];
  if (typeof raw !== "string" || raw.trim().length === 0)
    fail(key, "must be a non-empty string");
  return raw.trim();
}

function parseOrigin(
  env: AuthEnvSource,
  key: string,
  { allowLocalHttp }: { allowLocalHttp: boolean },
): string {
  const value = requireValue(env, key);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(key, "must be an absolute http(s) origin");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:")
    fail(key, "must use the http or https scheme");
  if (url.username !== "" || url.password !== "")
    fail(key, "must not embed credentials");
  if (url.pathname !== "/" || value.includes("?") || value.includes("#"))
    fail(key, "must be a bare origin without path, query, or fragment");

  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  const loopback = LOOPBACK_HOSTS.has(hostname);
  if (url.protocol === "http:" && !(allowLocalHttp && loopback))
    fail(
      key,
      "must use https; local http is only allowed for loopback origins outside production",
    );

  return url.origin;
}

function parseIssuer(env: AuthEnvSource): string {
  const value = requireValue(env, AUTH_ENV_KEYS.issuer);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(AUTH_ENV_KEYS.issuer, "must be an absolute https URL");
  }

  if (url.protocol !== "https:")
    fail(AUTH_ENV_KEYS.issuer, "must use https");
  if (url.username !== "" || url.password !== "")
    fail(AUTH_ENV_KEYS.issuer, "must not embed credentials");
  if (value.includes("?") || value.includes("#"))
    fail(AUTH_ENV_KEYS.issuer, "must not contain query or fragment");
  if (url.pathname === "/" || url.pathname.split("/").filter(Boolean).length !== 1)
    fail(AUTH_ENV_KEYS.issuer, "must be a Cognito user pool issuer URL");

  return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

export function validateAuthEnv(env: AuthEnvSource): AuthEnv {
  const siteUrl = parseOrigin(env, AUTH_ENV_KEYS.url, {
    allowLocalHttp: !isProduction(env),
  });
  const domain = parseOrigin(env, AUTH_ENV_KEYS.domain, {
    allowLocalHttp: false,
  });

  return {
    siteUrl,
    secret: requireValue(env, AUTH_ENV_KEYS.secret),
    clientId: requireValue(env, AUTH_ENV_KEYS.clientId),
    clientSecret: requireValue(env, AUTH_ENV_KEYS.clientSecret),
    issuer: parseIssuer(env),
    domain,
    tokenEndpoint: `${domain}/oauth2/token`,
    employerLoginUrl: new URL(EMPLOYER_LOGIN_PATH, siteUrl).toString(),
  };
}
