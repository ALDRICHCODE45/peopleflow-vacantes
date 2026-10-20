import { describe, expect, it } from "vitest";
import { buildFilterCommitUrl, buildJobsUrl, parseJobsQuery } from "./url";
import { listSampleJobs } from "./sample-jobs";

describe("geographic search query", () => {
  it("canonicalizes repeated dimensions and ignores legacy location", () => {
    const query = parseJobsQuery("state=09&state=14&state=09&state=&state=none&state=99&municipality=09002&municipality=nope&work_mode=remote&work_mode=hybrid&work_mode=none&applicant_country=MX&location=CDMX");
    expect(query).toEqual({ state: ["09", "14"], municipality: ["09002"], work_mode: ["remote", "hybrid"], applicant_country: "MX" });
    expect(buildJobsUrl(query)).toBe("/vacantes?state=09&state=14&municipality=09002&work_mode=remote&work_mode=hybrid&applicant_country=MX");
  });
  it("keeps country single and drops malformed/blank/none codes", () => {
    expect(parseJobsQuery("applicant_country=MX&applicant_country=US&state=9&municipality=00000&work_mode=&location=x")).toEqual({});
    expect(parseJobsQuery("applicant_country=none")).toEqual({});
  });
  it("never emits repeated single-valued fields from untyped callers", () => {
    expect(buildJobsUrl({ applicant_country: ["MX", "US"] } as unknown as Parameters<typeof buildJobsUrl>[0])).toBe("/vacantes");
  });
  it("drops cursor on every filter commit, including clearing", () => {
    expect(buildFilterCommitUrl("/vacantes?state=09&cursor=old", { state: ["14", "14"] })).toBe("/vacantes?state=14");
    expect(buildFilterCommitUrl("/vacantes?work_mode=remote&cursor=old", { work_mode: [] })).toBe("/vacantes");
  });
  it("never infers geography or remote eligibility for legacy sample rows", () => {
    expect(listSampleJobs({ state: ["09"] }).items).toEqual([]);
    expect(listSampleJobs({ municipality: ["09002"] }).items).toEqual([]);
    const eligible = listSampleJobs({ applicant_country: "MX" }).items;
    expect(eligible.length).toBeGreaterThan(0);
    expect(eligible.every(item => item.work_mode !== "remote")).toBe(true);
    expect(listSampleJobs({ work_mode: ["remote", "hybrid"] }).items.every(item => ["remote", "hybrid"].includes(item.work_mode))).toBe(true);
  });
});
