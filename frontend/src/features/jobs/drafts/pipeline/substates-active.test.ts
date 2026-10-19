import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 20 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: async () => "server-token" }));
import { getDraftSubstates } from "./substates-client";
import { saveDraftSubstatesAction } from "./substates-actions";
const id = "123e4567-e89b-42d3-a456-000000000001";
afterEach(() => vi.unstubAllGlobals());
it("catalog requires boolean in_use with exact keys", async () => {
  for (const in_use of [true, false, undefined, "true"]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ version: "1", substates: [{ id, name: "Técnica", in_use }], limits: { maxSubstates: 50, nameMaxLength: 40 }, suggestions: [] }, { headers: { etag: '"catalog"' } })));
    expect((await getDraftSubstates({ token: "server", draftId: id })).ok).toBe(typeof in_use === "boolean");
  }
});
it("409 carries only exact ordered substate ids across the action, never raw errors", async () => {
  const details = [{ substate_id: id }];
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "private", code: "substate_in_use", details }, { status: 409 })); vi.stubGlobal("fetch", fetch);
  expect(await saveDraftSubstatesAction({ draftId: id, ifMatch: '"catalog"', body: { substates: [] } })).toEqual({ ok: false, reason: "substate_in_use", details, reference: { status: 409, code: "substate_in_use" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([undefined, [{ substate_id: "bad" }], [{ substate_id: id, extra: true }], [{ id }]])("rejects malformed 409 details %#", async details => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private", code: "substate_in_use", details }, { status: 409 })));
  expect(await saveDraftSubstatesAction({ draftId: id, ifMatch: '"catalog"', body: { substates: [] } })).toMatchObject({ ok: false, reason: "unrecognized_response" });
});
