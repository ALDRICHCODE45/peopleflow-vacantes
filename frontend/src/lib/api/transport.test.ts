import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./requestJson";

const decoder = (value: unknown) => value as { hello: string };
const url = "http://127.0.0.1:8080/jobs";

function response(status: number, body?: unknown) {
  return {
    ok: status < 300,
    status,
    json: async () => {
      if (body !== undefined) return body;
      throw new SyntaxError("Unexpected token 'N', is not valid JSON");
    },
  };
}

async function failsWith(
  status: number,
  error: unknown,
  options: { notFoundStatus?: number } = {},
) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(status)));
  await expect(requestJson(url, { decoder, ...options })).resolves.toEqual({
    ok: false,
    error,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("generic JSON transport", () => {
  it("fetches with no-store and minimal headers, then returns decoded data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(200, { hello: "mundo" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestJson(url, { decoder })).resolves.toEqual({
      ok: true,
      data: { hello: "mundo" },
    });
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.cache).toBe("no-store");
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect([...headers.keys()].sort()).toEqual(["accept"]);
  });

  it("classifies an aborted request as a retryable timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init: { signal: AbortSignal }) =>
          new Promise<never>((_resolve, reject) =>
            init.signal.addEventListener("abort", () =>
              reject(
                new DOMException("The operation was aborted.", "AbortError"),
              ),
            ),
          ),
      ),
    );
    vi.useFakeTimers();
    const assertion = expect(
      requestJson(url, { timeoutMs: 1000, decoder }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "timeout", retryable: true },
    });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
  });

  it("classifies network failure as retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    await expect(requestJson(url, { decoder })).resolves.toEqual({
      ok: false,
      error: { kind: "network", retryable: true },
    });
  });

  it("classifies 429/5xx as retryable and every generic 4xx (including a bare list 404) as a non-retryable status error", async () => {
    await failsWith(429, { kind: "status", retryable: true, status: 429 });
    await failsWith(503, { kind: "status", retryable: true, status: 503 });
    await failsWith(400, { kind: "status", retryable: false, status: 400 });
    await failsWith(404, { kind: "status", retryable: false, status: 404 });
  });

  it("maps detail 404 to not-found only through the explicit not-found status discriminator", async () => {
    // The discriminator is exact: a detail 404 becomes not-found, but no other status under it ever does.
    await failsWith(
      404,
      { kind: "not_found", retryable: false, status: 404 },
      { notFoundStatus: 404 },
    );
    await failsWith(
      400,
      { kind: "status", retryable: false, status: 400 },
      { notFoundStatus: 404 },
    );
  });

  it("classifies invalid JSON and decoder/schema failures as non-retryable invalid responses", async () => {
    await failsWith(200, { kind: "invalid_response", retryable: false });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(200, { hello: "mundo" })),
    );
    const result = await requestJson(url, {
      decoder: () => {
        throw new Error("schema violation details");
      },
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_response", retryable: false },
    });
    // Safe classification: raw bodies and decoder internals never leak into the result.
    expect(JSON.stringify(result)).not.toContain("schema violation details");
  });

  it("never logs: every failure classification stays silent on the console", async () => {
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      );
      await requestJson(url, { decoder });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500)));
      await requestJson(url, { decoder });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200)));
      await requestJson(url, {
        decoder: () => {
          throw new Error("secret decoder detail");
        },
      });
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
