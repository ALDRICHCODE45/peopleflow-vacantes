import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkHeroVideo, uploadHeroVideo } from "./video-upload";

const MB = 1024 * 1024;
const mp4 = (size = 1024, name = "fondo.mp4", type = "video/mp4") => {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
};
type VideoStub = { duration: number; onloadedmetadata: (() => void) | null; onerror: (() => void) | null; src: string; removeAttribute: (name: string) => void; load: () => void; preload: string; muted: boolean };
let metadata: "load" | "error" | "never" = "load";
let duration = 12;
const videos: VideoStub[] = [];
const createElement = document.createElement.bind(document);
beforeEach(() => {
  metadata = "load"; duration = 12; videos.length = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:video"), revokeObjectURL: vi.fn() }));
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "video") return createElement(tag);
    const video: VideoStub = {
      duration: NaN, onloadedmetadata: null, onerror: null, preload: "", muted: false, removeAttribute: vi.fn(), load: vi.fn(),
      set src(value: string) {
        if (!value) return;
        queueMicrotask(() => {
          if (metadata === "load") { video.duration = duration; video.onloadedmetadata?.(); }
          if (metadata === "error") video.onerror?.();
        });
      },
      get src() { return ""; },
    };
    videos.push(video);
    return video as unknown as HTMLElement;
  }) as typeof document.createElement);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("checkHeroVideo (client pre-checks before any upload)", () => {
  it("accepts an MP4 up to 20 MB and 30 seconds, reading only its metadata", async () => {
    duration = 30;
    expect(await checkHeroVideo(mp4(20 * MB))).toBeNull();
    expect(videos[0].preload).toBe("metadata");
    expect(videos[0].muted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
  });
  it("accepts a .mp4 file the browser didn't type", async () => {
    expect(await checkHeroVideo(mp4(MB, "fondo.MP4", ""))).toBeNull();
  });
  it.each([
    ["a MOV", mp4(MB, "fondo.mov", "video/quicktime")],
    ["a WebM", mp4(MB, "fondo.webm", "video/webm")],
    ["an image named .mp4", mp4(MB, "foto.mp4", "image/png")],
    ["an untyped file without .mp4", mp4(MB, "fondo", "")],
  ])("rejects %s with «Sube un video MP4.»", async (_label, file) => {
    expect(await checkHeroVideo(file)).toBe("Sube un video MP4.");
    expect(videos).toHaveLength(0);
  });
  it("rejects an empty (0-byte) file with «Sube un video MP4.» before reading it", async () => {
    expect(await checkHeroVideo(mp4(0))).toBe("Sube un video MP4.");
    expect(await checkHeroVideo(mp4(0, "fondo.mp4", ""))).toBe("Sube un video MP4.");
    expect(videos).toHaveLength(0);
  });
  it("rejects more than 20 MB before reading it", async () => {
    expect(await checkHeroVideo(mp4(20 * MB + 1))).toBe("El video pesa más de 20 MB.");
    expect(videos).toHaveLength(0);
  });
  it("rejects more than 30 seconds", async () => {
    duration = 30.5;
    expect(await checkHeroVideo(mp4())).toBe("El video dura más de 30 segundos.");
  });
  it.each([["an error", "error"], ["an unknown duration", "load"]] as const)("reports an unreadable video on %s", async (_label, mode) => {
    metadata = mode; duration = mode === "load" ? Infinity : 0;
    expect(await checkHeroVideo(mp4())).toBe("No pudimos leer el video. Expórtalo como MP4 normal con \"inicio rápido\" (faststart).");
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it("gives up after the metadata timeout", async () => {
    vi.useFakeTimers();
    metadata = "never";
    const result = checkHeroVideo(mp4(), { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe("No pudimos leer el video. Expórtalo como MP4 normal con \"inicio rápido\" (faststart).");
    expect(videos[0].removeAttribute).toHaveBeenCalledWith("src");
  });
});

type Listener = (event: { loaded: number; total: number; lengthComputable: boolean }) => void;
class FakeXhr {
  static last: FakeXhr;
  static respond: (xhr: FakeXhr) => void = xhr => xhr.finish(201, created);
  method = ""; url = ""; headers: Record<string, string> = {}; body: unknown = null; status = 0; responseText = ""; timeout = 0;
  withCredentials = false; onload: (() => void) | null = null; onerror: (() => void) | null = null; ontimeout: (() => void) | null = null; onabort: (() => void) | null = null;
  upload = { onprogress: null as Listener | null };
  abort = vi.fn(() => this.onabort?.());
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name.toLowerCase()] = value; }
  send(body: unknown) { this.body = body; queueMicrotask(() => FakeXhr.respond(this)); }
  finish(status: number, value: unknown) { this.status = status; this.responseText = JSON.stringify(value); this.onload?.(); }
}
const id = "12345678-1234-4123-8123-123456789abc";
const created = { id, kind: "hero_video", url: `/v2/company-sites/media/${id}`, width: null, height: null, duration_ms: 12000, content_type: "video/mp4" };

describe("uploadHeroVideo", () => {
  beforeEach(() => { FakeXhr.respond = xhr => xhr.finish(201, created); vi.stubGlobal("XMLHttpRequest", FakeXhr); });
  it("streams the raw MP4 to the same-origin route and reports real progress", async () => {
    const progress = vi.fn();
    FakeXhr.respond = xhr => { xhr.upload.onprogress?.({ loaded: 50, total: 100, lengthComputable: true }); xhr.finish(201, created); };
    const file = mp4(100);
    expect(await uploadHeroVideo(file, { onProgress: progress })).toEqual({ ok: true, data: created });
    expect(FakeXhr.last.method).toBe("POST");
    expect(FakeXhr.last.url).toBe("/api/company/site/media?kind=hero_video");
    expect(FakeXhr.last.headers["content-type"]).toBe("video/mp4");
    expect(FakeXhr.last.body).toBe(file);
    expect(progress).toHaveBeenCalledWith(0.5);
  });
  it("gives the upload at least 180 s (the backend's own read/write deadline is 2 min)", async () => {
    await uploadHeroVideo(mp4(), {});
    expect(FakeXhr.last.timeout).toBeGreaterThanOrEqual(180_000);
  });
  it.each([
    [415, "unsupported_media_type", "Sube un video MP4."],
    [413, "payload_too_large", "El video pesa más de 20 MB."],
    [422, "video_too_long", "El video dura más de 30 segundos."],
    [422, "some_new_code", "El video dura más de 30 segundos."],
    [422, "video_invalid", "No pudimos leer el video. Expórtalo como MP4 normal con \"inicio rápido\" (faststart)."],
    [422, "media_limit_reached", "Alcanzaste el límite de 300 imágenes."],
    [401, "unauthenticated", "Inicia sesión para subir imágenes."],
  ])("maps a backend %s %s to «%s»", async (status, code, message) => {
    FakeXhr.respond = xhr => xhr.finish(status, { error: code, code });
    expect(await uploadHeroVideo(mp4(), {})).toEqual({ ok: false, message });
  });
  it("a network error, a malformed success or another kind is uncertain", async () => {
    const uncertain = { ok: false, message: "No pudimos confirmar la subida. Revisa tu conexión e inténtalo de nuevo." };
    FakeXhr.respond = xhr => xhr.onerror?.();
    expect(await uploadHeroVideo(mp4(), {})).toEqual(uncertain);
    FakeXhr.respond = xhr => xhr.finish(201, { ...created, kind: "cover" });
    expect(await uploadHeroVideo(mp4(), {})).toEqual(uncertain);
    FakeXhr.respond = xhr => { xhr.status = 201; xhr.responseText = "<html>"; xhr.onload?.(); };
    expect(await uploadHeroVideo(mp4(), {})).toEqual(uncertain);
  });
  it("can be aborted", async () => {
    const controller = new AbortController();
    FakeXhr.respond = () => controller.abort();
    expect(await uploadHeroVideo(mp4(), { signal: controller.signal })).toEqual({ ok: false, message: null });
    expect(FakeXhr.last.abort).toHaveBeenCalled();
  });
});
