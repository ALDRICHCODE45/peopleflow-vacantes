import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 20 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: async () => "server-token" }));
import { boardSchema, detailSchema, historySchema } from "./model";
import { setParticipationSubstateAction } from "./actions";
import { board, detail, history, id, item } from "./test-fixtures";
const active = { ...item, stage_id: id(4), substate_id: id(40) };
const catalog = [{ id: id(40), name: "Nombre actual" }];
const event = { kind: "substate", from_substate_id: null, from_substate_name: null, to_substate_id: id(40), to_substate_name: "Nombre histórico", actor: history.items[0].actor, at: item.applied_at };
afterEach(() => vi.unstubAllGlobals());
it("requires item/detail substate_id and ordered board substates with exact keys", () => {
  const data = { ...board, substates: catalog, participations: [active] };
  expect(boardSchema.safeParse(data).success).toBe(true);
  expect(detailSchema.safeParse({ ...detail, substate_id: null }).success).toBe(true);
  expect(boardSchema.safeParse({ ...data, substates: [{ ...catalog[0], extra: true }] }).success).toBe(false);
  const { substate_id: _omitted, ...missing } = active; void _omitted;
  expect(boardSchema.safeParse({ ...data, participations: [missing] }).success).toBe(false);
  expect(detailSchema.safeParse({ ...detail, substate_id: undefined }).success).toBe(false);
  expect(boardSchema.safeParse({ ...data, participations: [{ ...active, stage_id: id(1) }] }).success).toBe(false);
});
it("decodes exact substate history with name snapshots, not today's catalog", () => {
  expect(historySchema.parse({ items: [event] }).items[0]).toEqual(event);
  for (const invalid of [{ ...event, to_substate_name: undefined }, { ...event, hire: false }, { ...event, from_substate_name: "unexpected" }, { ...event, to_substate_name: null }]) {
    expect(historySchema.safeParse({ items: [invalid] }).success).toBe(false);
  }
});
it.each([id(40), null])("set/clear %s sends exact body and unchanged If-Match, accepting no-op 200", async substate_id => {
  const data = { ...active, substate_id, coverage: board.coverage, delivery: board.delivery };
  const fetch = vi.fn().mockResolvedValue(Response.json(data, { headers: { etag: active.etag } })); vi.stubGlobal("fetch", fetch);
  expect(await setParticipationSubstateAction({ vacancyId: id(30), participationId: item.id, etag: item.etag, body: { substate_id } })).toEqual({ ok: true, data });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url.endsWith(`/participations/${item.id}/substate`)).toBe(true);
  expect(init.method).toBe("POST"); expect(new Headers(init.headers).get("if-match")).toBe(item.etag);
  expect(init.body).toBe(JSON.stringify({ substate_id }));
});
it.each([[409, "substate_requires_in_process"], [400, "validation_error"]] as const)("maps %s %s safely", async (status, reason) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "private", code: reason }, { status })); vi.stubGlobal("fetch", fetch);
  expect(await setParticipationSubstateAction({ vacancyId: id(30), participationId: item.id, etag: item.etag, body: { substate_id: null } })).toEqual({ ok: false, reason, reference: { status, code: reason } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("guards additional body keys and missing substate before transport", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  for (const body of [{}, { substate_id: null, extra: true }, { substate_id: "bad" }]) expect(await setParticipationSubstateAction({ vacancyId: id(30), participationId: item.id, etag: item.etag, body })).toMatchObject({ ok: false, reason: "invalid_request" });
  expect(fetch).not.toHaveBeenCalled();
});
