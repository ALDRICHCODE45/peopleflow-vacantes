/**
 * Development-only server refresh signal (S7).
 *
 * When the server actually attempts a Cognito token refresh it can emit a
 * fixed, whitelisted marker line that correlates the attempt with its outcome.
 * The line is built from an explicit allow-list and never spreads runtime token
 * material, provider errors, session objects, or environment values.
 *
 * Marker format:
 *   AUTH_REFRESH START   id=<opaque> category=<expired|proactive|unusable>
 *   AUTH_REFRESH SUCCESS id=<opaque> category=<expired|proactive|unusable>
 *   AUTH_REFRESH FAILURE id=<opaque> category=<expired|proactive|unusable>
 *
 * The id is a fresh opaque `crypto.randomUUID()` value per attempt, so a
 * START/SUCCESS or START/FAILURE pair can be matched without exposing anything
 * about the token, user, or configuration. The category is a logical reason
 * only: `expired` (a real, safe-integer expiry at or before now), `proactive`
 * (still valid but inside the safety skew), or `unusable` (unknown/invalid
 * metadata).
 *
 * Signaling is inert: a throwing observer is swallowed and never changes the
 * authentication outcome. The factory returns an observer only when
 * `NODE_ENV === "development"`; test, production, and unset emit nothing.
 */

export const REFRESH_SIGNAL_PREFIX = "AUTH_REFRESH" as const;

export const REFRESH_SIGNAL_LABELS = ["START", "SUCCESS", "FAILURE"] as const;
export type RefreshSignalLabel = (typeof REFRESH_SIGNAL_LABELS)[number];

export const REFRESH_CATEGORIES = ["expired", "proactive", "unusable"] as const;
export type RefreshCategory = (typeof REFRESH_CATEGORIES)[number];

export type RefreshSignal = {
  label: RefreshSignalLabel;
  id: string;
  category: RefreshCategory;
};

export type RefreshObserver = {
  onAttempt: (signal: RefreshSignal) => void;
  onOutcome: (signal: RefreshSignal) => void;
};

export type RefreshLog = (line: string) => void;
export type RefreshSignalEnv = { NODE_ENV?: unknown };

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Classifies why a refresh was needed from expiry metadata alone. A real
 * expiry at or before `now` is `expired`; a still-valid expiry inside the skew
 * window is `proactive`; anything unknown or invalid is `unusable`.
 */
export function classifyRefreshCategory(
  expiresAt: unknown,
  now: number,
  skewMs: number,
): RefreshCategory {
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) return "unusable";
  if (expiresAt <= now) return "expired";
  if (expiresAt - skewMs <= now) return "proactive";
  return "unusable";
}

/**
 * Generates a fresh opaque correlation id. Falls back to two independent
 * random fragments only if the platform crypto API is unavailable. The
 * fallback never encodes a timestamp, counter, token, user, or environment
 * value, so signaling can never break a refresh or leak clock information.
 */
export function createRefreshSignalId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `anon-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Builds the marker line from a fixed allow-list. Unknown label/category values
 * and unsafe ids are replaced with safe defaults instead of being echoed.
 */
export function formatRefreshSignal(signal: RefreshSignal): string {
  const label = REFRESH_SIGNAL_LABELS.includes(signal.label) ? signal.label : "FAILURE";
  const category = REFRESH_CATEGORIES.includes(signal.category) ? signal.category : "unusable";
  const id = typeof signal.id === "string" && SAFE_ID.test(signal.id) ? signal.id : "unavailable";
  return `${REFRESH_SIGNAL_PREFIX} ${label} id=${id} category=${category}`;
}

/** Creates a pure observer that formats every signal into the provided log. */
export function createRefreshObserver(log: RefreshLog): RefreshObserver {
  return {
    onAttempt: (signal) => log(formatRefreshSignal(signal)),
    onOutcome: (signal) => log(formatRefreshSignal(signal)),
  };
}

/**
 * Returns a marker observer only for `NODE_ENV === "development"`. Every other
 * value (including test, production, and unset) yields `undefined`, so the
 * server emits nothing.
 */
export function createDevelopmentRefreshObserver(
  env: RefreshSignalEnv,
  log: RefreshLog = (line) => console.info(line),
): RefreshObserver | undefined {
  if (env.NODE_ENV !== "development") return undefined;
  return createRefreshObserver(log);
}

/**
 * Invokes an observer method without ever letting a reporter failure change the
 * authentication result. Both the attempt and the outcome call use this guard.
 */
export function reportRefreshSignal(
  observer: RefreshObserver | undefined,
  method: "onAttempt" | "onOutcome",
  signal: RefreshSignal,
): void {
  if (!observer) return;
  try {
    observer[method](signal);
  } catch {
    // Observer and logging failures must never alter refresh behavior.
  }
}
