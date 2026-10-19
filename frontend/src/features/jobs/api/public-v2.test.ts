import { afterEach, describe, expect, it, vi } from "vitest";
import * as schemas from "../schemas";
import { buildJobsUrl, parseJobsQuery } from "../url";
import { legacyDetail, listItem, vacancyDetail } from "./public-fixtures";
import { getJob } from "./getJob";
import { listJobs } from "./listJobs";

vi.mock("../../../lib/api/server", async () => ({ requestJson: (await import("../../../lib/api/requestJson")).requestJson }));
vi.mock("../../../lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://127.0.0.1:8080", apiTimeoutMs: 8000, sampleJobs: false } }));
afterEach(() => vi.unstubAllGlobals());

const response = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body });

describe("public v2 contract", () => {
  it.each([legacyDetail, vacancyDetail])("decodes $source list and detail", (detail) => {
    expect(schemas.publicJobItemSchema.parse(listItem(detail))).toEqual(listItem(detail));
    expect(schemas.publicJobDetailSchema.parse(detail)).toEqual(detail);
  });
  it("requires every list key and strict enum values", () => {
    const item = listItem(vacancyDetail);
    for (const key of Object.keys(item)) {
      const missing = { ...item } as Record<string, unknown>;
      delete missing[key];
      expect(schemas.publicJobItemSchema.safeParse(missing).success, key).toBe(false);
    }
    for (const key of ["source", "work_mode", "work_schedule", "contract_type", "professional_area", "seniority"]) {
      expect(schemas.publicJobItemSchema.safeParse({ ...item, [key]: "unknown" }).success, key).toBe(false);
    }
    expect(schemas.publicJobItemSchema.safeParse({ ...item, published_at: "2026-10-16" }).success).toBe(false);
    expect(schemas.publicJobsListSchema.safeParse({ items: [] }).success).toBe(false);
    expect(schemas.publicJobsListSchema.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
  });
  it("enforces source nullability without mapping legacy employment to schedule", () => {
    const legacy = listItem(legacyDetail);
    const vacancy = listItem(vacancyDetail);
    for (const patch of [{ seniority: null }, { work_schedule: "full_time" }, { contract_type: "indefinite" }, { professional_area: "technology_systems" }, { compensation: vacancy.compensation }, { legacy_salary: { min: null, max: null, currency: "MXN" } }]) {
      expect(schemas.publicJobItemSchema.safeParse({ ...legacy, ...patch }).success).toBe(false);
    }
    for (const patch of [{ legacy_employment_type: "full_time" }, { legacy_salary: legacy.legacy_salary }, { work_schedule: null }, { contract_type: null }, { professional_area: null }, { location: "CDMX" }]) {
      expect(schemas.publicJobItemSchema.safeParse({ ...vacancy, ...patch }).success).toBe(false);
    }
    expect(schemas.publicJobItemSchema.safeParse({ ...legacy, legacy_salary: { min: null, max: "50000.50", currency: "USD" } }).success).toBe(true);
  });
  it("accepts complete fixed/range compensation with pay_period only", () => {
    const item = listItem(vacancyDetail);
    const fixed = { ...item.compensation!, mode: "fixed", amount: "50000.25", min: null, max: null };
    expect(schemas.publicJobItemSchema.safeParse({ ...item, compensation: fixed }).success).toBe(true);
    for (const compensation of [{ ...fixed, amount: null }, { ...fixed, min: "1" }, { ...fixed, period: "monthly", pay_period: undefined }, { ...fixed, pay_period: "daily" }, { ...fixed, basis: null }, { ...fixed, amount: 50000 }, { ...item.compensation!, max: null }, { ...item.compensation!, min: "50000.00" }]) {
      expect(schemas.publicJobItemSchema.safeParse({ ...item, compensation }).success).toBe(false);
    }
  });
  it("requires detail extras and validates rich description, benefits and legacy emptiness", () => {
    expect(schemas.publicJobDetailSchema.safeParse(listItem(vacancyDetail)).success).toBe(false);
    for (const patch of [{ description: null }, { description: { schema_version: 99 } }, { benefits: { predefined: ["unknown"], custom: [] } }, { requirements: {} }]) {
      expect(schemas.publicJobDetailSchema.safeParse({ ...vacancyDetail, ...patch }).success).toBe(false);
    }
    for (const patch of [{ description: vacancyDetail.description }, { requirements: vacancyDetail.requirements }, { benefits: vacancyDetail.benefits }]) {
      expect(schemas.publicJobDetailSchema.safeParse({ ...legacyDetail, ...patch }).success).toBe(false);
    }
  });
  it("drops stale, repeated and invalid URL values before the strict request", async () => {
    const raw = "q=Go&location=CDMX&work_mode=remote&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems&cursor=opaque&currency=MXN&salary_min=1&language=en&seniority=senior&employment_type=contract&limit=900";
    const query = parseJobsQuery(raw);
    const url = buildJobsUrl(query);
    expect(url).toBe("/vacantes?q=Go&location=CDMX&work_mode=remote&work_schedule=full_time&contract_type=indefinite&professional_area=technology_systems&cursor=opaque");
    expect(parseJobsQuery("work_mode=bad&contract_type=bad&professional_area=bad&work_schedule=full_time&work_schedule=part_time")).toEqual({});
    const fetchMock = vi.fn().mockResolvedValue(response({ items: [listItem(vacancyDetail)], next_cursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await listJobs(query)).ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(`http://127.0.0.1:8080/v2/jobs${url.slice("/vacantes".length)}`);
  });
  it("decodes v2 detail and preserves 400/404 classifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(vacancyDetail));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getJob(vacancyDetail.id)).toEqual({ ok: true, data: vacancyDetail });
    expect(fetchMock.mock.calls[0][0]).toBe(`http://127.0.0.1:8080/v2/jobs/${vacancyDetail.id}`);
    fetchMock.mockResolvedValue(response({ error: "Invalid request", code: "invalid_request" }, 400));
    expect(await listJobs({})).toEqual({ ok: false, error: { kind: "status", status: 400, retryable: false } });
    fetchMock.mockResolvedValue(response({ error: "Not found", code: "not_found" }, 404));
    expect(await getJob(vacancyDetail.id)).toEqual({ ok: false, error: { kind: "not_found", status: 404, retryable: false } });
  });
});
