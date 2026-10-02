import { describe, expect, it } from "vitest";

import { SAMPLE_JOBS, SAMPLE_PAGE_SIZE, findSampleJob, listSampleJobs } from "./sample-jobs";
import { jobItemSchema } from "./schemas";
import type { JobItem } from "./types";

const KNOWN_FRONTEND_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const KNOWN_GO_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";

const ids = (jobs: readonly JobItem[]) => jobs.map((job) => job.id);
const sortedIds = (jobs: readonly JobItem[]) => [...ids(jobs)].sort();
const idOf = (title: string) => SAMPLE_JOBS.find((job) => job.title === title)?.id;

describe("sample jobs dataset", () => {
  it("exposes ten valid, unique, schema-conformant vacancies addressable by id", () => {
    expect(SAMPLE_JOBS).toHaveLength(10);
    expect(new Set(ids(SAMPLE_JOBS)).size).toBe(10);
    for (const job of SAMPLE_JOBS) {
      expect(() => jobItemSchema.parse(job)).not.toThrow();
      expect(findSampleJob(job.id)).toBe(job);
    }
    expect(findSampleJob("0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7fff")).toBeUndefined();
  });

  it("keeps the two known fixture vacancies verbatim so existing enrichment stays", () => {
    expect(findSampleJob(KNOWN_FRONTEND_ID)).toMatchObject({
      title: "Ingeniera Frontend",
      work_mode: "remote",
      employment_type: "full_time",
      seniority: "senior",
      salary_currency: "MXN",
      company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8f", name: "Acme" },
    });
    expect(findSampleJob(KNOWN_GO_ID)).toMatchObject({
      title: "Desarrolladora Go",
      work_mode: "hybrid",
      employment_type: "contract",
      seniority: "lead",
      salary_currency: "MXN",
      location: "Monterrey, Nuevo León",
      salary_min: 30000,
      salary_max: 45000,
      published_at: "2026-02-14T09:30:00Z",
      company: { id: "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93", name: "Acme" },
    });
  });

  it("serves all ten vacancies in one deterministic page when nothing is filtered", () => {
    const page = listSampleJobs({});
    expect(SAMPLE_PAGE_SIZE).toBe(10);
    expect(ids(page.items)).toEqual(sortedIds(SAMPLE_JOBS));
    expect(page.items).toHaveLength(10);
    expect(page.next_cursor).toBeUndefined();
  });

  it("applies the six canonical filters conjunctively before pagination", () => {
    const broad = listSampleJobs({
      work_mode: "remote",
      employment_type: "full_time",
      currency: "MXN",
      location: "ciudad de méxico",
    });
    expect(sortedIds(broad.items)).toEqual(
      sortedIds([
        SAMPLE_JOBS.find((job) => job.title === "Analista de Datos")!,
        SAMPLE_JOBS.find((job) => job.title === "Analista de Datos Senior")!,
      ]),
    );

    const narrowed = listSampleJobs({
      work_mode: "remote",
      employment_type: "full_time",
      currency: "MXN",
      location: "ciudad de méxico",
      seniority: "senior",
    });
    expect(ids(narrowed.items)).toEqual([idOf("Analista de Datos Senior")]);

    // Flipping a single predicate empties the set: evaluation is AND, never OR.
    expect(
      listSampleJobs({
        work_mode: "onsite",
        employment_type: "full_time",
        currency: "MXN",
        location: "ciudad de méxico",
        seniority: "senior",
      }).items,
    ).toEqual([]);
  });

  it("filters each canonical predicate independently", () => {
    expect(sortedIds(listSampleJobs({ currency: "USD" }).items)).toEqual(
      sortedIds([
        SAMPLE_JOBS.find((job) => job.title === "Ingeniero DevOps")!,
        SAMPLE_JOBS.find((job) => job.title === "Gerente de Ventas Regional")!,
      ]),
    );

    const leads = listSampleJobs({ seniority: "lead" }).items;
    expect(leads.every((job) => job.seniority === "lead")).toBe(true);
    expect(sortedIds(leads)).toEqual(
      sortedIds([
        SAMPLE_JOBS.find((job) => job.title === "Desarrolladora Go")!,
        SAMPLE_JOBS.find((job) => job.title === "Gerente de Ventas Regional")!,
      ]),
    );

    expect(sortedIds(listSampleJobs({ work_mode: "onsite" }).items)).toEqual(
      sortedIds([
        SAMPLE_JOBS.find((job) => job.title === "Becario de Soporte Técnico")!,
        SAMPLE_JOBS.find((job) => job.title === "Reclutadora Técnica")!,
      ]),
    );
    expect(ids(listSampleJobs({ employment_type: "internship" }).items)).toEqual([
      idOf("Becario de Soporte Técnico"),
    ]);
  });

  it("matches q tokens case-insensitively across title and description with token AND", () => {
    const devops = idOf("Ingeniero DevOps");
    expect(ids(listSampleJobs({ q: "KUBERNETES" }).items)).toEqual([devops]);
    expect(ids(listSampleJobs({ q: "kubernetes postgresql" }).items)).toEqual([devops]);
    expect(listSampleJobs({ q: "kubernetes ruby" }).items).toEqual([]);
    expect(listSampleJobs({ q: "analista datos" }).items.map((job) => job.title).sort()).toEqual([
      "Analista de Datos",
      "Analista de Datos Senior",
    ]);
  });

  it("treats cursors as opaque and validates them safely", () => {
    const firstPage = listSampleJobs({});
    const malformed = ["opaque a+b/c=", "no-es-un-cursor", "!!!", "LTE", "OTk"];
    for (const cursor of malformed) {
      expect(listSampleJobs({ cursor })).toEqual(firstPage);
    }

    // A well-formed cursor selects the deterministic slice after its offset.
    const offsetEight = Buffer.from("8", "utf8").toString("base64url");
    const tail = listSampleJobs({ cursor: offsetEight });
    expect(ids(tail.items)).toEqual(sortedIds(SAMPLE_JOBS).slice(8));
    expect(tail.next_cursor).toBeUndefined();
  });
});
