import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 8000 } }));
import { getDeliveryStatus, previewDraftDelivery, saveDraftDelivery, getDraftDelivery } from "./delivery-client";
import { boardSchema, moveSchema } from "@/features/pipeline-movement/model";
import { board, moved, id } from "@/features/pipeline-movement/test-fixtures";
import { deliveryFixture } from "@/features/employer-vacancies/delivery-config/test-fixture";
const candidate = { participation_id: id(10), candidate: { id: id(11), full_name: "Ana Pérez" }, reached_at: "2026-10-16T12:00:00Z" };
export const fulfillment = { fulfilled_at: "2026-10-16T12:00:00Z", result: "on_time" as const, business_days_delta: 2, target: 1, cutoff_stage_id: id(2), cutoff_stage_name: "Screening OK", commitment_date: "2026-10-20", candidates: [candidate] };
const pending = { state: "pending", delivered: 0, target: 1, cutoff_stage_id: id(2), commitment_date: "2026-10-20", business_days_remaining: -2, fulfillment: null };
const fulfilled = { ...pending, state: "fulfilled", delivered: 1, business_days_remaining: null, fulfillment };
const preview = { would_fulfill: true, delivered: 1, target: 1, candidates: [candidate] };
const input = { token: "secret", draftId: id(1) };
const body = { cutoffStageId: id(2), targetQuantity: 1, commitmentDate: "2026-10-20" };
function respond(value: unknown, status = 200) { const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(value), { status, headers: { etag: '"delivery"' } })); vi.stubGlobal("fetch", fetch); return fetch; }
afterEach(() => vi.unstubAllGlobals());
it("strictly decodes pending and frozen fulfillment including dates, enums, snapshot and candidate ordering", async () => {
  const { deliveryStatusSchema } = await import("./fulfillment-model");
  expect(deliveryStatusSchema.parse(pending)).toEqual(pending); expect(deliveryStatusSchema.parse(fulfilled)).toEqual(fulfilled);
  for (const value of [{ ...pending, fulfillment }, { ...fulfilled, fulfillment: null }, { ...fulfilled, business_days_remaining: 1 }, { ...pending, target: null }, { ...pending, commitment_date: "2026-02-30" }, { ...fulfilled, fulfillment: { ...fulfillment, result: "early" } }, { ...fulfilled, fulfillment: { ...fulfillment, candidates: [{ ...candidate, extra: true }] } }, { ...fulfilled, fulfillment: { ...fulfillment, business_days_delta: -1 } }]) expect(deliveryStatusSchema.safeParse(value).success).toBe(false);
});
it("allows pending historical attainment before the next qualifying event records fulfillment (§16.3 no backfill)", async () => {
  const { deliveryStatusSchema, deliverySummarySchema } = await import("./fulfillment-model");
  expect(deliverySummarySchema.safeParse({ state: "pending", delivered: 3, target: 3 }).success).toBe(true);
  expect(deliveryStatusSchema.safeParse({ ...pending, delivered: 1 }).success).toBe(true);
});
it("accepts frozen delivered counts above the target after a delivery edit", async () => {
  const { deliveryStatusSchema } = await import("./fulfillment-model");
  expect(deliveryStatusSchema.safeParse({ ...fulfilled, delivered: 5 }).success).toBe(true);
});
it("strictly decodes preview and rejects duplicates, wrong counts, ordering and unknown keys", async () => {
  const { deliveryPreviewSchema } = await import("./fulfillment-model");
  expect(deliveryPreviewSchema.parse(preview)).toEqual(preview);
  const later = { ...candidate, participation_id: id(20), reached_at: "2026-10-17T12:00:00Z" };
  for (const value of [{ ...preview, extra: true }, { ...preview, would_fulfill: false }, { ...preview, candidates: [] }, { ...preview, delivered: 2, candidates: [candidate, candidate] }, { ...preview, delivered: 2, candidates: [later, candidate] }]) expect(deliveryPreviewSchema.safeParse(value).success).toBe(false);
});
it("keeps sub-millisecond candidate ordering instead of truncating reached_at to JavaScript milliseconds", async () => {
  const { deliveryPreviewSchema } = await import("./fulfillment-model");
  const earlier = { ...candidate, participation_id: id(20), reached_at: "2026-10-16T12:00:00.000001Z" };
  const later = { ...candidate, reached_at: "2026-10-16T12:00:00.000002Z" };
  expect(deliveryPreviewSchema.safeParse({ ...preview, delivered: 2, candidates: [earlier, later] }).success).toBe(true);
  expect(deliveryPreviewSchema.safeParse({ ...preview, delivered: 2, candidates: [later, earlier] }).success).toBe(false);
});
it("requires delivery on board and every participation write response", () => {
  const delivery = { state: "fulfilled", delivered: 1, target: 1 };
  expect(boardSchema.safeParse({ ...board, delivery }).success).toBe(true); expect(moveSchema.safeParse({ ...moved, delivery }).success).toBe(true);
  expect(boardSchema.safeParse({ ...board, delivery: undefined }).success).toBe(false); expect(moveSchema.safeParse({ ...moved, delivery: undefined }).success).toBe(false);
});
it("GET status reads once and POST preview sends the PUT body without If-Match", async () => {
  let fetch = respond(fulfilled); expect(await getDeliveryStatus(input)).toEqual({ ok: true, data: fulfilled }); expect(fetch.mock.calls[0][0]).toContain("/delivery/status");
  fetch = respond(preview); expect(await previewDraftDelivery({ ...input, body })).toEqual({ ok: true, data: preview });
  expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toContain("/delivery/preview");
  expect(fetch.mock.calls[0][1].method).toBe("POST"); expect(new Headers(fetch.mock.calls[0][1].headers).has("if-match")).toBe(false); expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(body));
});
it("requires fulfilled on delivery GET/PUT and forwards confirm_fulfillment only on explicit PUT", async () => {
  const data = { ...deliveryFixture(), fulfilled: true }; respond(data); expect(await getDraftDelivery(input)).toMatchObject({ ok: true, data });
  const fetch = respond(data); expect(await saveDraftDelivery({ ...input, ifMatch: '"opaque"', body: { ...body, confirm_fulfillment: true } })).toMatchObject({ ok: true }); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...body, confirm_fulfillment: true });
  respond({ ...data, fulfilled: undefined }); expect(await getDraftDelivery(input)).toMatchObject({ ok: false, error: { kind: "invalid_response" } });
});
