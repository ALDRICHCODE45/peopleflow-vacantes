import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
import { getDraftPipeline, saveDraftPipeline, previewPipeline } from "./client";
import { mapDraftPipelineFailure } from "./failure";
const id = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const stage = { id, kind: "custom", name: "Prueba" };
const entry = { participation_id: id, candidate: { id, full_name: "Ana" }, stage_id: id };
const impact = { not_applicable: [entry], recovery_reassigned: [{ participation_id: id, candidate: entry.candidate, retired_stage_id: id, default_stage_id: id }] };
const preview = { stages: [stage], ...impact, has_impact: true };
const pipeline = { version: "1", structure_locked: true, stages: [stage], retired: [stage], exit: { id, kind: "discarded", name: "Descartados" }, limits: { maxCustomStages: 3, nameMaxLength: 40 } };
const body = { stages: [{ id, name: "Prueba" }], exit: { id, name: "Descartados" } };
function respond(data: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status, headers: { etag: '"v1"' } }));
  vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => vi.unstubAllGlobals());
it("strictly reads retired and requires applied impact only on PUT", async () => {
  respond(pipeline); expect(await getDraftPipeline({ token: "x", draftId: id })).toMatchObject({ ok: true, data: pipeline });
  respond({ ...pipeline, applied_impact: impact });
  const fetch = globalThis.fetch;
  expect(await saveDraftPipeline({ token: "x", draftId: id, ifMatch: '"v0"', body: { ...body, confirm_impact: true } })).toMatchObject({ ok: true, data: { applied_impact: impact } });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ confirm_impact: true });
  respond(pipeline); expect(await saveDraftPipeline({ token: "x", draftId: id, ifMatch: '"v0"', body })).toMatchObject({ ok: false });
});
it("previews once with POST and no If-Match", async () => {
  const fetch = respond(preview);
  expect(await previewPipeline({ token: "x", draftId: id, body })).toEqual({ ok: true, data: preview });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(`http://localhost:8080/v2/me/company/job-drafts/${id}/pipeline/preview`);
  expect(fetch.mock.calls[0][1].method).toBe("POST");
  expect(new Headers(fetch.mock.calls[0][1].headers).has("if-match")).toBe(false);
});
it.each([
  { ...preview, extra: 1 }, { ...preview, stages: [{ ...stage, extra: 1 }] },
  { ...preview, not_applicable: [{ ...entry, extra: 1 }] },
  { ...preview, not_applicable: [{ ...entry, candidate: { ...entry.candidate, extra: 1 } }] },
  { ...preview, recovery_reassigned: [{ ...impact.recovery_reassigned[0], extra: 1 }] },
  { ...preview, has_impact: "true" }, { ...preview, stages: undefined },
])("rejects unknown or malformed preview keys %#", async data => {
  respond(data); expect(await previewPipeline({ token: "x", draftId: id, body })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([undefined, [{ ...stage, extra: 1 }], [{ ...stage, id: "bad" }]])("rejects malformed retired %#", async retired => {
  respond({ ...pipeline, retired }); expect(await getDraftPipeline({ token: "x", draftId: id })).toMatchObject({ ok: false });
});
it.each([
  { ...impact, extra: true }, { ...impact, not_applicable: [{ ...entry, extra: true }] },
  { ...impact, recovery_reassigned: [{ ...impact.recovery_reassigned[0], default_stage_id: "bad" }] },
  { ...impact, recovery_reassigned: [{ ...impact.recovery_reassigned[0], extra: true }] },
])("rejects malformed applied impact %#", async applied_impact => {
  respond({ ...pipeline, applied_impact });
  expect(await saveDraftPipeline({ token: "x", draftId: id, ifMatch: '"v0"', body })).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
it.each([undefined, [{ stage_id: "bad" }], [{ stage_id: id, extra: true }]])("rejects malformed occupied details %#", async details => {
  respond({ error: "private", code: "stage_occupied", details }, 409);
  expect(await previewPipeline({ token: "x", draftId: id, body })).not.toHaveProperty("envelope");
});
it("rejects preview confirm_impact before any request", async () => {
  const fetch = respond(preview);
  expect(await previewPipeline({ token: "x", draftId: id, body: { ...body, confirm_impact: true } })).toMatchObject({ ok: false, error: { kind: "invalid_request" } });
  expect(fetch).not.toHaveBeenCalled();
});
it("preserves occupied stage ids but never backend messages", async () => {
  respond({ error: "private", code: "stage_occupied", details: [{ stage_id: id }] }, 409);
  const result = await previewPipeline({ token: "x", draftId: id, body });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(mapDraftPipelineFailure(result)).toEqual({ ok: false, reason: "stage_occupied", details: [{ stage_id: id }], reference: { status: 409, code: "stage_occupied" } });
});
it.each([[409, "impact_confirmation_required", "impact_confirmation_required"], [409, "stage_change_requires_empty_pipeline", "version_conflict"], [409, "cutoff_stage_in_use", "cutoff_stage_in_use"], [412, "version_conflict", "version_conflict"]])("maps %s %s", (status, code, reason) => {
  expect(mapDraftPipelineFailure({ ok: false, error: { kind: "status", status: Number(status), retryable: false }, envelope: { error: "private", code: String(code) } })).toMatchObject({ reason });
});
