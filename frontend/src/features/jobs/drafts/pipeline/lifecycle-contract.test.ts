import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
import { getDraftPipeline, saveDraftPipeline, previewPipeline } from "./client";
import { saveDraftSubstates } from "./substates-client";
import { saveDraftDelivery } from "./delivery-client";
import { saveDraftManagement } from "./management-client";
import { mapDraftPipelineFailure } from "./failure";
import { draftReadEnvelopeV2Schema } from "../read-v2";
import { filledDraftRead } from "../reopen/test-fixture";
import { draftEditSeedFromRead } from "../reopen/seed";
import { activeLifecycle, finishedLifecycle } from "../lifecycle-fixture";
const id = "123e4567-e89b-42d3-a456-426614174000";
const input = { token: "test", draftId: id, ifMatch: '"tag"' };
const pipeline = { version: "0", structure_locked: false, stages: [], retired: [], exit: { id, kind: "discarded", name: "Descartados" }, limits: { maxCustomStages: 3, nameMaxLength: 40 } };
const body = { stages: [], exit: { id, name: "Descartados" } };
function respond(data: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status, headers: { etag: '"tag"' } }));
  vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => vi.unstubAllGlobals());
it("requires and preserves strict lifecycle on pipeline GET", async () => {
  respond({ ...pipeline, lifecycle: activeLifecycle });
  expect(await getDraftPipeline(input)).toMatchObject({ ok: true, data: { lifecycle: activeLifecycle } });
  for (const lifecycle of [undefined, null, { ...activeLifecycle, extra: true }]) {
    respond({ ...pipeline, lifecycle });
    expect(await getDraftPipeline(input)).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
  }
});
it("requires strict lifecycle in the shared v2 read and propagates it into the seed", () => {
  const read = { ...filledDraftRead(), lifecycle: finishedLifecycle };
  expect(draftReadEnvelopeV2Schema.safeParse(read).success).toBe(true);
  expect(draftEditSeedFromRead(draftReadEnvelopeV2Schema.parse(read))).toMatchObject({ lifecycle: finishedLifecycle });
  for (const lifecycle of [undefined, null, { ...activeLifecycle, extra: true }]) {
    expect(draftReadEnvelopeV2Schema.safeParse({ ...read, lifecycle }).success).toBe(false);
  }
});
it.each([
  ["pipeline", () => saveDraftPipeline({ ...input, body })],
  ["pipeline preview", () => previewPipeline({ ...input, body })],
  ["substates", () => saveDraftSubstates({ ...input, body: { substates: [] } })],
  ["delivery", () => saveDraftDelivery({ ...input, body: { cutoffStageId: null, targetQuantity: null, commitmentDate: null } })],
  ["management", () => saveDraftManagement({ ...input, body: { requestDate: null, hiringHeadcount: null } })],
] as const)("%s carries fresh lifecycle on 409 without retry", async (_, write) => {
  const envelope = { error: "private backend copy", code: "process_finished", data: { lifecycle: finishedLifecycle } };
  const fetch = respond(envelope, 409);
  const result = await write();
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(mapDraftPipelineFailure(result)).toEqual({ ok: false, reason: "process_finished", lifecycle: finishedLifecycle, reference: { status: 409, code: "process_finished" } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not trust malformed lifecycle or the wrong status", () => {
  for (const [status, data] of [[409, {}], [400, { lifecycle: finishedLifecycle }]] as const) {
    expect(mapDraftPipelineFailure({ ok: false, error: { kind: "http", retryable: false, status }, envelope: { error: "message", code: "process_finished", data } } as never).reason).toBe("unrecognized_response");
  }
});
