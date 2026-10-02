import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROTOTYPE_COMPANY_ID } from "../company-profile/model";
import type { PrototypeJobView } from "./enrich";
import { jobItemSchema } from "./schemas";
import type { JobItem } from "./types";
import { ACME_PROTOTYPE_JOBS, ACME_WIRE_JOBS } from "./prototype-jobs";

const FRONTEND_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const GO_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
const GO_COMPANY_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d93";
const source = readFileSync(join(process.cwd(), "src", "features", "jobs", "prototype-jobs.ts"), "utf8");
const fixture = readFileSync(join(process.cwd(), "tests", "fixtures", "jobs-server.mjs"), "utf8");

describe("prototype wire job fixtures", () => {
  it("mirrors the two demo vacancies the local jobs server serves", () => {
    expect(ACME_WIRE_JOBS.map((job: JobItem) => [job.id, job.title, job.company])).toEqual([[FRONTEND_ID, "Ingeniera Frontend", { id: PROTOTYPE_COMPANY_ID, name: "Acme" }], [GO_ID, "Desarrolladora Go", { id: GO_COMPANY_ID, name: "Acme" }]]);
    for (const job of ACME_WIRE_JOBS) expect([fixture.includes(`id: "${job.id}"`), fixture.includes(`title: "${job.title}"`)]).toEqual([true, true]);
  });

  it("freezes the wire fixtures and never mutates them while filtering", () => {
    const snapshot = JSON.parse(JSON.stringify(ACME_WIRE_JOBS));
    expect([Object.isFrozen(ACME_WIRE_JOBS), Object.isFrozen(ACME_PROTOTYPE_JOBS)]).toEqual([true, true]);
    for (const job of ACME_WIRE_JOBS) expect([Object.isFrozen(job), Object.isFrozen(job.company)]).toEqual([true, true]);
    expect(ACME_PROTOTYPE_JOBS.map((view: PrototypeJobView) => view.id)).toEqual([FRONTEND_ID, GO_ID]);
    expect(ACME_WIRE_JOBS).toEqual(snapshot);
    expect(ACME_PROTOTYPE_JOBS.every((view: PrototypeJobView) => view.prototype !== undefined)).toBe(true);
  });

  it("freezes every exported prototype entry and the enrichment attached to it", () => {
    expect(ACME_PROTOTYPE_JOBS.every((view: PrototypeJobView) => Object.isFrozen(view))).toBe(true);
    for (const view of ACME_PROTOTYPE_JOBS) expect([Object.isFrozen(view.prototype), Object.isFrozen(view.prototype?.skills), Object.isFrozen(view.prototype?.benefits), Object.isFrozen(view.company)]).toEqual([true, true, true, true]);
    expect(() => { ACME_PROTOTYPE_JOBS[0].title = "Mutado"; }).toThrow(TypeError);
    expect(ACME_PROTOTYPE_JOBS[0].title).toBe("Ingeniera Frontend");
  });

  it("stays compatible with the existing wire schema without importing it", () => {
    for (const job of ACME_WIRE_JOBS) {
      const parsed = jobItemSchema.safeParse(job);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data).toEqual(job);
    }
    expect(jobItemSchema.safeParse(ACME_PROTOTYPE_JOBS[0]).success).toBe(true);
  });

  it("keeps the local fixtures free of transport, schema, and state", () => {
    const specifiers = [...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]);
    expect([...new Set(specifiers)].sort()).toEqual(["./enrich", "./types", "../company-profile/prototype-companies"].sort());
    expect(source).not.toMatch(/fetch\(|requestJson|axios|zod|schemas|"use client"|useState\(|useEffect\(|QueryClient|enrichJob\(|localStorage/u);
  });
});
