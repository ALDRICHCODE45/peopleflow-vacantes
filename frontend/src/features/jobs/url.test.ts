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
    expect(parseJobsQuery("foo=bar&seniority=senior&currency=MXN&employment_type=full_time&salary_min=1&language=en&q=&work_mode=remote&contract_type=bad&work_schedule=bad&professional_area=bad")).toEqual({ work_mode: ["remote"] });
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
