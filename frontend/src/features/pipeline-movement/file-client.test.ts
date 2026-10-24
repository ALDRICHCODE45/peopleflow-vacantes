import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 20 } }));
import { downloadParticipationCv } from "./file-client";
import { downloadOrgCandidateCv } from "../org-candidates/detail/file-client";
const id = "00000000-0000-4000-8000-000000000001";
const headers = { "content-type": "application/pdf", "content-disposition": "attachment" };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
for (const [name, download] of [
  ["board", () => downloadParticipationCv("token", id, id)],
  ["pool", () => downloadOrgCandidateCv("token", { kind: "manual", id }, id)],
] as const) {
  it(`${name}: keeps the deadline after headers and aborts a stalled body`, async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signal = init.signal;
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        signal.addEventListener("abort", () => controller.error(new Error("aborted")));
      } }), { headers }));
    }));
    const result = await download();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = result.data.body.getReader().read();
    const rejected = expect(read).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(21);
    expect(signal.aborted).toBe(true);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });
  it(`${name}: errors even when the upstream ignores abort`, async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers })));
    const result = await download();
    if (!result.ok) throw new Error("download failed");
    const rejected = expect(result.data.body.getReader().read()).rejects.toThrow("Download timed out");
    await vi.advanceTimersByTimeAsync(21);
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["cancel", "error"])(`${name}: clears the deadline on %s`, async outcome => {
    vi.useFakeTimers();
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; }, cancel }), { headers })));
    const result = await download();
    if (!result.ok) throw new Error("download failed");
    const reader = result.data.body.getReader();
    if (outcome === "cancel") { await reader.cancel("closed"); expect(cancel).toHaveBeenCalledWith("closed"); }
    else {
      const rejected = expect(reader.read()).rejects.toThrow("broken body");
      upstream.error(new Error("broken body"));
      await rejected;
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it(`${name}: clears the deadline on completion`, async () => {
    vi.useFakeTimers();
    let signal!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signal = init.signal;
      return Promise.resolve(new Response("pdf", { headers }));
    }));
    const result = await download();
    if (!result.ok) throw new Error("download failed");
    expect(await new Response(result.data.body).text()).toBe("pdf");
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(21);
    expect(signal.aborted).toBe(false);
  });
}
