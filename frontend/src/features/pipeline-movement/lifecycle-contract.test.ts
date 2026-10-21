import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 1000 } }));
import { boardSchema } from "./model";
import { moveParticipation, discardParticipation, recoverParticipation, setParticipationSubstate } from "./client";
import { movementFailure } from "./failure";
import { board, id, item, lifecycle } from "./test-fixtures";
const finished = { ...lifecycle, publication: "closed" as const, process: "finished" as const, version: "2" };
afterEach(() => vi.unstubAllGlobals());
it("requires the strict root lifecycle view", () => {
  expect(boardSchema.safeParse(board).success).toBe(true);
  const { lifecycle: _, ...missing } = board;
  expect(boardSchema.safeParse(missing).success).toBe(false);
  for (const value of [null, { ...lifecycle, extra: true }, { ...lifecycle, process: "finished" }]) expect(boardSchema.safeParse({ ...board, lifecycle: value }).success).toBe(false);
});
it.each([
  [moveParticipation, { to_stage_id: id(2) }],
  [discardParticipation, { reason: { group: "recruiter", key: "profile_mismatch" } }],
  [recoverParticipation, {}],
  [setParticipationSubstate, { substate_id: null }],
] as const)("maps process_finished with fresh lifecycle for mutation %# without retry", async (call, body) => {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "finished", code: "process_finished", data: { lifecycle: finished } }), { status: 409 }));
  vi.stubGlobal("fetch", fetch);
  const result = await call({ token: "token", vacancyId: id(30), participationId: item.id, etag: item.etag, body });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(movementFailure(result, true)).toMatchObject({ reason: "process_finished", lifecycle: finished });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([{}, { lifecycle: null }, { lifecycle: { ...finished, extra: true } }])("rejects malformed conflict data %j", async data => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "finished", code: "process_finished", data }), { status: 409 })));
  const result = await recoverParticipation({ token: "token", vacancyId: id(30), participationId: item.id, etag: item.etag, body: {} });
  if (result.ok) throw new Error("Expected failure");
  expect(movementFailure(result, true)).toMatchObject({ reason: "unrecognized_response" });
});
