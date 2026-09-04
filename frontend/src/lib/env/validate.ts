export const DEFAULT_API_TIMEOUT_MS = 8000;

const MIN_API_TIMEOUT_MS = 1000;
const MAX_API_TIMEOUT_MS = 30000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export type ServerEnv = {
  apiBaseUrl: string;
  siteUrl: string;
  apiTimeoutMs: number;
};

export type ServerEnvSource = Record<string, unknown>;

function fail(key: string, reason: string): never {
  throw new Error(`${key}: ${reason}`);
}

function parseOrigin(env: ServerEnvSource, key: string): string {
  const raw = env[key];
  if (typeof raw !== "string" || raw.trim().length === 0)
    fail(key, "must be an absolute http(s) origin");
  const value = raw.trim();

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
  if (
    url.protocol === "http:" &&
    !(LOOPBACK_HOSTS.has(hostname) && !isProduction(env))
  )
    fail(
      key,
      "http is allowed only for loopback hosts outside production; use https in production",
    );

  return url.origin;
}

function isProduction(env: ServerEnvSource): boolean {
  const nodeEnv = env.NODE_ENV;
  return typeof nodeEnv === "string" && nodeEnv.trim() === "production";
}

function parseTimeout(env: ServerEnvSource): number {
  const raw = env.PEOPLEFLOW_API_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_API_TIMEOUT_MS;

  let value: number;
  if (typeof raw === "number" && Number.isInteger(raw)) value = raw;
  else if (typeof raw === "string" && /^\d+$/.test(raw)) value = Number(raw);
  else
    fail(
      "PEOPLEFLOW_API_TIMEOUT_MS",
      "must be an integer number of milliseconds",
    );
  if (value < MIN_API_TIMEOUT_MS || value > MAX_API_TIMEOUT_MS)
    fail(
      "PEOPLEFLOW_API_TIMEOUT_MS",
      `must be between ${MIN_API_TIMEOUT_MS} and ${MAX_API_TIMEOUT_MS} ms`,
    );

  return value;
}

export function validateServerEnv(env: ServerEnvSource): ServerEnv {
  return {
    apiBaseUrl: parseOrigin(env, "PEOPLEFLOW_API_BASE_URL"),
    siteUrl: parseOrigin(env, "PEOPLEFLOW_SITE_URL"),
    apiTimeoutMs: parseTimeout(env),
  };
}
