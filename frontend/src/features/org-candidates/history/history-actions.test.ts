import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 50 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadOrgCandidateHistoryAction } from "./history-actions";
import { identity, page } from "./test-fixtures";
beforeEach(() => vi.mocked(getActionAccessToken).mockResolvedValue("private-token"));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each(["manual", "organic"] as const)("loads %s history with authenticated, uncached transport and an encoded cursor", async kind => {
  const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json(page))); vi.stubGlobal("fetch", fetch);
  expect(await loadOrgCandidateHistoryAction({ ...identity, kind })).toEqual({ ok: true, data: page });
  expect(await loadOrgCandidateHistoryAction({ ...identity, kind }, "opaque/+=?&limit=50")).toEqual({ ok: true, data: page });
  const first = new URL(fetch.mock.calls[0][0]);
  expect(first.pathname).toBe(`/v2/me/company/candidates/${kind}/${identity.id}/history`);
  expect(first.searchParams.get("limit")).toBe("20"); expect(first.searchParams.has("cursor")).toBe(false);
  const next = new URL(fetch.mock.calls[1][0]);
  expect(next.searchParams.get("cursor")).toBe("opaque/+=?&limit=50"); expect(next.searchParams.getAll("limit")).toEqual(["20"]);
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  expect(new Headers(fetch.mock.calls[0][1].headers).get("authorization")).toBe("Bearer private-token");
});
it.each([[404, "not_found"], [401, "unauthenticated"], [403, "forbidden"], [500, "server_error"]] as const)("classifies HTTP %s without exposing error bodies", async (status, reason) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private", code: "private" }, { status })));
  const result = await loadOrgCandidateHistoryAction(identity);
  expect(result).toEqual({ ok: false, reason, reference: { status } }); expect(JSON.stringify(result)).not.toMatch(/private/);
});
it("only forwards safe error codes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private", code: "internal_error" }, { status: 500 })));
  expect(await loadOrgCandidateHistoryAction(identity)).toEqual({ ok: false, reason: "server_error", reference: { status: 500, code: "internal_error" } });
});
it("does not request without a session or for an invalid identity/cursor", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  vi.mocked(getActionAccessToken).mockResolvedValue(null);
  expect(await loadOrgCandidateHistoryAction(identity)).toMatchObject({ ok: false, reason: "unauthenticated" });
  vi.mocked(getActionAccessToken).mockResolvedValue("private-token");
  expect(await loadOrgCandidateHistoryAction({ ...identity, id: "../other" })).toMatchObject({ ok: false, reason: "not_found" });
  expect(await loadOrgCandidateHistoryAction(identity, "")).toMatchObject({ ok: false, reason: "unrecognized_response" });
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects malformed and redaction-breaking responses, exact-status drift and network loss without retrying", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ secret: "private" }))
    .mockResolvedValueOnce(Response.json({ ...page, items: [{ ...page.items[0], changes: [{ field: "email", contact: true, from: "private" }] }] }))
    .mockResolvedValueOnce(Response.json(page, { status: 201 })).mockRejectedValueOnce(new Error("private"));
  vi.stubGlobal("fetch", fetch);
  for (let i = 0; i < 3; i++) expect(await loadOrgCandidateHistoryAction(identity)).toMatchObject({ ok: false, reason: "unrecognized_response" });
  expect(await loadOrgCandidateHistoryAction(identity)).toEqual({ ok: false, reason: "no_response", reference: {} });
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("classifies a read timeout without leaking session failures", async () => {
  vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("private"))))));
  expect(await loadOrgCandidateHistoryAction(identity)).toMatchObject({ ok: false, reason: "no_response" });
  vi.mocked(getActionAccessToken).mockRejectedValueOnce(new Error("private"));
  expect(await loadOrgCandidateHistoryAction(identity)).toEqual({ ok: false, reason: "no_response", reference: {} });
});
