import { expect, it, vi } from "vitest";
import { createFixtureClient, historySchema, readOverview } from "./client";

it("decodes offset microseconds and rejects extra candidate data at every boundary", async () => {
  const page = await createFixtureClient().getHistory();
  const item = page.items[0];
  const at = "2026-10-15T00:07:43.276165+00:00";
  const real = { ...item, started_at: at, ended_at: at, functions: [{ function: "responsible", started_at: at, ended_at: null }] };
  expect(historySchema.parse({ items: [real], next_cursor: "opaque+/=" }).items[0]).toEqual(real);
  for (const value of [{ items: [real], next_cursor: null, candidate: "private" }, { items: [{ ...real, candidate: "private" }], next_cursor: null }, { items: [{ ...real, functions: [{ ...real.functions[0], candidate: "private" }] }], next_cursor: null }, { items: [{ ...real, placements: { ...real.placements, candidate: "private" } }], next_cursor: null }]) expect(historySchema.safeParse(value).success).toBe(false);
});
it.each(["on_time", "late", "pending", "unfinished", "not_applicable", "none"])("decodes required own-history fields for %s", async deadline_result => {
  const base = (await createFixtureClient().getHistory()).items[0];
  const fields = { draft_id: "draft-1", requester: { kind: "internal_area", name: "Finanzas" }, vacancy_status: { publication: "paused", process: "active" }, business_days_in_tramo: 8, delivery_target: 5, deadline_result, deadline_delta_business_days: -2 };
  const page = { items: [{ ...base, ...fields }], next_cursor: null };
  expect(historySchema.parse(page)).toEqual(page);
  for (const field of Object.keys(fields)) {
    const missing = { ...page.items[0] } as Record<string, unknown>; delete missing[field];
    expect(historySchema.safeParse({ ...page, items: [missing] }).success).toBe(false);
  }
  for (const invalid of [{ requester: { kind: "area", name: "Finanzas" } }, { vacancy_status: { publication: "invalid", process: null } }, { deadline_result: "invalid" }, { business_days_in_tramo: -1 }]) expect(historySchema.safeParse({ ...page, items: [{ ...page.items[0], ...invalid }] }).success).toBe(false);
});
it("sums all pages, separates participation and caps at ten pages honestly", async () => {
  const item = (await createFixtureClient().getHistory()).items[0];
  const getHistory = vi.fn().mockResolvedValue({ items: [item], next_cursor: "more" });
  // Unique opaque cursors, not offsets derived by the client.
  getHistory.mockImplementation(async (cursor?: string) => {
    if (Number(cursor) >= 10) throw new Error("Summary exceeded ten-page cap");
    return { items: [item], next_cursor: String(Number(cursor ?? 0) + 1) };
  });
  const overview = await readOverview({ getHistory });
  expect(getHistory).toHaveBeenCalledTimes(10);
  expect(overview.summary).toEqual({ current: 10, delivered: 80, placements: 10, participant: 0, incomplete: true });
});
it("preserves complete fixture summary and cursor pagination", async () => {
  const overview = await readOverview(createFixtureClient());
  expect(overview.first.items).toHaveLength(10);
  expect(overview.summary).toEqual({ current: 3, delivered: 27, placements: 5, participant: 5, incomplete: false });
});
it("accepts untitled drafts (vacancy_title null in the real :8081 payload)", () => {
  const at = "2026-10-23T23:03:00.777369+00:00";
  const parsed = historySchema.safeParse({ items: [{ vacancy_title: null, functions: [{ function: "responsible", started_at: at, ended_at: null }], started_at: at, ended_at: null, end_cause: null,
    draft_id: null, requester: null, vacancy_status: { publication: "draft", process: null }, business_days_in_tramo: 0, delivery_target: null, deadline_result: "none", deadline_delta_business_days: null, effective_deadline: null, delivered_in_tramo: 0, placements: { direct: 0, participant: 0, shared: 0 } }], next_cursor: null });
  expect(parsed.success).toBe(true);
});
