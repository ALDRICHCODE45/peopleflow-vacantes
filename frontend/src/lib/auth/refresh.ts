import {
  classifyRefreshCategory,
  createRefreshSignalId,
  reportRefreshSignal,
  type RefreshObserver,
} from "./refresh-observer";

export type { RefreshObserver } from "./refresh-observer";

export const REFRESH_ERROR = "RefreshAccessTokenError" as const;

export const DEFAULT_REFRESH_TIMEOUT_MS = 8000;
export const DEFAULT_EXPIRY_SKEW_MS = 30_000;

export type RefreshError = typeof REFRESH_ERROR;

export type TokenLike = {
  sub?: string;
  name?: string | null;
  email?: string | null;
  picture?: string | null;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  idToken?: string;
  error?: RefreshError;
  [key: string]: unknown;
};

export type RefreshedTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  idToken?: string;
};

export type RefreshAccessTokenOptions = {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

export function isTokenExpired(
  expiresAt: unknown,
  now: number,
  skewMs: number = DEFAULT_EXPIRY_SKEW_MS,
): boolean {
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return true;
  return expiresAt - skewMs <= now;
}

/**
 * Exchanges a Cognito refresh token for a new access token. The token endpoint
 * is derived from validated server configuration and never from request input.
 * Failures are collapsed into a single generic error so that token material can
 * never reach logs, error strings, or browser responses.
 */
export async function refreshAccessToken(
  options: RefreshAccessTokenOptions,
): Promise<RefreshedTokens> {
  const {
    tokenEndpoint,
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_REFRESH_TIMEOUT_MS,
    now = Date.now,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }).toString(),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error("token endpoint rejected the refresh");

    const payload = (await response.json()) as Record<string, unknown>;
    const accessToken = payload.access_token;
    const expiresIn = payload.expires_in;
    const currentTime = now();
    const expiresAt = typeof expiresIn === "number" ? currentTime + expiresIn * 1000 : NaN;
    if (
      !hasAccessToken(accessToken) ||
      typeof expiresIn !== "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0 ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= currentTime
    ) {
      throw new Error("token endpoint returned an unusable payload");
    }

    return {
      accessToken,
      refreshToken:
        typeof payload.refresh_token === "string" && payload.refresh_token.length > 0
          ? payload.refresh_token
          : refreshToken,
      expiresAt,
      idToken: typeof payload.id_token === "string" ? payload.id_token : undefined,
    };
  } catch {
    throw new Error("Cognito token refresh failed");
  } finally {
    clearTimeout(timer);
  }
}

export type RefreshSessionOptions = {
  token: TokenLike;
  now: number;
  refresh: (refreshToken: string) => Promise<RefreshedTokens>;
  observer?: RefreshObserver;
};

export function hasAccessToken(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasUsableCredentials(token: TokenLike, now: number): boolean {
  return token.error !== REFRESH_ERROR && hasAccessToken(token.accessToken) &&
    typeof token.expiresAt === "number" && Number.isSafeInteger(token.expiresAt) && token.expiresAt > now;
}

export function expireSession(token: TokenLike): TokenLike {
  return {
    sub: token.sub,
    name: token.name,
    email: token.email,
    picture: token.picture,
    error: REFRESH_ERROR,
  };
}

/**
 * Decides, on the server, whether the stored token needs a refresh. When the
 * refresh token is missing or the refresh fails the session is expired and no
 * unusable credentials are retained.
 *
 * An optional `observer` receives a development-only correlation signal for the
 * attempt and its outcome. Signal emission never changes the authentication
 * result: a throwing observer is swallowed, and no signal is produced on the
 * fast paths where a refresh is not actually attempted.
 */
export async function refreshSessionToken({
  token,
  now,
  refresh,
  observer,
}: RefreshSessionOptions): Promise<TokenLike> {
  if (token.error === REFRESH_ERROR) return expireSession(token);
  if (hasUsableCredentials(token, now) && !isTokenExpired(token.expiresAt, now)) return token;

  if (typeof token.refreshToken !== "string" || token.refreshToken.length === 0)
    return expireSession(token);

  const signal = observer
    ? {
        id: createRefreshSignalId(),
        category: classifyRefreshCategory(token.expiresAt, now, DEFAULT_EXPIRY_SKEW_MS),
      }
    : undefined;
  if (signal) {
    reportRefreshSignal(observer, "onAttempt", { label: "START", ...signal });
  }

  try {
    const refreshed = await refresh(token.refreshToken);
    if (!hasUsableCredentials(refreshed, now)) {
      if (signal) reportRefreshSignal(observer, "onOutcome", { label: "FAILURE", ...signal });
      return expireSession(token);
    }
    if (signal) reportRefreshSignal(observer, "onOutcome", { label: "SUCCESS", ...signal });
    return {
      sub: token.sub,
      name: token.name,
      email: token.email,
      picture: token.picture,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? token.refreshToken,
      expiresAt: refreshed.expiresAt,
    };
  } catch {
    if (signal) reportRefreshSignal(observer, "onOutcome", { label: "FAILURE", ...signal });
    return expireSession(token);
  }
}
