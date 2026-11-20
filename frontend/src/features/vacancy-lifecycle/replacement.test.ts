import { beforeEach, describe, expect, it, vi } from "vitest";
import { lifecycleSchema } from "./model";
import { transitionLifecycleAction } from "./actions";
import { decodeLifecycleError } from "./client";
import { replacementErrorEnvelopeSchema, validationErrorEnvelopeSchema } from "./replacement-errors";
import { publicationErrorEnvelopeSchema } from "@/features/jobs/drafts/pipeline/failure";

vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "https://api.example.test", apiTimeoutMs: 1000 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn(async () => "token") }));
vi.mock("server-only", () => ({}));
const id = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const key = "22222222-2222-4222-8222-222222222222";
const etag = `"vl-${id}-v4"`;
const old = { close_reason: null, close_reason_note: null, publication: "closed", process: "finished", version: "4", published_at: null, paused_at: null, closed_at: null, process_finished_at: null, allowed_actions: ["finish_process"] };
const added = { visibility: "public", kind: "original", sequence: null, replacement_of: null, root_process_id: id, closed_covered: true, can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1, active_replacement_id: null };
const input = { draftId: id, ifMatch: etag, idempotencyKey: key, action: "reopen", body: {} } as const;
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
const respond = (data: unknown, status: number) => fetchMock.mockImplementation(async () => new Response(JSON.stringify(data), { status, headers: { etag, "idempotency-replayed": "false" } }));

describe("lifecycle view, replacement keys (deployment step 1)", () => {
  it("parses the old payload without the new keys", () => { expect(lifecycleSchema.parse(old)).toEqual(old); });
  it.each([
    added,
    { ...added, kind: "replacement", sequence: 2, replacement_of: other, visibility: "private", closed_covered: false, can_start_replacement: false, start_replacement_blocker: "replacement_active", startable_credits_count: 0, active_replacement_id: id },
    { ...added, visibility: null },
    ...(["source_not_closed", "not_latest", "replacement_active", "no_startable_credits"] as const).map(start_replacement_blocker => ({ ...added, start_replacement_blocker })),
  ])("parses the payload with the new keys %#", extra => { expect(lifecycleSchema.parse({ ...old, ...extra })).toEqual({ ...old, ...extra }); });
  it.each([{ kind: "clone" }, { visibility: "hidden" }, { sequence: 0 }, { sequence: "1" }, { replacement_of: "bad" }, { root_process_id: null }, { closed_covered: "yes" }, { start_replacement_blocker: "other" }, { startable_credits_count: -1 }, { active_replacement_id: 3 }, { extra: true }])("still rejects bad new values %j", patch => {
    expect(lifecycleSchema.safeParse({ ...old, ...added, ...patch }).success).toBe(false);
  });
});

const lifecycleCarrying = {
  replacement_source_not_closed: { lifecycle: old },
  replacement_source_not_latest: { latest_process_id: other, root_process_id: other, lifecycle: old },
  replacement_already_active: { process_id: other, root_process_id: other, lifecycle: old },
  reopen_requires_replacement: { action: "reopen", lifecycle: old },
  reopen_superseded: { successor_process_id: other, root_process_id: other, lifecycle: old },
} as const;
const unprocessable = {
  replacement_credits_invalid: { credits: [{ credit_id: other, reason: "not_in_chain" }, { credit_id: id, reason: "already_replaced" }, { credit_id: key, reason: "not_did_not_hold" }] },
  carried_candidate_invalid: { candidates: [{ index: 0, reason: "not_in_chain" }, { index: 1, reason: "currently_placed" }, { index: 2, reason: "duplicate" }] },
  carried_stage_invalid: { candidates: [{ index: 0, reason: "stage_not_found" }, { index: 1, reason: "stage_is_placement" }, { index: 2, reason: "stage_is_exit" }] },
} as const;
const envelopes = [
  ...Object.entries(lifecycleCarrying).map(([code, data]) => [code, 409, { error: "private", code, data }] as const),
  ...Object.entries(unprocessable).map(([code, data]) => [code, 422, { error: "private", code, data }] as const),
];

describe("replacement error envelopes", () => {
  it.each(envelopes)("decodes %s through the lifecycle decoder", (code, _status, body) => {
    expect(decodeLifecycleError(body)).toEqual(body);
    expect(replacementErrorEnvelopeSchema.parse(body)).toMatchObject({ code });
    expect(publicationErrorEnvelopeSchema.parse(body)).toMatchObject({ code });
  });
  it.each(envelopes)("still rejects %s with a malformed data", (code, _status, body) => {
    expect(() => decodeLifecycleError({ ...body, data: { ...body.data, lifecycle: undefined, credits: [{}], candidates: [{ index: -1 }] } })).toThrow();
    expect(replacementErrorEnvelopeSchema.safeParse({ ...body, data: undefined }).success).toBe(false);
  });
  it("rejects the lifecycle 409s without their ids or action", () => {
    expect(() => decodeLifecycleError({ error: "x", code: "replacement_already_active", data: { lifecycle: old } })).toThrow();
    expect(() => decodeLifecycleError({ error: "x", code: "reopen_requires_replacement", data: { lifecycle: old } })).toThrow();
    expect(() => decodeLifecycleError({ error: "x", code: "reopen_superseded", data: { lifecycle: old } })).toThrow();
  });
  it.each([
    [{ error: "x", code: "validation_error", fields: [{ field: "target_quantity", code: "below_credits_count" }, { field: "commitment_date", code: "out_of_range" }] }],
    [{ error: "x", code: "validation_error" }],
  ])("decodes validation_error with or without fields[] %#", body => {
    expect(decodeLifecycleError(body)).toEqual(body);
    expect(publicationErrorEnvelopeSchema.parse(body)).toEqual(body);
  });
  it("rejects malformed validation fields", () => {
    expect(validationErrorEnvelopeSchema.safeParse({ error: "x", code: "validation_error", fields: [{ field: "a" }] }).success).toBe(false);
    expect(() => decodeLifecycleError({ error: "x", code: "validation_error", fields: "bad" })).toThrow();
  });
});

describe("reopen guard copy", () => {
  it.each([
    ["reopen_requires_replacement", "Esta vacante se cerró cubierta. Para volver a buscar, inicia un reemplazo."],
    ["reopen_superseded", "Esta vacante ya tiene un reemplazo. Reabre o trabaja en el proceso más reciente."],
    ["replacement_already_active", "Ya hay un reemplazo activo para esta vacante."],
  ] as const)("maps %s to Spanish copy and refreshes from data.lifecycle", async (code, message) => {
    respond({ error: "private", code, data: lifecycleCarrying[code] }, 409);
    const result = await transitionLifecycleAction(input);
    expect(result).toEqual({ ok: false, reason: code, message, lifecycle: old, reference: { status: 409, code } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["replacement_source_not_closed", "replacement_source_not_latest"] as const)("keeps %s out of a reopen as a refreshable conflict", async code => {
    respond({ error: "private", code, data: lifecycleCarrying[code] }, 409);
    expect(await transitionLifecycleAction(input)).toMatchObject({ ok: false, reason: code, lifecycle: old, reference: { status: 409, code } });
  });
  it("does not trust a replacement code on the wrong status", async () => {
    respond({ error: "private", code: "reopen_requires_replacement", data: lifecycleCarrying.reopen_requires_replacement }, 422);
    expect(await transitionLifecycleAction(input)).toMatchObject({ ok: false, reason: "unrecognized_response" });
  });
  it("maps a validation_error with fields to invalid_request copy without the raw text", async () => {
    respond({ error: "private", code: "validation_error", fields: [{ field: "x", code: "invalid" }] }, 400);
    const result = await transitionLifecycleAction(input);
    expect(result).toMatchObject({ ok: false, reason: "invalid_request" });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
