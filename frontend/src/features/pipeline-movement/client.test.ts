import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080/api/v1/", apiTimeoutMs: 20 } }));
import { getBoard, getParticipation, getHistory, moveParticipation } from "./client";
import { board, item, moved, detail, history, id } from "./test-fixtures";
const input = { token: " secret ", vacancyId: id(30) };
function respond(data: unknown, status = 200, headers = {}) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status, headers })); vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([
  ["board", board, () => getBoard(input)],
  [`participations/${item.id}`, detail, () => getParticipation({ ...input, participationId: item.id })],
  [`participations/${item.id}/history`, history, () => getHistory({ ...input, participationId: item.id })],
] as const)("reads strict %s with server Bearer, no-store and no redirects", async (path, data, call) => {
  const fetch = respond(data); expect(await call()).toEqual({ ok: true, data });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`http://localhost:8080/v2/me/company/job-drafts/${input.vacancyId}/${path}`);
  expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: "application/json", authorization: "Bearer secret" });
});
it("moves exactly once using the item's opaque ETag unchanged, never the display version", async () => {
  const fetch = respond(moved, 200, { etag: moved.etag, "set-cookie": "private" });
  expect(await moveParticipation({ ...input, participationId: item.id, etag: item.etag, body: { to_stage_id: id(2), confirm_placement_exit: true } })).toEqual({ ok: true, data: moved });
  expect(fetch).toHaveBeenCalledTimes(1); const [url, init] = fetch.mock.calls[0];
  expect(url).toBe(`http://localhost:8080/v2/me/company/job-drafts/${input.vacancyId}/participations/${item.id}/moves`);
  expect(init.method).toBe("POST"); expect(new Headers(init.headers).get("if-match")).toBe(item.etag);
  expect(init.body).toBe(JSON.stringify({ to_stage_id: id(2), confirm_placement_exit: true }));
});
it("omits the optional confirmation and accepts the new item ETag without a header", async () => {
  const fetch = respond(moved); expect(await moveParticipation({ ...input, participationId: item.id, etag: item.etag, body: { to_stage_id: id(2) } })).toEqual({ ok: true, data: moved });
  expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify({ to_stage_id: id(2) }));
});
it("rejects disagreeing response ETags rather than confirming an uncertain move", async () => {
  respond(moved, 200, { etag: '"different"' });
  expect(await moveParticipation({ ...input, participationId: item.id, etag: item.etag, body: { to_stage_id: id(2) } })).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } });
});
it.each([
  { ...board, extra: true }, { ...board, stages: [{ ...board.stages[0], kind: "discarded" }] },
  { ...board, exit: { ...board.exit, kind: "custom" } }, { ...board, coverage: { ...board.coverage, covered: -1 } },
  ...[{ ...item, source: "recruiter" }, { ...item, etag: 'W/"weak"' }, { ...item, version: "01" }, { ...item, candidate: { ...item.candidate, email: "private" } }].map(value => ({ ...board, participations: [value] })),
])("rejects malformed or widened board contract %#", async data => {
  respond(data); expect(await getBoard(input)).toMatchObject({ ok: false, error: { kind: "invalid_response", retryable: false } });
});
it.each([
  { ...detail, screening: [{ ...detail.screening[0], score: 1 }] },
  { ...detail, screening: [{ ...detail.screening[0], type: "unknown" }] },
  { ...detail, screening: [{ ...detail.screening[0], answer: { option_id: id(22), label: "Sí" } }] },
])("rejects scores and mismatched screening answers %#", async data => {
  respond(data); expect(await getParticipation({ ...input, participationId: item.id })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([null, { kind: "system", id: id(11), full_name: "System" }, { id: id(11), full_name: "Ana" }])("requires the closed nonnull history actor %#", async actor => {
  respond({ items: [{ ...history.items[0], actor }] }); expect(await getHistory({ ...input, participationId: item.id })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([400, 404, 409, 412, 428, 500])("does not retry HTTP %s moves", async status => {
  const fetch = respond({ error: "unsafe", code: "invalid_request" }, status);
  expect(await moveParticipation({ ...input, participationId: item.id, etag: item.etag, body: { to_stage_id: id(2) } })).toMatchObject({ ok: false, error: { status, retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1);
});
it("never retries a lost move response", async () => {
  const fetch = vi.fn().mockRejectedValue(new Error("private")); vi.stubGlobal("fetch", fetch);
  expect(await moveParticipation({ ...input, participationId: item.id, etag: item.etag, body: { to_stage_id: id(2) } })).toEqual({ ok: false, error: { kind: "network", retryable: false } }); expect(fetch).toHaveBeenCalledTimes(1);
});
it("guards ids and exact move body before transport", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await getBoard({ ...input, vacancyId: "bad" })).toMatchObject({ ok: false });
  expect(await getHistory({ ...input, participationId: "bad" })).toMatchObject({ ok: false });
  expect(await moveParticipation({ ...input, participationId: item.id, etag: item.etag, body: { to_stage_id: id(2), version: "1" } })).toMatchObject({ ok: false });
  expect(fetch).not.toHaveBeenCalled();
});
