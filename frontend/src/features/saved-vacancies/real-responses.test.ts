// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import captures from "./fixtures/real-responses.json";
import { removedJobsSchema, savedJobIdsSchema, savedJobSchema, savedJobsErrorSchema, savedJobsSchema } from "./model";
import { loadSavedJobIds, loadSavedJobs, removeClosedSavedJobs, removeSavedJob, saveJob } from "./client";

// Do not load .env or change the server session boundary for integration tests.
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://127.0.0.1:8599", apiTimeoutMs: 5000 } }));
afterEach(() => vi.restoreAllMocks());
const token = "fixture-only-token";
const legacy = "30000000-0000-4000-8000-000000000001";
const vacancy = "40000000-0000-4000-8000-000000000001";
const capture = (name: string) => captures.find(row => row.name === name)!;

it.each(captures)("decodes real HTTP $status capture $name through model and client", async row => {
  const response = new Response(row.status === 204 ? null : JSON.stringify(row.body), { status: row.status });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
  let result;
  if (row.status >= 400) {
    const envelope = savedJobsErrorSchema.parse(row.body);
    // All error envelopes share the same transport mapping, irrespective of endpoint.
    result = await removeClosedSavedJobs({ token });
    expect(result).toEqual({ ok: false,
      reason: row.status === 403 ? "forbidden" : envelope.code,
      reference: { status: row.status, code: envelope.code },
      ...(envelope.code === "saved_jobs_limit" ? { limit: 200 } : {}),
    });
  } else if (row.method === "PUT") {
    const data = savedJobSchema.parse(row.body);
    result = await saveJob({ token, id: data.job_id });
    expect(result).toEqual({ ok: true, data });
  } else if (row.status === 204) {
    result = await removeSavedJob({ token, id: legacy });
    expect(row.body).toBeNull();
    expect(result).toEqual({ ok: true, data: null });
  } else if (row.method === "DELETE") {
    const data = removedJobsSchema.parse(row.body);
    result = await removeClosedSavedJobs({ token });
    expect(result).toEqual({ ok: true, data });
  } else if (row.path.endsWith("/ids")) {
    const data = savedJobIdsSchema.parse(row.body);
    result = await loadSavedJobIds({ token });
    expect(result).toEqual({ ok: true, data });
  } else {
    const data = savedJobsSchema.parse(row.body);
    result = await loadSavedJobs({ token });
    expect(result).toEqual({ ok: true, data });
  }
  expect(fetch).toHaveBeenCalledOnce();
});

it("retains real grouping, salary types, participation identity and backend ordering", () => {
  const { items } = savedJobsSchema.parse(capture("grouped").body);
  expect(items.map(row => row.job_id)).toEqual([legacy, vacancy,
    "40000000-0000-4000-8000-000000000002", "40000000-0000-4000-8000-000000000003"]);
  expect(items.map(row => [row.availability, Boolean(row.application)])).toEqual([
    ["open", false], ["open", false], ["open", true], ["closed", false],
  ]);
  expect(items[0].job.legacy_salary).toEqual({ min: "100.00", max: "200.00", currency: "MXN" });
  expect(items[0].job.compensation).toBeNull();
  expect(items[1].job.compensation).toEqual({ mode: "fixed", amount: "12500.00", min: null, max: null, currency: "MXN", pay_period: "monthly", basis: "gross" });
  expect(items[2].application).toEqual({ id: "60000000-0000-4000-8000-000000000001", applied_at: "2026-01-02T03:04:05Z" });
  expect(items[3].closed_at).toBe("2026-01-02T03:04:05Z");
  expect(savedJobsSchema.parse(capture("closed").body).items[3].closed_at).toBe("2026-01-03T03:04:05Z");
  expect(capture("replay").body).toEqual(capture("created").body);
});

// Optional real API probe. Only locally generated test tokens may be supplied;
// the deterministic replay tests above never require credentials or services.
it.skipIf(!process.env.SAVED_JOBS_LIVE_TOKEN)("exercises all five client functions against the disposable API", async () => {
  const liveToken = process.env.SAVED_JOBS_LIVE_TOKEN!;
  const before = await loadSavedJobs({ token: liveToken });
  expect(before.ok).toBe(true);
  if (!before.ok) return;
  expect(before.data.total).toBe(200);
  const ids = await loadSavedJobIds({ token: liveToken });
  expect(ids).toEqual({ ok: true, data: { job_ids: before.data.items.map(row => row.job_id) } });
  expect(await saveJob({ token: liveToken, id: vacancy })).toEqual({ ok: true, data: {
    job_id: vacancy, saved_at: before.data.items.find(row => row.job_id === vacancy)!.saved_at,
  } });
  expect(await saveJob({ token: liveToken, id: "80000000-0000-4000-8000-000000000198" })).toEqual({
    ok: false, reason: "saved_jobs_limit", limit: 200, reference: { status: 409, code: "saved_jobs_limit" },
  });
  expect(await saveJob({ token: liveToken, id: "40000000-0000-4000-8000-000000000004" })).toEqual({
    ok: false, reason: "job_unavailable", reference: { status: 409, code: "job_unavailable" },
  });
  expect(await saveJob({ token: liveToken, id: "90000000-0000-4000-8000-000000000001" })).toEqual({
    ok: false, reason: "not_found", reference: { status: 404, code: "not_found" },
  });
  expect(await loadSavedJobs({ token: liveToken })).toEqual(before);
  expect(await removeClosedSavedJobs({ token: liveToken })).toEqual({ ok: true, data: { removed: 0 } });
  expect(await removeSavedJob({ token: liveToken, id: legacy })).toEqual({ ok: true, data: null });
  expect(await removeSavedJob({ token: liveToken, id: legacy })).toEqual({ ok: true, data: null });
  const removed = await loadSavedJobs({ token: liveToken });
  expect(removed.ok && removed.data.total).toBe(199);
  expect(removed.ok && removed.data.items.some(row => row.job_id === legacy)).toBe(false);
  const undo = await saveJob({ token: liveToken, id: legacy });
  expect(undo.ok).toBe(true);
  const restored = await loadSavedJobs({ token: liveToken });
  expect(restored.ok && restored.data.total).toBe(200);
  expect(restored.ok && restored.data.items[0].job_id).toBe(legacy);
  expect(await loadSavedJobs({ token: "invalid-local-token" })).toMatchObject({ ok: false, reason: "unauthenticated", reference: { status: 401 } });
});
