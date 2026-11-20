import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { boardSchema, errorEnvelopeSchema, moveSchema, processFinishedSchema } from "./model";
import { movementFailure } from "./failure";
import { board, id, lifecycle, moved } from "./test-fixtures";

const added = { visibility: "public", kind: "original", sequence: null, replacement_of: null, root_process_id: id(40), closed_covered: true, can_start_replacement: true, start_replacement_blocker: null, startable_credits_count: 1, active_replacement_id: null };
const finished = { ...lifecycle, publication: "closed" as const, process: "finished" as const };

describe("replacement keys in the movement schemas", () => {
  it("parses the board lifecycle with and without the new keys", () => {
    expect(boardSchema.parse(board)).toEqual(board);
    const withKeys = { ...board, lifecycle: { ...lifecycle, ...added } };
    expect(boardSchema.parse(withKeys)).toEqual(withKeys);
  });
  it("makes the discard lifecycle optional and strict", () => {
    expect(moveSchema.parse(moved)).toEqual(moved);
    const withLifecycle = { ...moved, lifecycle: { ...finished, ...added } };
    expect(moveSchema.parse(withLifecycle)).toEqual(withLifecycle);
    expect(moveSchema.safeParse({ ...moved, lifecycle: { ...finished, extra: 1 } }).success).toBe(false);
    expect(moveSchema.safeParse({ ...moved, lifecycle: null }).success).toBe(false);
  });
  it("parses process_finished data with the new keys", () => {
    const body = { error: "x", code: "process_finished", data: { lifecycle: { ...finished, ...added } } };
    expect(processFinishedSchema.parse(body)).toEqual(body);
  });
});

const old = finished;
const lifecycleCarrying = {
  replacement_source_not_closed: { lifecycle: old },
  replacement_source_not_latest: { latest_process_id: id(41), root_process_id: id(42), lifecycle: old },
  replacement_already_active: { process_id: id(41), root_process_id: id(42), lifecycle: old },
  reopen_requires_replacement: { action: "reopen", lifecycle: old },
  reopen_superseded: { successor_process_id: id(41), root_process_id: id(42), lifecycle: old },
} as const;
const unprocessable = {
  replacement_credits_invalid: { credits: [{ credit_id: id(43), reason: "already_replaced" }] },
  carried_candidate_invalid: { candidates: [{ index: 0, reason: "currently_placed" }] },
  carried_stage_invalid: { candidates: [{ index: 1, reason: "stage_is_placement" }] },
} as const;

describe("movement error decoder", () => {
  it.each([
    ...Object.entries(lifecycleCarrying).map(([code, data]) => [code, { error: "x", code, data }] as const),
    ...Object.entries(unprocessable).map(([code, data]) => [code, { error: "x", code, data }] as const),
  ])("decodes %s without falling into an invalid response", (_code, body) => {
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });
  it("decodes validation_error with fields[] and keeps the bare form", () => {
    const withFields = { error: "x", code: "validation_error", fields: [{ field: "target_quantity", code: "out_of_range" }] };
    expect(errorEnvelopeSchema.parse(withFields)).toEqual(withFields);
    expect(errorEnvelopeSchema.parse({ error: "x", code: "validation_error" })).toEqual({ error: "x", code: "validation_error" });
  });
  it("still rejects malformed data and unknown keys", () => {
    expect(errorEnvelopeSchema.safeParse({ error: "x", code: "reopen_superseded", data: { lifecycle: old } }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ error: "x", code: "replacement_credits_invalid", data: { credits: [{ credit_id: "bad", reason: "x" }] } }).success).toBe(false);
    expect(errorEnvelopeSchema.safeParse({ error: "x", code: "other", extra: 1 }).success).toBe(false);
  });
  it("maps a 400 validation_error with fields[] to validation_error, not unrecognized", () => {
    const envelope = errorEnvelopeSchema.parse({ error: "x", code: "validation_error", fields: [{ field: "reason", code: "required" }] });
    expect(movementFailure({ ok: false, error: { kind: "status", status: 400, retryable: false }, envelope }, true)).toEqual({ ok: false, reason: "validation_error", reference: { status: 400, code: "validation_error" } });
  });
});
