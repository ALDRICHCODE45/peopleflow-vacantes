// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_TIMEOUT_MS } from "@/lib/env/validate";
import { COGNITO_MAX_RESPONSE_BYTES, callCognito } from "./transport";

const ENDPOINT = "https://cognito-idp.us-east-1.amazonaws.com/";
const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/x-amz-json-1.1", ...headers },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("callCognito request", () => {
  it("POSTs unsigned awsJson1_1 to the endpoint with no-store and redirects refused", async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await callCognito(ENDPOINT, "SignUp", { ClientId: "c" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/x-amz-json-1.1");
    expect(headers.get("x-amz-target")).toBe("AWSCognitoIdentityProviderService.SignUp");
    expect(headers.has("authorization")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({ ClientId: "c" });
  });
});

describe("callCognito responses", () => {
  it("returns the parsed object for 200", async () => {
    fetchMock.mockResolvedValue(json(200, { UserConfirmed: false }));
    await expect(callCognito(ENDPOINT, "SignUp", {})).resolves.toEqual({
      ok: true,
      body: { UserConfirmed: false },
    });
  });

  it.each([
    ["the x-amzn-ErrorType header", { "x-amzn-errortype": "UsernameExistsException:http://internal.amazon.com/" }, {}],
    ["a namespaced __type", {}, { __type: "com.amazonaws.cognito#UsernameExistsException", message: "secret detail" }],
    ["a plain __type", {}, { __type: "UsernameExistsException", message: "An account with the given email already exists." }],
  ])("reads a 4xx error name from %s and drops the message", async (_label, headers, body) => {
    fetchMock.mockResolvedValue(json(400, body, headers));
    const result = await callCognito(ENDPOINT, "SignUp", {});
    expect(result).toEqual({ ok: false, kind: "service_error", errorName: "UsernameExistsException" });
    expect(JSON.stringify(result)).not.toMatch(/message|detail|already exists/);
  });

  it.each([
    ["5xx", () => json(500, { __type: "InternalErrorException" })],
    ["503", () => json(503, { __type: "ServiceUnavailable" })],
    ["2xx other than 200", () => json(201, {})],
    ["4xx without an error name", () => json(400, { message: "nope" })],
    ["4xx with a garbage error name", () => json(400, { __type: "<script>" })],
    ["non-JSON 200", () => new Response("<html>", { status: 200 })],
    ["JSON array 200", () => json(200, [1, 2])],
  ])("collapses %s to unavailable", async (_label, make) => {
    fetchMock.mockResolvedValue(make());
    await expect(callCognito(ENDPOINT, "SignUp", {})).resolves.toEqual({ ok: false, kind: "unavailable" });
  });

  it("collapses a network error or refused redirect to unavailable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed: redirect mode is set to error"));
    await expect(callCognito(ENDPOINT, "SignUp", {})).resolves.toEqual({ ok: false, kind: "unavailable" });
  });

  it("refuses a body over the response cap", async () => {
    const big = JSON.stringify({ pad: "x".repeat(COGNITO_MAX_RESPONSE_BYTES) });
    fetchMock.mockResolvedValue(new Response(big, { status: 200 }));
    await expect(callCognito(ENDPOINT, "SignUp", {})).resolves.toEqual({ ok: false, kind: "unavailable" });
  });

  it("caps the response at 16 KiB", () => {
    expect(COGNITO_MAX_RESPONSE_BYTES).toBe(16 * 1024);
  });
});

describe("callCognito timeout", () => {
  it("aborts at the default API timeout and returns unavailable", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const pending = callCognito(ENDPOINT, "SignUp", {});
    await vi.advanceTimersByTimeAsync(DEFAULT_API_TIMEOUT_MS - 1);
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: false, kind: "unavailable" });
  });

  it("honours a custom timeout, including a body that stalls after the headers", async () => {
    vi.useFakeTimers();
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
      },
    });
    fetchMock.mockResolvedValue(new Response(stalled, { status: 200 }));
    const pending = callCognito(ENDPOINT, "SignUp", {}, { timeoutMs: 1500 });
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toEqual({ ok: false, kind: "unavailable" });
  });
});
