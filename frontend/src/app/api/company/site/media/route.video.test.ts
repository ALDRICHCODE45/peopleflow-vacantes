// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/features/company-site/sections-v2", () => ({ SECTIONS_V2_ENABLED: true, TALENT_CTA_ENABLED: false }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn().mockResolvedValue("server-token") }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 50 } }));
import { POST } from "@/app/api/company/site/media/route";

const MB = 1024 * 1024;
const id = "12345678-1234-4123-8123-123456789abc";
const created = { id, kind: "hero_video", url: `/v2/company-sites/media/${id}`, width: null, height: null, duration_ms: 12000, content_type: "video/mp4" };
const url = "http://localhost/api/company/site/media?kind=hero_video";
const video = (body: BodyInit | ReadableStream<Uint8Array> = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), headers: Record<string, string> = {}, target = url) =>
  new Request(target, { method: "POST", body, headers: { "content-type": "video/mp4", ...headers }, duplex: "half" } as RequestInit);
const stream = (size: number, chunk = MB) => new ReadableStream<Uint8Array>({
  start(controller) { for (let sent = 0; sent < size; sent += chunk) controller.enqueue(new Uint8Array(Math.min(chunk, size - sent))); controller.close(); },
});
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async (request: Request) => { await request.arrayBuffer(); return Response.json(created, { status: 201 }); })); });
afterEach(() => vi.unstubAllGlobals());

it("streams a raw MP4 to the backend as multipart kind=hero_video + file", async () => {
  let sent: FormData | undefined;
  let streamed = false;
  vi.mocked(fetch).mockImplementation(async input => {
    const request = input as Request;
    streamed = request.body instanceof ReadableStream;
    sent = await request.formData();
    return Response.json(created, { status: 201 });
  });
  const response = await POST(video());
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(created);
  const backend = vi.mocked(fetch).mock.calls[0][0] as Request;
  expect(backend.url).toBe("http://localhost:8080/v2/me/company/site/media");
  expect(backend.headers.get("authorization")).toBe("Bearer server-token");
  expect(backend.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
  expect(streamed).toBe(true);
  expect([...sent!.keys()]).toEqual(["kind", "file"]);
  expect(sent!.get("kind")).toBe("hero_video");
  const file = sent!.get("file") as File;
  expect(file.type).toBe("video/mp4");
  expect(file.name).toBe("video.mp4");
  expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0, 0, 0, 24, 102, 116, 121, 112]);
});
it("lets exactly 20 MB through", async () => {
  expect((await POST(video(stream(20 * MB), { "content-length": String(20 * MB) }))).status).toBe(201);
});
it("rejects a declared body over 20 MB before reading or calling the backend", async () => {
  expect((await POST(video(stream(10), { "content-length": String(20 * MB + 1) }))).status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
it("counts the actual streamed bytes: over 20 MB is 413 even without content-length", async () => {
  const response = await POST(video(stream(20 * MB + 1)));
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({ code: "payload_too_large" });
});
it.each(["video/quicktime", "video/webm", "image/png", "application/octet-stream"])("refuses %s with 415 before the backend", async type => {
  expect((await POST(video(undefined, { "content-type": type }))).status).toBe(415);
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses a cross-site request and an empty body", async () => {
  expect((await POST(video(undefined, { origin: "https://evil.example" }))).status).toBe(403);
  expect((await POST(video(new Uint8Array(0), { "content-length": "0" }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("a multipart hero_video (the image path) is not accepted", async () => {
  const form = new FormData(); form.append("kind", "hero_video"); form.append("file", new File(["x"], "v.mp4", { type: "video/mp4" }));
  expect((await POST(new Request("http://localhost/api/company/site/media", { method: "POST", body: form }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  [422, "video_too_long", "video_too_long"], [422, "video_invalid", "video_invalid"], [422, "some_new_code", "video_too_long"],
  [415, "unsupported_media_type", "unsupported_media_type"], [413, "payload_too_large", "payload_too_large"], [422, "media_limit_reached", "media_limit_reached"],
])("passes a backend %s %s through as %s", async (status, code, expected) => {
  vi.mocked(fetch).mockImplementation(async input => { await (input as Request).arrayBuffer(); return Response.json({ error: code, code }, { status }); });
  const response = await POST(video());
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ code: expected });
});
