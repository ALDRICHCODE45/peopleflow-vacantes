import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 50 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadOrgCandidateDetailAction } from "./detail-actions";
import { downloadOrgCandidateCv } from "./file-client";
import { detailFixture, id } from "./test-fixtures";
beforeEach(() => { vi.mocked(getActionAccessToken).mockResolvedValue("private-token"); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each(["manual", "organic"] as const)("loads %s using authenticated, uncached transport", async kind => {
  const fetch = vi.fn().mockResolvedValue(Response.json(detailFixture(kind))); vi.stubGlobal("fetch", fetch);
  expect(await loadOrgCandidateDetailAction({ kind, id: id(1) })).toEqual({ ok: true, data: detailFixture(kind) });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8080/v2/me/company/candidates/${kind}/${id(1)}`);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  expect(new Headers(fetch.mock.calls[0][1].headers).get("authorization")).toBe("Bearer private-token");
});
it.each([[404, "not_found"], [500, "server_error"], [401, "unauthenticated"], [403, "forbidden"]] as const)("classifies HTTP %s without leaking bodies", async (status, reason) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private", code: "private" }, { status })));
  const result = await loadOrgCandidateDetailAction({ kind: "manual", id: id(1) });
  expect(result).toMatchObject({ ok: false, reason }); expect(JSON.stringify(result)).not.toMatch(/private/);
});
it("does not request without authentication or for invalid identity", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadOrgCandidateDetailAction({ kind: "manual", id: id(1) })).toMatchObject({ ok: false, reason: "unauthenticated" });
  vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
  expect(await loadOrgCandidateDetailAction({ kind: "manual", id: "../other" })).toMatchObject({ ok: false, reason: "not_found" });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects malformed success and lost reads, without retrying", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ secret: "private" })).mockRejectedValueOnce(new Error("private")); vi.stubGlobal("fetch", fetch);
  expect(await loadOrgCandidateDetailAction({ kind: "manual", id: id(1) })).toMatchObject({ ok: false, reason: "unrecognized_response" });
  expect(await loadOrgCandidateDetailAction({ kind: "manual", id: id(1) })).toMatchObject({ ok: false, reason: "no_response" });
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("streams the candidate-authorized participation CV, not the board-owner endpoint", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("pdf", { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="cv.pdf"' } })); vi.stubGlobal("fetch", fetch);
  const result = await downloadOrgCandidateCv("private-token", { kind: "organic", id: id(1) }, id(2));
  expect(result.ok).toBe(true);
  expect(fetch.mock.calls[0][0].toString()).toBe(`http://localhost:8080/v2/me/company/candidates/organic/${id(1)}/participations/${id(2)}/cv`);
  expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error", headers: { authorization: "Bearer private-token" } });
});
it("rejects malformed CV metadata and invalid paths", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("html", { headers: { "content-type": "text/html" } })); vi.stubGlobal("fetch", fetch);
  expect(await downloadOrgCandidateCv("token", { kind: "manual", id: id(1) }, id(2))).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  expect(await downloadOrgCandidateCv("token", { kind: "manual", id: "../other" }, id(2))).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
