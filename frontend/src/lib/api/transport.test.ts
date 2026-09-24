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

  it("keeps the GET-only request shape when no caller sends a method, body, or headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(200, { hello: "mundo" }));
    vi.stubGlobal("fetch", fetchMock);
    await requestJson(url, { decoder });
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(url);
    expect(init.method === undefined || init.method === "GET").toBe(true);
    expect(init.body).toBeUndefined();
    const headers = new Headers(init.headers);
    expect([...headers.keys()].sort()).toEqual(["accept"]);
    // The transport never invents authorization for any caller.
    expect(headers.get("authorization")).toBeNull();
    expect(init.cache).toBe("no-store");
  });

  it("serializes a JSON body with the POST method and applies the JSON content type by default", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(201, { hello: "mundo" }));
    vi.stubGlobal("fetch", fetchMock);
    const body = { title: "Ingeniera Frontend", salary_min: 25000 };
    await expect(
      requestJson(url, { decoder, method: "POST", body }),
    ).resolves.toEqual({ ok: true, data: { hello: "mundo" } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(body));
    const headers = new Headers(init.headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("authorization")).toBeNull();
  });

  it("merges caller headers over the transport defaults so a JSON caller owns its content type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response(201, { hello: "mundo" }));
    vi.stubGlobal("fetch", fetchMock);
    await requestJson(url, {
      decoder,
      method: "POST",
      body: { hello: "mundo" },
      headers: {
        "content-type": "application/vnd.peopleflow+json",
        "x-request-id": "req-1",
        accept: "application/vnd.peopleflow+json",
      },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("content-type")).toBe("application/vnd.peopleflow+json");
    expect(headers.get("accept")).toBe("application/vnd.peopleflow+json");
    expect(headers.get("x-request-id")).toBe("req-1");
    expect(headers.get("authorization")).toBeNull();
  });

  it("attaches a decoded error envelope only when the caller supplies an error decoder", async () => {
    const envelope = { error: "company is not active", code: "company_not_active" };
    const errorDecoder = (value: unknown) =>
      value as { error: string; code: string };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(409, envelope)));
    await expect(requestJson(url, { decoder, errorDecoder })).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 409 },
      envelope,
    });

    // Without the opt-in decoder the failure result is byte-for-byte the old one.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(409, envelope)));
    const undecoded = await requestJson(url, { decoder });
    expect(undecoded).toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 409 },
    });
    expect((undecoded as { envelope?: unknown }).envelope).toBeUndefined();

    // A non-JSON body, and a decoder that rejects the body, keep the status
    // classification and never surface error-body detail.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500)));
    const unparsable = await requestJson(url, { decoder, errorDecoder });
    expect(unparsable).toEqual({
      ok: false,
      error: { kind: "status", retryable: true, status: 500 },
    });
    expect((unparsable as { envelope?: unknown }).envelope).toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(500, { message: "raw failure detail" })),
    );
    const rejected = await requestJson(url, {
      decoder,
      errorDecoder: () => {
        throw new Error("not an envelope: raw failure detail");
      },
    });
    expect(rejected).toEqual({
      ok: false,
      error: { kind: "status", retryable: true, status: 500 },
    });
    expect(JSON.stringify(rejected)).not.toContain("raw failure detail");
  });

  it("attaches the envelope key only when an error decoder produced a value", async () => {
    const envelope = { error: "forbidden", code: "forbidden" };
    const errorDecoder = (value: unknown) =>
      value as { error: string; code: string };

    // No decoder: the legacy failure shape owns no `envelope` property at all.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(403, envelope)));
    const noDecoder = await requestJson(url, { decoder });
    expect(Object.hasOwn(noDecoder, "envelope")).toBe(false);
    expect(noDecoder).toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 403 },
    });

    // The not-found branch keeps the same legacy shape.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404)));
    const notFound = await requestJson(url, { decoder, notFoundStatus: 404 });
    expect(Object.hasOwn(notFound, "envelope")).toBe(false);

    // Unparsable error body.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500)));
    const unparsable = await requestJson(url, { decoder, errorDecoder });
    expect(Object.hasOwn(unparsable, "envelope")).toBe(false);

    // A decoder that rejects the body.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(500, { message: "raw failure detail" })),
    );
    const rejected = await requestJson(url, {
      decoder,
      errorDecoder: () => {
        throw new Error("not an envelope: raw failure detail");
      },
    });
    expect(Object.hasOwn(rejected, "envelope")).toBe(false);

    // A decoder that resolves to no value.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(500, envelope)));
    const undefinedEnvelope = await requestJson(url, {
      decoder,
      errorDecoder: () => undefined,
    });
    expect(Object.hasOwn(undefinedEnvelope, "envelope")).toBe(false);

    // A decoded value is the only case that owns the key.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(403, envelope)));
    const decoded = await requestJson(url, { decoder, errorDecoder });
    expect(Object.hasOwn(decoded, "envelope")).toBe(true);
    expect(decoded).toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 403 },
      envelope,
    });
  });

  it("accepts any 2xx when no exact expected status is requested", async () => {
    for (const statusCode of [200, 201, 202, 206]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response(statusCode, { hello: "mundo" })),
      );
      await expect(requestJson(url, { decoder })).resolves.toEqual({
        ok: true,
        data: { hello: "mundo" },
      });
    }
  });

  it("accepts only the exact expected status and fails closed on any other 2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(201, { hello: "mundo" })),
    );
    await expect(
      requestJson(url, { decoder, expectedStatus: 201 }),
    ).resolves.toEqual({ ok: true, data: { hello: "mundo" } });

    const jsonSpy = vi.fn(async () => ({ hello: "mundo" }));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: jsonSpy }),
    );
    const result = await requestJson(url, { decoder, expectedStatus: 201 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "invalid_response", retryable: false },
    });
    expect(Object.hasOwn(result, "envelope")).toBe(false);
    // The mismatched body is a success payload, so it is never read as an error envelope.
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("mundo");
  });

  it("keeps the non-2xx classification, envelope decoding, and not-found discriminator under an expected status", async () => {
    const envelope = { error: "unauthenticated", code: "unauthenticated" };
    const errorDecoder = (value: unknown) =>
      value as { error: string; code: string };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(401, envelope)));
    await expect(
      requestJson(url, { decoder, expectedStatus: 201, errorDecoder }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: false, status: 401 },
      envelope,
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(503)));
    await expect(
      requestJson(url, { decoder, expectedStatus: 201 }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "status", retryable: true, status: 503 },
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(404)));
    await expect(
      requestJson(url, {
        decoder,
        expectedStatus: 201,
        notFoundStatus: 404,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "not_found", retryable: false, status: 404 },
    });

    // The exact-status rule never relaxes the decoder for a matching status.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(201, { hello: "mundo" })),
    );
    await expect(
      requestJson(url, {
        decoder: () => {
          throw new Error("schema violation details");
        },
        expectedStatus: 201,
      }),
    ).resolves.toEqual({
      ok: false,
      error: { kind: "invalid_response", retryable: false },
    });
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
