import { describe, expect, it, vi } from "vitest";
import {
  REFRESH_ERROR,
  isTokenExpired,
  refreshAccessToken,
  refreshSessionToken,
  type TokenLike,
} from "./refresh";
import { createRefreshObserver, type RefreshSignal } from "./refresh-observer";

const TOKEN_ENDPOINT = "https://hosted.example.com/oauth2/token";
const config = {
  tokenEndpoint: TOKEN_ENDPOINT,
  clientId: "client-id",
  clientSecret: "client-secret",
};

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status < 300,
    status,
    json: async () => body,
  }) as unknown as Response;

function bodyOf(call: unknown): URLSearchParams {
  const init = (call as [string, RequestInit])[1];
  return new URLSearchParams(String(init.body));
}

describe("refreshAccessToken", () => {
  it("posts refresh_token grants as a form body with the configured credentials and no tokens in the URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 900,
        id_token: "new-id",
      }),
    );
    const now = () => 1_000_000;

    const result = await refreshAccessToken({
      ...config,
      refreshToken: "old-refresh",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now,
    });

    expect(result).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 1_000_000 + 900_000,
      idToken: "new-id",
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TOKEN_ENDPOINT);
    expect(url).not.toContain("old-refresh");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = bodyOf(fetchImpl.mock.calls[0]);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");
    expect(body.get("refresh_token")).toBe("old-refresh");
  });

  it("keeps the previous refresh token when the provider does not rotate it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: "new-access", expires_in: 60 }),
    );
    const result = await refreshAccessToken({
      ...config,
      refreshToken: "old-refresh",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 0,
    });
    expect(result.refreshToken).toBe("old-refresh");
  });

  it("fails closed with a generic error that never leaks tokens when the provider rejects or returns a broken payload", async () => {
    const rejected = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: "invalid_grant" }));
    await expect(
      refreshAccessToken({
        ...config,
        refreshToken: "old-refresh",
        fetchImpl: rejected as unknown as typeof fetch,
      }),
    ).rejects.toThrow("Cognito token refresh failed");

    for (const body of [{}, { access_token: "", expires_in: 60 }, { access_token: "a" }]) {
      const malformed = vi.fn().mockResolvedValue(jsonResponse(200, body));
      const error = await refreshAccessToken({
        ...config,
        refreshToken: "old-refresh",
        fetchImpl: malformed as unknown as typeof fetch,
      }).then(
        () => null,
        (reason: unknown) => reason as Error,
      );
      expect(error?.message).toBe("Cognito token refresh failed");
      expect(JSON.stringify(error)).not.toContain("old-refresh");
      expect(JSON.stringify(error)).not.toContain("new-access");
    }
  });

  it("aborts a stalled token request through a server-side timeout signal", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const error = await refreshAccessToken({
      ...config,
      refreshToken: "old-refresh",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 5,
    }).then(
      () => null,
      (reason: unknown) => reason as Error,
    );
    expect(error?.message).toBe("Cognito token refresh failed");
  });
});

describe("isTokenExpired", () => {
  it("treats missing or non-finite expiries as expired and applies a safety skew", () => {
    expect(isTokenExpired(undefined, 0)).toBe(true);
    expect(isTokenExpired(Number.NaN, 0)).toBe(true);
    expect(isTokenExpired(100_000, 9_000)).toBe(false);
    expect(isTokenExpired(10_000, 9_999, 1_000)).toBe(true);
  });
});

describe("refreshSessionToken", () => {
  const valid: TokenLike = {
    name: "Ada",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    expiresAt: 100_000,
  };

  it("does not refresh while the access token is still valid", async () => {
    const refresh = vi.fn();
    await expect(
      refreshSessionToken({ token: valid, now: 1_000, refresh }),
    ).resolves.toBe(valid);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("rotates the session tokens when the access token is expired", async () => {
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 200_000,
    });
    const result = await refreshSessionToken({ token: valid, now: 70_000, refresh });
    expect(result).toMatchObject({
      name: "Ada",
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 200_000,
    });
    expect(result.error).toBeUndefined();
  });

  it("expires the session without unusable secrets when the refresh token is missing", async () => {
    const refresh = vi.fn();
    const result = await refreshSessionToken({
      token: { name: "Ada", accessToken: "old-access", expiresAt: 10_000 },
      now: 10_000,
      refresh,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(result).toEqual({ name: "Ada", error: REFRESH_ERROR });
    expect(JSON.stringify(result)).not.toContain("old-access");
  });

  it("expires the session and emits the generic error when the refresh fails", async () => {
    const result = await refreshSessionToken({
      token: valid,
      now: 70_000,
      refresh: vi.fn().mockRejectedValue(new Error("token refresh rejected")),
    });
    expect(result).toEqual({ name: "Ada", error: REFRESH_ERROR });
    expect(result.accessToken).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
    expect(result.expiresAt).toBeUndefined();
  });

  it("attempts a refresh when the expiry is unknown, failing closed instead of trusting the token", async () => {
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 20_000,
    });
    const result = await refreshSessionToken({
      token: { name: "Ada", refreshToken: "old-refresh" },
      now: 0,
      refresh,
    });
    expect(refresh).toHaveBeenCalledWith("old-refresh");
    expect(result.accessToken).toBe("new-access");
  });
});

describe("development refresh signal", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const expired: TokenLike = {
    name: "Ada",
    accessToken: "secret-access",
    refreshToken: "secret-refresh",
    expiresAt: 70_000,
  };

  function recorder() {
    const signals: RefreshSignal[] = [];
    return {
      signals,
      observer: {
        onAttempt: (signal: RefreshSignal) => signals.push(signal),
        onOutcome: (signal: RefreshSignal) => signals.push(signal),
      },
    };
  }

  const noSignalCases: Array<[string, TokenLike]> = [
    ["the session already errored", { name: "Ada", error: REFRESH_ERROR, refreshToken: "secret-refresh" }],
    ["the access token is still valid outside the skew", { name: "Ada", accessToken: "secret-access", refreshToken: "secret-refresh", expiresAt: 100_000 }],
    ["the refresh token is missing", { name: "Ada", accessToken: "secret-access", expiresAt: 1_000 }],
  ];

  it("emits a correlated START/SUCCESS pair with a fresh opaque id and the expired category", async () => {
    const { signals, observer } = recorder();
    const refresh = vi.fn().mockResolvedValue({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: 200_000,
    });

    const result = await refreshSessionToken({ token: expired, now: 70_000, refresh, observer });

    expect(result.accessToken).toBe("new-access");
    expect(signals.map((signal) => signal.label)).toEqual(["START", "SUCCESS"]);
    expect(signals[0].category).toBe("expired");
    expect(signals[1].category).toBe("expired");
    expect(signals[0].id).toMatch(UUID);
    expect(signals[0].id).toBe(signals[1].id);
  });

  it("uses a fresh id per attempt and never derives it from token material", async () => {
    const refresh = vi.fn().mockResolvedValue({ accessToken: "new-access", expiresAt: 200_000 });
    const first = recorder();
    const second = recorder();

    await refreshSessionToken({ token: expired, now: 70_000, refresh, observer: first.observer });
    await refreshSessionToken({ token: expired, now: 70_000, refresh, observer: second.observer });

    expect(first.signals[0].id).toMatch(UUID);
    expect(second.signals[0].id).toMatch(UUID);
    expect(first.signals[0].id).not.toBe(second.signals[0].id);
    expect(first.signals[0].id).not.toContain("secret");
  });

  it("classifies a skew-triggered but still-valid attempt as proactive", async () => {
    const { signals, observer } = recorder();
    await refreshSessionToken({
      token: { name: "Ada", accessToken: "secret-access", refreshToken: "secret-refresh", expiresAt: 100_000 },
      now: 71_000,
      refresh: vi.fn().mockResolvedValue({ accessToken: "new-access", expiresAt: 200_000 }),
      observer,
    });
    expect(signals.map((signal) => signal.category)).toEqual(["proactive", "proactive"]);
  });

  it("falls back to unusable when the expiry metadata is unknown or invalid", async () => {
    const { signals, observer } = recorder();
    await refreshSessionToken({
      token: { name: "Ada", accessToken: "secret-access", refreshToken: "secret-refresh", expiresAt: Number.NaN },
      now: 71_000,
      refresh: vi.fn().mockResolvedValue({ accessToken: "new-access", expiresAt: 200_000 }),
      observer,
    });
    expect(signals[0].category).toBe("unusable");
  });

  it("emits FAILURE with the same id when the token endpoint throws", async () => {
    const { signals, observer } = recorder();
    const result = await refreshSessionToken({
      token: expired,
      now: 70_000,
      refresh: vi.fn().mockRejectedValue(new Error("provider exploded")),
      observer,
    });
    expect(result.error).toBe(REFRESH_ERROR);
    expect(signals.map((signal) => signal.label)).toEqual(["START", "FAILURE"]);
    expect(signals[0].id).toBe(signals[1].id);
  });

  it("emits FAILURE when the refreshed credentials fail validation", async () => {
    const { signals, observer } = recorder();
    const result = await refreshSessionToken({
      token: expired,
      now: 70_000,
      refresh: vi.fn().mockResolvedValue({ accessToken: " ", refreshToken: "rotated", expiresAt: 200_000 }),
      observer,
    });
    expect(result.error).toBe(REFRESH_ERROR);
    expect(signals.map((signal) => signal.label)).toEqual(["START", "FAILURE"]);
  });

  it.each(noSignalCases)("does not signal when %s", async (_case, token) => {
    const { signals, observer } = recorder();
    await refreshSessionToken({ token, now: 1_000, refresh: vi.fn(), observer });
    expect(signals).toEqual([]);
  });

  it("keeps the marker line free of token values, provider errors, and config", async () => {
    const lines: string[] = [];
    await refreshSessionToken({
      token: { name: "Ada", accessToken: "secret-access", refreshToken: "secret-refresh", expiresAt: 1_000 },
      now: 5_000,
      observer: createRefreshObserver((line) => lines.push(line)),
      refresh: vi.fn().mockRejectedValue(new Error("secret-provider-message")),
    });

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatch(/^AUTH_REFRESH (START|FAILURE) id=[0-9a-f-]{36} category=expired$/i);
      for (const leak of ["secret-access", "secret-refresh", "secret-provider-message"]) {
        expect(line).not.toContain(leak);
      }
    }
  });

  it("keeps the refreshed session when the start reporter throws", async () => {
    const onOutcome = vi.fn();
    const observer = {
      onAttempt: () => {
        throw new Error("start reporter failed");
      },
      onOutcome,
    };
    const result = await refreshSessionToken({
      token: expired,
      now: 70_000,
      observer,
      refresh: vi.fn().mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh", expiresAt: 200_000 }),
    });
    expect(result.accessToken).toBe("new-access");
    expect(result.error).toBeUndefined();
    expect(onOutcome).toHaveBeenCalledOnce();
  });

  it("keeps the refreshed session when the outcome reporter throws", async () => {
    const observer = {
      onAttempt: vi.fn(),
      onOutcome: () => {
        throw new Error("outcome reporter failed");
      },
    };
    const result = await refreshSessionToken({
      token: expired,
      now: 70_000,
      observer,
      refresh: vi.fn().mockResolvedValue({ accessToken: "new-access", refreshToken: "new-refresh", expiresAt: 200_000 }),
    });
    expect(result.accessToken).toBe("new-access");
    expect(observer.onAttempt).toHaveBeenCalledOnce();
  });

  it("still fails closed when both reporters throw on a rejected refresh", async () => {
    const observer = {
      onAttempt: () => {
        throw new Error("start reporter failed");
      },
      onOutcome: () => {
        throw new Error("outcome reporter failed");
      },
    };
    const result = await refreshSessionToken({
      token: expired,
      now: 70_000,
      observer,
      refresh: vi.fn().mockRejectedValue(new Error("provider exploded")),
    });
    expect(result).toEqual({ name: "Ada", error: REFRESH_ERROR });
    expect(result.accessToken).toBeUndefined();
    expect(result.refreshToken).toBeUndefined();
  });
});
