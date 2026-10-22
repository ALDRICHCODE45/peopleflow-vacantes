import { describe, expect, it } from "vitest";
import { buildFilterCommitUrl, buildJobsUrl, buildNextJobsUrl, parseJobsQuery } from "./url";

describe("H5 profile search URL", () => {
  const search = "language=en&language=nah&seniority=junior&seniority=semi_senior&years_of_experience=1.5&education_level=bachelor";
  it("round-trips all four dimensions and deduplicates OR values", () => {
    const query = parseJobsQuery(`${search}&language=en&seniority=junior`);
    expect(query).toEqual({ language: ["en", "nah"], seniority: ["junior", "semi_senior"], years_of_experience: "1.5", education_level: "bachelor" });
    const params = new URLSearchParams(buildJobsUrl(query).split("?")[1]);
    expect(params.getAll("language")).toEqual(["en", "nah"]);
    expect(parseJobsQuery(params.toString())).toEqual(query);
    expect(buildNextJobsUrl(`/vacantes?${search}`, "next")).toContain("cursor=next");
    expect(buildFilterCommitUrl(`/vacantes?${search}&cursor=old`, { education_level: "" })).not.toMatch(/cursor|education_level/);
  });
  it.each(["01", "1.50", "60.1", "61", "-1", "+1", "1e1", " 2", "2 ", "", "0.00"])("drops invalid years %j on read and write", value => {
    expect(parseJobsQuery(`years_of_experience=${encodeURIComponent(value)}`)).toEqual({});
    expect(buildJobsUrl({ years_of_experience: value })).toBe("/vacantes");
  });
  it.each(["0", "0.1", "1.5", "2", "2.0", "59.9", "60", "60.0"])("preserves valid decimal strings %s", value => {
    expect(parseJobsQuery(`years_of_experience=${value}`)).toEqual({ years_of_experience: value });
  });
  it("drops invalid enums, malformed codes and repeated single values", () => {
    expect(parseJobsQuery("language=EN&language=en,fr&language=&seniority=mid&education_level=Master&years_of_experience=2&years_of_experience=2")).toEqual({});
    expect(parseJobsQuery("education_level=bachelor&education_level=bachelor")).toEqual({});
  });
});
