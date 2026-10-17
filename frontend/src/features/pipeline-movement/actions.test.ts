import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 20 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn() }));
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadBoardAction, loadParticipationAction, loadHistoryAction, moveParticipationAction } from "./actions";
import { board, item, moved, detail, history, id } from "./test-fixtures";
const vacancyId = id(30);
const move = () => moveParticipationAction({ vacancyId, participationId: item.id, etag: item.etag, body: { to_stage_id: id(2) } });
beforeEach(() => { vi.mocked(getActionAccessToken).mockResolvedValue("private-token"); });
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
it.each([[board, () => loadBoardAction(vacancyId)], [detail, () => loadParticipationAction(vacancyId, item.id)], [history, () => loadHistoryAction(vacancyId, item.id)], [moved, move]] as const)("actions return only safe decoded data %#", async (data, call) => {
  const fetch = vi.fn().mockResolvedValue(Response.json(data, { headers: { "set-cookie": "private" } })); vi.stubGlobal("fetch", fetch);
  const result = await call(); expect(result).toEqual({ ok: true, data }); expect(JSON.stringify(result)).not.toMatch(/private/);
});
it.each([
  [422, "board_too_large"], [409, "vacancy_not_published"], [404, "not_found"], [409, "stage_skip_not_allowed"],
  [409, "placement_exit_confirmation_required"], [400, "validation_error"], [400, "invalid_request"], [412, "version_conflict"],
  [428, "precondition_required"], [503, "cv_storage_unavailable"], [401, "unauthenticated"], [403, "forbidden"],
] as const)("maps %s %s without forwarding error messages or retrying", async (status, reason) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "private-token cookies", code: reason }, { status })); vi.stubGlobal("fetch", fetch);
  expect(await move()).toEqual({ ok: false, reason, reference: { status, code: reason } }); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([[400, "stage_skip_not_allowed", "unrecognized_response"], [409, "private-token", "unrecognized_response"], [500, "internal_error", "uncertain"]] as const)("classifies %s %s conservatively", async (status, code, reason) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private", code }, { status })));
  const result = await move(); expect(result).toMatchObject({ ok: false, reason }); expect(JSON.stringify(result)).not.toMatch(/private/);
});
it("marks lost writes uncertain, lost reads no_response, without automatic retries", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("private")); vi.stubGlobal("fetch", fetch);
  expect(await move()).toEqual({ ok: false, reason: "uncertain", reference: {} });
  expect(await loadBoardAction(vacancyId)).toEqual({ ok: false, reason: "no_response", reference: {} }); expect(fetch).toHaveBeenCalledTimes(2);
});
it("returns unrecognized_response for malformed success and never retries", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ secret: "private" })); vi.stubGlobal("fetch", fetch);
  expect(await move()).toEqual({ ok: false, reason: "unrecognized_response", reference: {} }); expect(fetch).toHaveBeenCalledTimes(1);
});
it("never sends a request without a server session", async () => {
  vi.mocked(getActionAccessToken).mockResolvedValue(" "); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await move()).toEqual({ ok: false, reason: "unauthenticated", reference: {} }); expect(fetch).not.toHaveBeenCalled();
});
