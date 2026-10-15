import "server-only";

/**
 * Server-only configuration for the temporary local identity bootstrap
 * (TMP-IDENTITY-001). Everything fails closed: a disabled flag or any invalid
 * value yields a state that makes the bridge emit no request at all. No raw
 * value is ever included in a failure result.
 */
export const LOCAL_BOOTSTRAP_ENV_KEYS = {
  enabled: "PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED",
  baseUrl: "PEOPLEFLOW_LOCAL_BOOTSTRAP_BASE_URL",
  key: "PEOPLEFLOW_LOCAL_BOOTSTRAP_KEY",
  siteUrl: "NEXTAUTH_URL",
  secret: "NEXTAUTH_SECRET",
} as const;

export const LOCAL_BOOTSTRAP_STAGE_PATH = "/stage";
export const LOCAL_BOOTSTRAP_APPLY_PATH = "/apply";

/** Bounded deadline for every loopback Go request. */
export const LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS = 8000;

export type LocalBootstrapConfig = {
  /** Bare `http://127.0.0.1:<port>` origin, no path/query/credentials. */
  baseUrl: string;
  /** Operator-managed server-only key forwarded only to the loopback Go tool. */
  key: string;
  /** Exact trusted frontend origin derived from NEXTAUTH_URL; never Host. */
  trustedOrigin: string;
  stageUrl: string;
  applyUrl: string;
  timeoutMs: number;
  /** Server-only HMAC secret for the session-bound CSRF token. */
  csrfSecret: string;
};

export type LocalBootstrapConfigState =
  | { status: "disabled" }
  | { status: "invalid" }
  | { status: "enabled"; config: LocalBootstrapConfig };

export type LocalBootstrapEnvSource = Record<string, unknown>;

const BASE_URL_HOST = "127.0.0.1";
const TRUSTED_FRONTEND_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MIN_KEY_BYTES = 32;
const MAX_KEY_LENGTH = 512;
const CONTROL_OR_WHITESPACE = /[\s\u0000-\u001f\u007f]/;

function invalid(): LocalBootstrapConfigState {
  return { status: "invalid" };
}

function readValue(env: LocalBootstrapEnvSource, key: string): string | null {
  const raw = env[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function isProduction(env: LocalBootstrapEnvSource): boolean {
  const nodeEnv = env.NODE_ENV;
  return typeof nodeEnv === "string" && nodeEnv.trim() === "production";
}

/** Literal loopback IPv4 origin with an explicit, valid port only. No DNS names. */
function parseBootstrapBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (url.hostname !== BASE_URL_HOST) return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  if (!/^\d+$/.test(url.port)) return null;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `http://${BASE_URL_HOST}:${port}`;
}

/** Approved local frontend origin; https, remote hosts, paths and queries are rejected. */
function parseTrustedOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:") return null;
  if (!TRUSTED_FRONTEND_HOSTS.has(url.hostname)) return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  return url.origin;
}

function isValidKey(value: string): boolean {
  if (value.length > MAX_KEY_LENGTH) return false;
  if (new TextEncoder().encode(value).length < MIN_KEY_BYTES) return false;
  return !CONTROL_OR_WHITESPACE.test(value);
}

export function validateLocalBootstrapEnv(env: LocalBootstrapEnvSource): LocalBootstrapConfigState {
  const enabledFlag = env[LOCAL_BOOTSTRAP_ENV_KEYS.enabled];
  if (enabledFlag === undefined || enabledFlag === "false") return { status: "disabled" };
  if (enabledFlag !== "true") return invalid();
  if (isProduction(env)) return invalid();

  const baseUrlRaw = readValue(env, LOCAL_BOOTSTRAP_ENV_KEYS.baseUrl);
  const key = readValue(env, LOCAL_BOOTSTRAP_ENV_KEYS.key);
  const siteUrlRaw = readValue(env, LOCAL_BOOTSTRAP_ENV_KEYS.siteUrl);
  const csrfSecret = readValue(env, LOCAL_BOOTSTRAP_ENV_KEYS.secret);
  if (baseUrlRaw === null || key === null || siteUrlRaw === null || csrfSecret === null)
    return invalid();

  const baseUrl = parseBootstrapBaseUrl(baseUrlRaw);
  const trustedOrigin = parseTrustedOrigin(siteUrlRaw);
  if (baseUrl === null || trustedOrigin === null || !isValidKey(key)) return invalid();

  return {
    status: "enabled",
    config: {
      baseUrl,
      key,
      trustedOrigin,
      stageUrl: `${baseUrl}${LOCAL_BOOTSTRAP_STAGE_PATH}`,
      applyUrl: `${baseUrl}${LOCAL_BOOTSTRAP_APPLY_PATH}`,
      timeoutMs: LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS,
      csrfSecret,
    },
  };
}

/**
 * Exact-origin comparison against the trusted NEXTAUTH_URL origin. The header is
 * compared literally to the trusted serialization: a path, userinfo, query,
 * fragment, different case or non-canonical port is rejected instead of being
 * quietly normalized. Host and X-Forwarded-Host are never consulted; a missing,
 * `null` or malformed Origin fails closed.
 */
export function isTrustedOrigin(originHeader: string | null, trustedOrigin: string): boolean {
  return (
    typeof originHeader === "string" &&
    originHeader.length > 0 &&
    originHeader === trustedOrigin
  );
}
