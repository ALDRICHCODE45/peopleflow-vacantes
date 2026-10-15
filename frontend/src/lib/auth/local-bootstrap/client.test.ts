import { afterEach, describe, expect, it, vi } from "vitest";
import { applyLocalIdentity, stageLocalIdentity } from "./client";
import { LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS, type LocalBootstrapConfig } from "./config";
import {
  FIXTURE_ACCESS,
  FIXTURE_BASE_URL,
  FIXTURE_KEY,
  FIXTURE_NEXTAUTH_SECRET,
  FIXTURE_OPERATION_CODE,
  FIXTURE_SITE_URL,
} from "./fixtures";

const config: LocalBootstrapConfig = {
  baseUrl: FIXTURE_BASE_URL,
  stageUrl: `${FIXTURE_BASE_URL}/stage`,
  applyUrl: `${FIXTURE_BASE_URL}/apply`,
  trustedOrigin: FIXTURE_SITE_URL,
  key: FIXTURE_KEY,
  timeoutMs: LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS,
  csrfSecret: FIXTURE_NEXTAUTH_SECRET,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stageLocalIdentity", () => {
  it("posts the fixed empty JSON body to the fixed loopback URL with only the two server-held headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 },
        { status: 202 },
      ),
    );
    const outcome = await stageLocalIdentity(config, FIXTURE_ACCESS, fetchMock);

    expect(outcome).toEqual({
      kind: "success",
      status: 202,
      data: { operation_code: FIXTURE_OPERATION_CODE, expires_in: 60 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8081/stage");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${FIXTURE_ACCESS}`);
    expect(headers.get("x-local-bootstrap-key")).toBe(FIXTURE_KEY);
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("passes through only a whitelisted sanitized error envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ ok: false, code: "stage_pending" }, { status: 409 }),
    );
    expect(await stageLocalIdentity(config, FIXTURE_ACCESS, fetchMock)).toEqual({
      kind: "error",
      status: 409,
      code: "stage_pending",
    });
  });

  it.each([
    ["an extra error field", { ok: false, code: "bootstrap_failed", error: "raw-upstream-secret" }],
    ["an unknown code", { ok: false, code: "unknown_code" }],
    ["a mismatched status pair", { ok: false, code: "stage_pending" }],
    ["a malformed success body", { ok: true, operation_code: "short", expires_in: 60 }],
  ])("fails closed on %s without leaking the raw body", async (_label, body) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(body, { status: 500 }));
    const outcome = await stageLocalIdentity(config, FIXTURE_ACCESS, fetchMock);
    expect(outcome).toEqual({ kind: "failure" });
    expect(JSON.stringify(outcome)).not.toContain("raw-upstream-secret");
  });

  it("fails closed on an oversized success body", async () => {
    const oversized = { ok: true, operation_code: FIXTURE_OPERATION_CODE, expires_in: 60, pad: "x".repeat(20_000) };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(oversized, { status: 202 }));
    expect(await stageLocalIdentity(config, FIXTURE_ACCESS, fetchMock)).toEqual({ kind: "failure" });
  });

  it("fails closed on a network rejection without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connection refused"));
    expect(await stageLocalIdentity(config, FIXTURE_ACCESS, fetchMock)).toEqual({ kind: "failure" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts and reports failure once the deadline elapses, without retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = stageLocalIdentity(config, FIXTURE_ACCESS, fetchMock as unknown as typeof fetch);
    await vi.advanceTimersByTimeAsync(LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ kind: "failure" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("applyLocalIdentity", () => {
  it("posts only the opaque operation code and decodes the exact 200 schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, code: "created" }));
    const outcome = await applyLocalIdentity(config, FIXTURE_ACCESS, FIXTURE_OPERATION_CODE, fetchMock);

    expect(outcome).toEqual({ kind: "success", status: 200, data: { code: "created" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:8081/apply");
    expect(init.body).toBe(JSON.stringify({ operation_code: FIXTURE_OPERATION_CODE }));
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${FIXTURE_ACCESS}`);
  });

  it("passes through approval_required instead of reporting success or retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ ok: false, code: "approval_required" }, { status: 409 }),
    );
    expect(await applyLocalIdentity(config, FIXTURE_ACCESS, FIXTURE_OPERATION_CODE, fetchMock)).toEqual({
      kind: "error",
      status: 409,
      code: "approval_required",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an ambiguous apply transport failure without retrying", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = applyLocalIdentity(
      config,
      FIXTURE_ACCESS,
      FIXTURE_OPERATION_CODE,
      fetchMock as unknown as typeof fetch,
    );
    await vi.advanceTimersByTimeAsync(LOCAL_BOOTSTRAP_REQUEST_TIMEOUT_MS);
    expect(await pending).toEqual({ kind: "failure" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
