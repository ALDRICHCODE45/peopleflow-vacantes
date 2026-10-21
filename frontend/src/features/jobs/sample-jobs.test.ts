import { describe, expect, it } from "vitest";
import { SAMPLE_JOBS, SAMPLE_PAGE_SIZE, findSampleJob, listSampleJobs } from "./sample-jobs";
import { jobItemSchema, publicJobDetailSchema, publicJobsListSchema } from "./schemas";
const ids = (jobs: readonly { id: string }[]) => jobs.map((job) => job.id);
const sortedIds = (jobs: readonly { id: string }[]) => ids(jobs).sort();
const idOf = (title: string) => SAMPLE_JOBS.find((job) => job.title === title)!.id;

describe("sample public v2 reads", () => {
  it("keeps ten unique v1 fixtures for existing prototypes but projects v2 public detail", () => {
    expect(SAMPLE_JOBS).toHaveLength(10);
    expect(new Set(ids(SAMPLE_JOBS)).size).toBe(10);
    for (const job of SAMPLE_JOBS) {
      expect(jobItemSchema.safeParse(job).success).toBe(true);
      const detail = findSampleJob(job.id)!;
      expect(publicJobDetailSchema.safeParse(detail).success).toBe(true);
      expect(detail.source).toBe("legacy");
      expect(detail.description_plain).toBe(job.description);
      expect(detail.description).toBeNull();
      expect(detail.location).toBeNull();
      expect(detail.location_label).toBe(job.location ?? null);
      expect(detail.remote_scope).toBeNull();
      expect(detail.title).toBe(job.title);
      expect(detail.company).toEqual({ ...job.company, logo_url: null });
      expect(detail).toMatchObject({
        excerpt: job.description.replace(/\p{White_Space}+/gu, " ").trim(), excerpt_truncated: false,
        skills: [], skills_preview: [], skills_total: 0,
        benefits_preview: { predefined: [], custom: [] }, benefits_total: 0,
        applicants: null, screening_questions: null,
      });
    }
    expect(findSampleJob("0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7fff")).toBeUndefined();
  });
  it("serves one deterministic conforming page with an explicit null cursor", () => {
    const page = listSampleJobs({});
    expect(SAMPLE_PAGE_SIZE).toBe(10);
    expect(sortedIds(page.items)).toEqual(sortedIds(SAMPLE_JOBS));
    expect(page.next_cursor).toBeNull();
    expect(publicJobsListSchema.safeParse(page).success).toBe(true);
    for (const item of page.items) {
      for (const key of ["description", "description_plain", "requirements", "benefits", "skills"]) expect(item).not.toHaveProperty(key);
      expect(item).toMatchObject({ company: { logo_url: null }, skills_preview: [], applicants: null, screening_questions: null });
      expect(Object.keys(item)).toHaveLength(24);
    }
  });
  it("applies text and modality conjunctively", () => {
    expect(listSampleJobs({ q: "analista datos", work_mode: ["remote"] }).items.map((job) => job.title).sort()).toEqual(["Analista de Datos", "Analista de Datos Senior"]);
    expect(listSampleJobs({ q: "analista datos", work_mode: "onsite" }).items).toEqual([]);
    expect(ids(listSampleJobs({ q: "KUBERNETES postgresql" }).items)).toEqual([idOf("Ingeniero DevOps")]);
    expect(listSampleJobs({ q: "kubernetes ruby" }).items).toEqual([]);
  });
  it.each([{ work_schedule: "full_time" }, { contract_type: "indefinite" }, { professional_area: "technology_systems" }])("excludes sample legacy rows for %j", (query) => {
    expect(listSampleJobs(query).items).toEqual([]);
  });
  it("ignores invalid or obsolete filters using the shared canonical model", () => {
    expect(listSampleJobs({ contract_type: "contract", salary_min: "bad", language: "en" } as Parameters<typeof listSampleJobs>[0])).toEqual(listSampleJobs({}));
  });
  it("excludes the legacy samples, which publish no pay period or basis, while a salary filter is active", () => {
    expect(listSampleJobs({}).items.length).toBeGreaterThan(0);
    expect(listSampleJobs({ salary_min: "1" }).items).toEqual([]);
    expect(listSampleJobs({ salary_max: "999999999", salary_currency: "USD" }).items).toEqual([]);
  });
  it("validates cursors and selects only a safe deterministic sample offset", () => {
    const page = listSampleJobs({});
    for (const cursor of ["opaque a+b/c=", "no-es-un-cursor", "!!!", "LTE", "OTk"]) expect(listSampleJobs({ cursor })).toEqual(page);
    const tail = listSampleJobs({ cursor: Buffer.from("8", "utf8").toString("base64url") });
    expect(ids(tail.items)).toEqual(sortedIds(SAMPLE_JOBS).slice(8));
    expect(tail.next_cursor).toBeNull();
  });
});
