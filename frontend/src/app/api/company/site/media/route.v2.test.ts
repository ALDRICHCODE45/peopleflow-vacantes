// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/features/company-site/sections-v2", () => ({ SECTIONS_V2_ENABLED: true, TALENT_CTA_ENABLED: false }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn().mockResolvedValue("server-token") }));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 20 } }));
import { POST } from "@/app/api/company/site/media/route";
const id = "12345678-1234-4123-8123-123456789abc";
const logo = { id, kind: "logo", url: `/v2/company-sites/media/${id}`, width: 128, height: 64, content_type: "image/png" };
const form = (kind: string, type: string) => { const f = new FormData(); f.append("kind", kind); f.append("file", new File(["image"], "logo.png", { type })); return f; };
const request = (body: FormData) => new Request("http://localhost/api/company/site/media", { method: "POST", body });
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(logo, { status: 201 }))); });
afterEach(() => vi.unstubAllGlobals());

it.each(["image/png", "image/webp"])("accepts a %s logo with sections v2 on and forwards kind logo", async type => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ ...logo, content_type: type }, { status: 201 }));
  const response = await POST(request(form("logo", type)));
  expect(response.status).toBe(201);
  const backend = vi.mocked(fetch).mock.calls[0][0] as Request;
  expect((await backend.formData()).get("kind")).toBe("logo");
});
it("keeps logos transparent: a JPEG logo is refused before the backend", async () => {
  const response = await POST(request(form("logo", "image/jpeg")));
  expect(response.status).toBe(415);
  expect(fetch).not.toHaveBeenCalled();
});
it("still accepts JPEG photos for the other kinds", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ ...logo, kind: "portrait", content_type: "image/jpeg" }, { status: 201 }));
  expect((await POST(request(form("portrait", "image/jpeg")))).status).toBe(201);
});
