// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { uploadMediaFile, uploadMediaStream } from "./file-client";
import { mediaMessage } from "../media";

vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
afterEach(() => vi.unstubAllGlobals());

it("preserves the upload route's existing unauthenticated status/code and session copy", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private-token", code: "unauthenticated" }, { status: 401 })));
  const result = await uploadMediaFile("private-token", new FormData(), "cover");
  expect(result).toEqual({ ok: false, status: 401, code: "unauthenticated" });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(mediaMessage(401, result)).toBe("Inicia sesión para subir imágenes.");
  expect(fetch).toHaveBeenCalledOnce();
});

// Slice B: the backend's own read/write deadline for a hero video is 2 min, so the route must wait longer.
const hanging = () => vi.fn((request: Request) => new Promise<Response>((_resolve, reject) => {
  request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
}));
const videoStream = () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } });
it("waits at least 150 s for a streamed hero video before giving up", async () => {
  vi.useFakeTimers();
  try {
    const fetchMock = hanging(); vi.stubGlobal("fetch", fetchMock);
    let settled: unknown;
    const pending = uploadMediaStream("t", videoStream(), "multipart/form-data; boundary=x", "hero_video").then(value => { settled = value; return value; });
    await vi.advanceTimersByTimeAsync(149_999);
    expect(settled).toBeUndefined();
    expect((fetchMock.mock.calls[0][0] as Request).signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, status: 503, code: "no_response" });
  } finally { vi.useRealTimers(); }
});
it("an image upload keeps the short API timeout", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("fetch", hanging());
    const pending = uploadMediaFile("t", new FormData(), "cover");
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toEqual({ ok: false, status: 503, code: "no_response" });
  } finally { vi.useRealTimers(); }
});
