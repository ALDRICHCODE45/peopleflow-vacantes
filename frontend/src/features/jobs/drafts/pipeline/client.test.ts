import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
const env = vi.hoisted(() => ({ reads: 0 }));
vi.mock("@/lib/env/server", () => ({
  get serverEnv() {
    env.reads++;
    return { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 8000 };
  },
}));

import { getDraftPipeline, saveDraftPipeline } from "./client";

const draftId = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const etag = '"opaque-pipeline-tag+/="';
const pipeline = {
  version: "0",
  structure_locked: false,
  stages: ["new", "screening", "screening_ok", "in_process", "placement", "custom"].map((kind, index) => ({
    id: `0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8${index}`,
    kind,
    name: kind,
  })),
  exit: { id: draftId, kind: "discarded", name: "Descartados" },
  limits: { maxCustomStages: 3, nameMaxLength: 40 },
};
const body = {
  stages: [{ id: pipeline.stages[0].id, name: "Nuevos" }, { name: "Prueba" }],
  exit: { id: draftId, name: "Descartados" },
};
function response(data: unknown, status = 200, tag: string | null = etag) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), {
    status,
    headers: tag === null ? {} : { etag: tag },
  }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); env.reads = 0; });

for (const method of ["GET", "PUT"] as const) {
  describe(method, () => {
    const call = () => method === "GET"
      ? getDraftPipeline({ token: " secret ", draftId })
      : saveDraftPipeline({ token: " secret ", draftId, ifMatch: etag, body });

    it("uses the absolute v2 URL, Bearer only, no-store and redirect error", async () => {
      const fetch = response(pipeline);
      expect(await call()).toEqual({ ok: true, data: pipeline, etag });
      expect(fetch).toHaveBeenCalledTimes(1);
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(`http://localhost:8080/v2/me/company/job-drafts/${draftId}/pipeline`);
      expect(init).toMatchObject({ redirect: "error", cache: "no-store" });
      expect(init.method ?? "GET").toBe(method);
      expect(Object.fromEntries(new Headers(init.headers))).toEqual({
        accept: "application/json",
        authorization: "Bearer secret",
        ...(method === "PUT" ? { "content-type": "application/json", "if-match": etag } : {}),
      });
      expect(init.body).toBe(method === "PUT" ? JSON.stringify(body) : undefined);
    });

    it.each([false, true])("decodes the required structure_locked boolean (%s)", async structure_locked => {
      response({ ...pipeline, structure_locked });
      expect(await call()).toEqual({ ok: true, data: { ...pipeline, structure_locked }, etag });
    });
    it.each([undefined, null, "true", 1])("rejects absent or nonboolean structure_locked (%s)", async structure_locked => {
      response({ ...pipeline, structure_locked });
      expect(await call()).toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
    });

    it.each(["0", "1", "90071992547409931234567890"])("preserves decimal version %s", async version => {
      response({ ...pipeline, version });
      expect(await call()).toEqual({ ok: true, data: { ...pipeline, version }, etag });
    });

    it.each([null, "", "   "])("requires a nonblank ETag (%s)", async tag => {
      response(pipeline, 200, tag);
      expect(await call()).toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
    });

    it.each([
      { ...pipeline, extra: true },
      ...["01", "-1", "1.0", "1\n", 1].map(version => ({ ...pipeline, version })),
      ...[
        { ...pipeline.stages[0], kind: "unknown" },
        { ...pipeline.stages[0], kind: "discarded" },
        { ...pipeline.stages[0], extra: true },
        { ...pipeline.stages[0], id: "bad" },
        { ...pipeline.stages[0], id: `${draftId}\n` },
        { ...pipeline.stages[0], name: 7 },
      ].map(stage => ({ ...pipeline, stages: [stage] })),
      { ...pipeline, exit: { ...pipeline.exit, kind: "new" } },
      { ...pipeline, exit: { ...pipeline.exit, extra: true } },
      { ...pipeline, exit: { ...pipeline.exit, id: "bad" } },
      { ...pipeline, limits: { ...pipeline.limits, extra: true } },
      ...[0, -1, 1.5, "3"].map(maxCustomStages => ({ ...pipeline, limits: { ...pipeline.limits, maxCustomStages } })),
      ...[0, -1, 1.5, "40"].map(nameMaxLength => ({ ...pipeline, limits: { ...pipeline.limits, nameMaxLength } })),
    ])("rejects malformed response %#", async data => {
      response(data);
      expect(await call()).toEqual({ ok: false, error: { kind: "invalid_response", retryable: false } });
    });

    it.each([201, 202])("requires exactly 200, not %s", async status => {
      response(pipeline, status);
      expect(await call()).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } });
    });

    it.each([
      [400, "invalid_request"], [400, "validation_error"], [401, "unauthenticated"],
      [403, "forbidden"], [403, "company_inactive"], [404, "not_found"],
      [409, "company_not_active"], [412, "version_conflict"], [413, "payload_too_large"],
      [428, "precondition_required"], [500, "internal_error"], [503, "internal_error"],
    ] as const)("preserves %s %s without retry", async (status, code) => {
      const envelope = { error: "Unsafe detail", code };
      const fetch = response(envelope, status);
      expect(await call()).toMatchObject({ ok: false, error: { status, retryable: false }, envelope });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      { error: "Unsafe", code: "invalid_request", details: "Unsafe" },
      { error: "", code: "invalid_request" },
      { error: "Unsafe", code: "" },
      { code: "invalid_request" },
    ])("rejects malformed error envelope %#", async envelope => {
      response(envelope, 400);
      expect(await call()).toEqual({ ok: false, error: { kind: "status", status: 400, retryable: false } });
    });

    it("does not retry network failures", async () => {
      const fetch = vi.fn().mockRejectedValue(new Error("Unsafe network detail"));
      vi.stubGlobal("fetch", fetch);
      expect(await call()).toEqual({ ok: false, error: { kind: "network", retryable: false } });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("does not retry timeout failures", async () => {
      vi.useFakeTimers();
      const fetch = vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }));
      vi.stubGlobal("fetch", fetch);
      const pending = call();
      await vi.advanceTimersByTimeAsync(8001);
      expect(await pending).toEqual({ ok: false, error: { kind: "timeout", retryable: false } });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
      { token: " ", draftId, kind: "missing_token" },
      { token: "x", draftId: "bad", kind: "invalid_request" },
      { token: "x", draftId: ` ${draftId}`, kind: "invalid_request" },
      { token: "x", draftId: `${draftId}\n`, kind: "invalid_request" },
    ])("guards before env/fetch %#", async ({ token, draftId: id, kind }) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const result = method === "GET"
        ? await getDraftPipeline({ token, draftId: id })
        : await saveDraftPipeline({ token, draftId: id, ifMatch: etag, body });
      expect(result).toEqual({ ok: false, error: { kind, retryable: false } });
      expect(fetch).not.toHaveBeenCalled();
      expect(env.reads).toBe(0);
    });
  });
}

it.each([
  { ...body, extra: true },
  { stages: body.stages },
  { ...body, stages: "bad" },
  { ...body, stages: [{ name: "x", kind: "custom" }] },
  { ...body, stages: [{ name: 7 }] },
  { ...body, stages: [{ id: "bad", name: "x" }] },
  { ...body, stages: [{ id: null, name: "x" }] },
  { ...body, exit: { name: "x" } },
  { ...body, exit: { id: draftId, name: "x", kind: "discarded" } },
  { ...body, exit: { id: "bad", name: "x" } },
  null,
])("guards malformed PUT body before env/fetch %#", async invalidBody => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await saveDraftPipeline({ token: "x", draftId, ifMatch: etag, body: invalidBody })).toEqual({
    ok: false, error: { kind: "invalid_request", retryable: false },
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(env.reads).toBe(0);
});

it.each(["", "   "])("guards blank If-Match (%s) before env/fetch", async ifMatch => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  expect(await saveDraftPipeline({ token: "x", draftId, ifMatch, body })).toEqual({
    ok: false, error: { kind: "invalid_request", retryable: false },
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(env.reads).toBe(0);
});

it("validates shape only, leaving business rules and opaque If-Match to their owners", async () => {
  const shapeOnly = { stages: [{ name: "" }, { name: "" }], exit: { id: draftId, name: "" } };
  const fetch = response({ ...pipeline, stages: [] });
  expect(await saveDraftPipeline({ token: "x", draftId, ifMatch: "opaque-unparsed", body: shapeOnly })).toEqual({
    ok: true, data: { ...pipeline, stages: [] }, etag,
  });
  expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(shapeOnly));
  expect(new Headers(fetch.mock.calls[0][1].headers).get("if-match")).toBe("opaque-unparsed");
});
