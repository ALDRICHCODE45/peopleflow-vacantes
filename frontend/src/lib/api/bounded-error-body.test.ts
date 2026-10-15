import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./requestJson";
const url = "https://fixture.example/me/company";
const error = { kind: "status", retryable: false, status: 401 };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("opt-in bounded error bodies", () => {
  it("accepts the exact byte boundary, including multi-byte UTF-8", async () => {
    const raw = JSON.stringify({ error: "á" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(raw, { status: 401 })));
    const result = await requestJson(url, { decoder: () => true, errorDecoder: (value) => value, maxErrorBodyBytes: new TextEncoder().encode(raw).length });
    expect(result).toEqual({ ok: false, error, envelope: { error: "á" } });
  });
  it("cancels oversized streaming bodies despite a misleading Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(513))); }, cancel });
    const decoder = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 401, headers: { "content-length": "1" } })));
    expect(await requestJson(url, { decoder: () => true, errorDecoder: decoder, maxErrorBodyBytes: 512 })).toEqual({ ok: false, error });
    expect(decoder).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels a stalled error stream at the request deadline and preserves status classification", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status: 401 })));
    const pending = requestJson(url, { decoder: () => true, errorDecoder: (value) => value, maxErrorBodyBytes: 512, timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    expect(await pending).toEqual({ ok: false, error });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("keeps legacy errorDecoder JSON behavior without opting in", async () => {
    const json = vi.fn().mockResolvedValue({ legacy: "value" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 401, ok: false, json }));
    expect(await requestJson(url, { decoder: () => true, errorDecoder: (value) => value })).toEqual({ ok: false, error, envelope: { legacy: "value" } });
    expect(json).toHaveBeenCalledTimes(1);
  });
});
