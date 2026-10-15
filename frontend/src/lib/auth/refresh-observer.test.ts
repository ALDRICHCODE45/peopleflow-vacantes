import { afterEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_SIGNAL_PREFIX,
  classifyRefreshCategory,
  createDevelopmentRefreshObserver,
  createRefreshObserver,
  createRefreshSignalId,
  formatRefreshSignal,
  type RefreshSignal,
} from "./refresh-observer";

const SKEW = 30_000;

describe("formatRefreshSignal", () => {
  it.each<[RefreshSignal, string]>([
    [
      { label: "START", id: "abc-123", category: "expired" },
      "AUTH_REFRESH START id=abc-123 category=expired",
    ],
    [
      { label: "SUCCESS", id: "abc-123", category: "expired" },
      "AUTH_REFRESH SUCCESS id=abc-123 category=expired",
    ],
    [
      { label: "FAILURE", id: "abc-123", category: "proactive" },
      "AUTH_REFRESH FAILURE id=abc-123 category=proactive",
    ],
    [
      { label: "FAILURE", id: "abc-123", category: "unusable" },
      "AUTH_REFRESH FAILURE id=abc-123 category=unusable",
    ],
  ])("formats %j as a fixed marker line", (signal, expected) => {
    const line = formatRefreshSignal(signal);
    expect(line).toBe(expected);
    expect(line.startsWith(`${REFRESH_SIGNAL_PREFIX} `)).toBe(true);
  });

  it("uses an allow-list and never prints token, error, session, or environment data", () => {
    const hostile = {
      label: "START",
      id: "abc-123",
      category: "expired",
      accessToken: "secret-access",
      refreshToken: "secret-refresh",
      idToken: "secret-id",
      error: new Error("secret-provider-error"),
      session: { user: { email: "person@example.com" } },
      env: { COGNITO_CLIENT_SECRET: "secret-env" },
    } as unknown as RefreshSignal;

    const line = formatRefreshSignal(hostile);

    expect(line).toBe("AUTH_REFRESH START id=abc-123 category=expired");
    for (const leak of [
      "secret-access",
      "secret-refresh",
      "secret-id",
      "secret-provider-error",
      "person@example.com",
      "secret-env",
      "COGNITO",
      "accessToken",
      "refreshToken",
      "session",
    ]) {
      expect(line).not.toContain(leak);
    }
  });

  it("replaces unknown labels, categories, and unsafe ids instead of echoing them", () => {
    const line = formatRefreshSignal({
      label: "LEAK",
      id: "bad id secret-access",
      category: "???",
    } as unknown as RefreshSignal);

    expect(line).toBe("AUTH_REFRESH FAILURE id=unavailable category=unusable");
    expect(line).not.toContain("secret-access");
  });
});

describe("classifyRefreshCategory", () => {
  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1.5, "1000", Number.MAX_SAFE_INTEGER + 10])(
    "treats %j as unusable rather than guessing",
    (expiresAt) => {
      expect(classifyRefreshCategory(expiresAt, 1_000, SKEW)).toBe("unusable");
    },
  );

  it("separates a real expiry from a skew-only proactive refresh", () => {
    expect(classifyRefreshCategory(1_000, 1_000, SKEW)).toBe("expired");
    expect(classifyRefreshCategory(999, 1_000, SKEW)).toBe("expired");
    expect(classifyRefreshCategory(1_001, 1_000, SKEW)).toBe("proactive");
    expect(classifyRefreshCategory(1_000 + SKEW, 1_000, SKEW)).toBe("proactive");
    expect(classifyRefreshCategory(1_000 + SKEW + 1, 1_000, SKEW)).toBe("unusable");
  });
});

describe("createRefreshObserver", () => {
  it("routes both report methods to the log as formatted marker lines", () => {
    const lines: string[] = [];
    const observer = createRefreshObserver((line) => lines.push(line));

    observer.onAttempt({ label: "START", id: "id-1", category: "expired" });
    observer.onOutcome({ label: "SUCCESS", id: "id-1", category: "expired" });

    expect(lines).toEqual([
      "AUTH_REFRESH START id=id-1 category=expired",
      "AUTH_REFRESH SUCCESS id=id-1 category=expired",
    ]);
  });
});

describe("createDevelopmentRefreshObserver", () => {
  it("returns no observer in test, production, or unset environments", () => {
    const log = vi.fn();
    for (const NODE_ENV of ["test", "production", undefined, "", "development ", "dev"]) {
      expect(createDevelopmentRefreshObserver({ NODE_ENV }, log)).toBeUndefined();
    }
    expect(log).not.toHaveBeenCalled();
  });

  it("emits nothing on creation and logs whitelisted markers only in development", () => {
    const lines: string[] = [];
    const observer = createDevelopmentRefreshObserver(
      { NODE_ENV: "development" },
      (line) => lines.push(line),
    );

    expect(observer).toBeDefined();
    expect(lines).toEqual([]);

    observer!.onAttempt({ label: "START", id: "id-1", category: "proactive" });
    observer!.onOutcome({ label: "FAILURE", id: "id-1", category: "proactive" });

    expect(lines).toEqual([
      "AUTH_REFRESH START id=id-1 category=proactive",
      "AUTH_REFRESH FAILURE id=id-1 category=proactive",
    ]);
  });
});

describe("createRefreshSignalId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns the crypto.randomUUID value unchanged without using the fallback randomness or clock", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(uuid);
    const random = vi.spyOn(Math, "random");
    const now = vi.spyOn(Date, "now");

    expect(createRefreshSignalId()).toBe(uuid);
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  it("falls back to two random fragments with no timestamp when crypto.randomUUID throws", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      throw new Error("crypto unavailable");
    });
    const random = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.5)
      .mockReturnValueOnce(0.25);
    const now = vi.spyOn(Date, "now");

    const id = createRefreshSignalId();

    expect(id).toBe("anon-i9");
    expect(now).not.toHaveBeenCalled();
    expect(random).toHaveBeenCalledTimes(2);
    expect(formatRefreshSignal({ label: "START", id, category: "expired" })).toBe(
      "AUTH_REFRESH START id=anon-i9 category=expired",
    );
  });
});
