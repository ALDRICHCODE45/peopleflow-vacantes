import { describe, expect, it } from "vitest";
import { CONTRACT_TYPES, PROFESSIONAL_AREAS, WORK_MODES, WORK_SCHEDULES } from "./drafts/scalars";
import { buildFilterCommitUrl, buildJobsUrl, buildNextJobsUrl, isCanonicalJobsQuery, parseJobsQuery } from "./url";

const filters = { q: "Go", state: "09", work_mode: "hybrid", work_schedule: "full_time", contract_type: "indefinite", professional_area: "technology_systems" };
const raw = new URLSearchParams(filters).toString();
const valueOf = (url: string, key: string) => new URLSearchParams(url.split("?")[1]).get(key);

describe("canonical v2 public query", () => {
  it("serializes exactly six filters in fixed order, then the opaque cursor", () => {
    expect(buildJobsUrl({ ...filters, cursor: "opaque" })).toBe(`/vacantes?${raw}&cursor=opaque`);
    expect(buildJobsUrl({})).toBe("/vacantes");
  });
  it("omits unknown, obsolete, invalid, empty and repeated values", () => {
    expect(parseJobsQuery("foo=bar&seniority=senior&currency=MXN&employment_type=full_time&language=en&q=&work_mode=remote&contract_type=bad&work_schedule=bad&professional_area=bad")).toEqual({ work_mode: ["remote"] });
    for (const [key, value] of Object.entries(filters)) {
      expect(parseJobsQuery(`${key}=${value}&${key}=${value}`)).toEqual(["state", "work_mode"].includes(key) ? { [key]: [value] } : {});
    }
    expect(parseJobsQuery("cursor=a&cursor=b")).toEqual({});
  });
  it("accepts only exact catalog values for each enum", () => {
    for (const [key, values] of Object.entries({ work_mode: WORK_MODES, work_schedule: WORK_SCHEDULES, contract_type: CONTRACT_TYPES, professional_area: PROFESSIONAL_AREAS })) {
      for (const value of values) expect(parseJobsQuery(`${key}=${value}`)).toEqual({ [key]: key === "work_mode" ? [value] : value });
      for (const bad of ["UNKNOWN", "null", "Remote", "full-time", ""]) expect(parseJobsQuery(`${key}=${bad}`)).toEqual({});
    }
  });
  it("trims Unicode whitespace on q and ignores legacy location but never changes cursor bytes", () => {
    expect(parseJobsQuery("q=%20Go%20%20web%C2%A0&location=%E3%80%80CDMX%E3%80%80")).toEqual({ q: "Go  web" });
    const cursor = "a b+c=d%e/f~gñ";
    const next = buildNextJobsUrl(`/vacantes?${raw}`, cursor);
    expect(valueOf(next, "cursor")).toBe(cursor);
    expect(buildJobsUrl(parseJobsQuery(next.split("?")[1]))).toBe(next);
  });
  it("canonical checking rejects stale links before any request, independent of key order", () => {
    expect(isCanonicalJobsQuery(raw)).toBe(true);
    expect(isCanonicalJobsQuery("work_mode=hybrid&q=Go")).toBe(true);
    for (const text of ["currency=MXN", "language=en", "employment_type=full_time", "limit=51", "q=%20Go", "q=a&q=b", "contract_type=contract"]) expect(isCanonicalJobsQuery(text)).toBe(false);
  });
  it("clears the cursor on every filter add/change/clear and preserves all other filters", () => {
    const values = { q: "React", state: "19", work_mode: "remote", work_schedule: "part_time", contract_type: "project", professional_area: "engineering" };
    for (const [key, newValue] of Object.entries(values)) {
      const changed = buildFilterCommitUrl(`/vacantes?${raw}&cursor=old`, { [key]: newValue });
      const cleared = buildFilterCommitUrl(`/vacantes?${raw}&cursor=old`, { [key]: "" });
      expect(valueOf(changed, "cursor")).toBeNull();
      expect(valueOf(cleared, key)).toBeNull();
      expect(valueOf(changed, key)).toBe(newValue);
      for (const [other, value] of Object.entries(filters)) if (other !== key) {
        expect(valueOf(changed, other)).toBe(value);
        expect(valueOf(cleared, other)).toBe(value);
      }
      expect(buildFilterCommitUrl(cleared, { [key]: newValue })).toBe(changed);
    }
  });
});

describe("public salary filter in the URL", () => {
  const units = "salary_currency=MXN&salary_period=monthly&salary_basis=gross";
  it("serializes amounts then currency, period and basis after the six filters and before the cursor", () => {
    expect(buildJobsUrl({ q: "Go", professional_area: "engineering", salary_min: "30000", salary_max: "40000", salary_currency: "USD", salary_period: "yearly", salary_basis: "net", cursor: "c" }))
      .toBe("/vacantes?q=Go&professional_area=engineering&salary_min=30000&salary_max=40000&salary_currency=USD&salary_period=yearly&salary_basis=net&cursor=c");
  });
  it("accepts one end alone in either direction", () => {
    expect(parseJobsQuery(`salary_min=30000&${units}`)).toEqual({ salary_min: "30000", salary_currency: "MXN", salary_period: "monthly", salary_basis: "gross" });
    expect(parseJobsQuery(`salary_max=40000&${units}`)).toEqual({ salary_max: "40000", salary_currency: "MXN", salary_period: "monthly", salary_basis: "gross" });
  });
  it("fills MXN, monthly and gross for an amount without units, and drops units without an amount", () => {
    expect(buildJobsUrl({ salary_min: "30000" })).toBe(`/vacantes?salary_min=30000&${units}`);
    expect(buildJobsUrl({ salary_min: "30000", salary_currency: "bad", salary_period: "daily", salary_basis: "x" })).toBe(`/vacantes?salary_min=30000&${units}`);
    expect(parseJobsQuery("salary_currency=USD&salary_period=yearly&salary_basis=net")).toEqual({});
    expect(isCanonicalJobsQuery("salary_min=30000")).toBe(false);
    expect(isCanonicalJobsQuery(`salary_min=30000&${units}`)).toBe(true);
  });
  it("accepts every currency, period and basis of the compensation catalog", () => {
    for (const currency of ["MXN", "USD"]) for (const period of ["hourly", "weekly", "semimonthly", "monthly", "yearly"]) for (const basis of ["gross", "net"]) {
      expect(parseJobsQuery(`salary_min=1&salary_currency=${currency}&salary_period=${period}&salary_basis=${basis}`)).toEqual({ salary_min: "1", salary_currency: currency, salary_period: period, salary_basis: basis });
    }
  });
  it("keeps decimal amounts on the money pattern and drops malformed ones", () => {
    expect(parseJobsQuery(`salary_min=0&salary_max=999999999999.99&${units}`)).toMatchObject({ salary_min: "0", salary_max: "999999999999.99" });
    expect(parseJobsQuery(`salary_min=30000.5&${units}`)).toMatchObject({ salary_min: "30000.5" });
    for (const bad of ["-1", "1e5", "30,000", " 30000", "030000", "1.234", "1000000000000", "", "abc"]) {
      expect(parseJobsQuery(`salary_min=${encodeURIComponent(bad)}&${units}`)).toEqual({});
    }
    expect(parseJobsQuery(`salary_min=1&salary_min=2&${units}`)).toEqual({});
  });
  it("drops the whole salary filter when the minimum exceeds the maximum, keeping equal bounds", () => {
    expect(parseJobsQuery(`q=Go&salary_min=40000&salary_max=30000&${units}`)).toEqual({ q: "Go" });
    expect(parseJobsQuery(`salary_min=40000&salary_max=40000.00&${units}`)).toMatchObject({ salary_min: "40000", salary_max: "40000.00" });
  });
  it("clears the cursor when the salary filter changes or clears, preserving other filters", () => {
    const current = `/vacantes?q=Go&salary_min=30000&${units}&cursor=old`;
    expect(buildFilterCommitUrl(current, { salary_min: "35000" })).toBe(`/vacantes?q=Go&salary_min=35000&${units}`);
    expect(buildFilterCommitUrl(current, { salary_min: "", salary_max: "" })).toBe("/vacantes?q=Go");
  });
});
