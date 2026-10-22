import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 20 } }));
import { downloadParticipationCv } from "./file-client";
import { participationCvHref } from "./cv-href";
import { id } from "./test-fixtures";
afterEach(() => vi.unstubAllGlobals());
it("builds same-origin current/original links with encoded path segments", () => {
  expect(participationCvHref("vac/ancy", "person?#")).toBe("/api/company/vacancies/vac%2Fancy/participations/person%3F%23/cv");
  expect(participationCvHref(id(1), id(2), "original")).toBe(`/api/company/vacancies/${id(1)}/participations/${id(2)}/cv/original`);
});
it.each(["current", "original"] as const)("downloads %s through the configured origin with server-only Bearer", async version => {
  const fetch = vi.fn().mockResolvedValue(new Response("%PDF-original", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Ana.pdf"' } }));
  vi.stubGlobal("fetch", fetch);
  const result = await downloadParticipationCv(" token ", id(1), id(2), version);
  expect(result.ok).toBe(true);
  if (result.ok) expect(await new Response(result.data.body).text()).toBe("%PDF-original");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(String(url)).toBe(`http://localhost:8080/v2/me/company/job-drafts/${id(1)}/participations/${id(2)}/cv${version === "original" ? "/original" : ""}`);
  expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  expect(Object.fromEntries(new Headers(init.headers))).toEqual({ authorization: "Bearer token" });
});
it("guards original download ids before transport", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await downloadParticipationCv("token", "bad", id(2), "original")).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(await downloadParticipationCv("token", id(1), "bad", "original")).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(fetch).not.toHaveBeenCalled();
});
it("returns the safe original-not-found envelope without retrying", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "not_found", code: "not_found" }, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  expect(await downloadParticipationCv("token", id(1), id(2), "original")).toMatchObject({ ok: false, error: { kind: "status", status: 404 }, envelope: { code: "not_found" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
