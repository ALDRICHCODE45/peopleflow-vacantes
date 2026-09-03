import { describe, expect, it } from "vitest";
import { buildFilterCommitUrl, buildJobsUrl, buildNextJobsUrl, isCanonicalJobsQuery, parseJobsQuery } from "./url";

const KEYS = ["q", "seniority", "work_mode", "employment_type", "location", "currency"] as const;
const ALL_FILTERS: Record<string, string> = {
  q: "react", seniority: "senior", work_mode: "remote",
  employment_type: "full_time", location: "Monterrey", currency: "USD",
};
const NEW_VALUES: Record<string, string> = {
  q: "vue", seniority: "junior", work_mode: "onsite",
  employment_type: "part_time", location: "Guadalajara", currency: "MXN",
};
const withCursor = (filters: Record<string, string>) =>
  `/vacantes?${new URLSearchParams({ ...filters, cursor: "opaque123" }).toString()}`;
const valueOf = (url: string, key: string) => new URLSearchParams(url.split("?")[1]).get(key);
const without = (filters: Record<string, string>, key: string) =>
  Object.fromEntries(Object.entries(filters).filter(([k]) => k !== key));

describe("canonical /vacantes query state", () => {
  it("owns only present valid keys; absent, invalid, unknown, and repeated values are omitted", () => {
    const query = parseJobsQuery("q=react&currency=MXN");
    expect(query).toEqual({ q: "react", currency: "MXN" });
    for (const absent of ["seniority", "work_mode", "employment_type", "location", "cursor"]) expect(query).not.toHaveProperty(absent);
    // Unsupported keys can never appear; empty, invalid, and repeated values are omitted entirely.
    expect(
      parseJobsQuery("foo=bar&seniority=expert&seniority=senior&currency=eur&q=&work_mode=remote"),
    ).toEqual({ work_mode: "remote" });
  });

  it("serializes keys in the canonical fixed order", () => {
    const all = "q=react&seniority=senior&work_mode=remote&employment_type=full_time&location=Guadalajara&currency=MXN&cursor=opaque-cursor";
    expect(buildJobsUrl(parseJobsQuery(all))).toBe(`/vacantes?${all}`);
    expect(buildJobsUrl({})).toBe("/vacantes");
  });

  it("trims outer Unicode whitespace from q and location and preserves internal text", () => {
    expect(parseJobsQuery("q=%20%20desarrollo%20%20web%C2%A0&location=%E3%80%80Monterrey%E3%80%80")).toEqual({ q: "desarrollo  web", location: "Monterrey" });
  });

  it("detects non-canonical input while key order alone stays canonical", () => {
    expect(isCanonicalJobsQuery("q=react&currency=MXN")).toBe(true);
    expect(isCanonicalJobsQuery("currency=MXN&q=react")).toBe(true);
    for (const nonCanonical of ["currency=mxn", `q=${encodeURIComponent(" react")}`, "foo=1", "q=a&q=b"])
      expect(isCanonicalJobsQuery(nonCanonical)).toBe(false);
  });

  it("resets the cursor and applies the patch whenever any of the six filters is added, changed, or cleared", () => {
    for (const key of KEYS) {
      const change = buildFilterCommitUrl(withCursor(ALL_FILTERS), { [key]: NEW_VALUES[key] });
      const added = buildFilterCommitUrl(withCursor(without(ALL_FILTERS, key)), { [key]: NEW_VALUES[key] });
      const cleared = buildFilterCommitUrl(withCursor(ALL_FILTERS), { [key]: "" });
      for (const commit of [change, added, cleared]) {
        expect(commit).not.toContain("cursor"); // every filter commit omits the cursor
        for (const other of KEYS)
          if (other !== key) expect(valueOf(commit, other)).toBe(ALL_FILTERS[other]);
      }
      expect(valueOf(change, key)).toBe(NEW_VALUES[key]); // changes keep the new value
      expect(valueOf(added, key)).toBe(NEW_VALUES[key]); // additions keep the new value
      expect(valueOf(cleared, key)).toBeNull(); // clears omit the key entirely
    }
  });

  it("preserves all six active filters and an opaque cursor byte-for-byte with a stable canonical round trip", () => {
    const cursor = "a b+c=d%e/f~gñ";
    const next = buildNextJobsUrl(withCursor(ALL_FILTERS), cursor);
    const params = new URLSearchParams(next.split("?")[1]);
    expect(params.get("cursor")).toBe(cursor); // decoded string is identical
    for (const key of KEYS) expect(params.get(key)).toBe(ALL_FILTERS[key]); // includes exact uppercase USD
    expect(buildJobsUrl(parseJobsQuery(next.split("?")[1]))).toBe(next); // stable canonical round trip
  });
});
