import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  EMPLOYER_EMPLOYMENT_TYPE_LABELS,
  EMPLOYER_VACANCY_STATE_LABELS,
  EMPLOYER_WORK_MODE_LABELS,
  employerVacancySchema,
  employerVacanciesSchema,
  findEmployerVacancy,
  parseEmployerVacancies,
  summarizeEmployerVacancies,
  vacancyCandidateTotal,
  vacancyInProcessCount,
  vacancyPipelineHref,
} from "./model";
import type { EmployerVacancyState, VacancyPipelineStage } from "./model";
import { NEXO_VACANCIES } from "./prototype-vacancies";

const dir = join(process.cwd(), "src", "features", "employer-vacancies");
const modelSource = readFileSync(join(dir, "model.ts"), "utf8");
const fixtureSource = readFileSync(join(dir, "prototype-vacancies.ts"), "utf8");
const STAGES: readonly VacancyPipelineStage[] = ["submitted", "in_review", "hired", "rejected"];
const STATE_LABELS = EMPLOYER_VACANCY_STATE_LABELS;
const DICTIONARIES = [STATE_LABELS, EMPLOYER_WORK_MODE_LABELS, EMPLOYER_EMPLOYMENT_TYPE_LABELS];
/** One minimal input the schema must accept, used to build the near-miss cases. */
const VALID_INPUT = { id: "backend-developer-senior", title: "Backend Developer (Senior)", workMode: "remote", employmentType: "full_time", state: "active", publishedAt: "2026-03-09T15:00:00Z", recruiter: "Valeria Ortiz", teamSize: 6, candidateCounts: { submitted: 3, in_review: 2, hired: 0, rejected: 1 } };
/** Every object reachable from the fixtures, so the freeze check stays deep. */
function reachableObjects(value: unknown): readonly object[] {
  if (typeof value !== "object" || value === null) return [];
  return [value, ...Object.values(value).flatMap(reachableObjects)];
}
describe("employer vacancy fixtures", () => {
  it("validates every fixture at the module boundary", () => {
    expect(NEXO_VACANCIES.length).toBeGreaterThanOrEqual(5);
    expect(parseEmployerVacancies(NEXO_VACANCIES)).toEqual(NEXO_VACANCIES);
    for (const vacancy of NEXO_VACANCIES) expect(employerVacancySchema.safeParse(vacancy).success, vacancy.id).toBe(true);
  });
  it("uses a closed local state vocabulary covering the committed design states", () => {
    expectTypeOf<EmployerVacancyState>().toEqualTypeOf<"active" | "paused" | "closed">();
    expect(STATE_LABELS).toEqual({ active: "Activa", paused: "Pausada", closed: "Cerrada" });
    expect(new Set(NEXO_VACANCIES.map((vacancy) => vacancy.state))).toEqual(new Set(["active", "paused", "closed"]));
    for (const vacancy of NEXO_VACANCIES) expect(STATE_LABELS[vacancy.state].length).toBeGreaterThan(0);
    expect([EMPLOYER_WORK_MODE_LABELS.remote, EMPLOYER_WORK_MODE_LABELS.hybrid]).toEqual(["Remoto", "Híbrido"]);
    expect(EMPLOYER_EMPLOYMENT_TYPE_LABELS.full_time).toBe("Tiempo completo");
  });
  it("counts candidates only across the four application stages", () => {
    for (const vacancy of NEXO_VACANCIES) {
      expect(Object.keys(vacancy.candidateCounts).sort(), vacancy.id).toEqual([...STAGES].sort());
      for (const stage of STAGES) {
        const value = vacancy.candidateCounts[stage];
        expect([Number.isInteger(value), value >= 0], `${vacancy.id}:${stage}`).toEqual([true, true]);
      }
    }
  });
  it("derives exact per-vacancy totals and the portfolio summary", () => {
    expect(NEXO_VACANCIES.map((vacancy) => vacancyInProcessCount(vacancy.candidateCounts))).toEqual([5, 11, 8, 5, 0, 1]);
    expect(NEXO_VACANCIES.map((vacancy) => vacancyCandidateTotal(vacancy.candidateCounts))).toEqual([7, 15, 11, 6, 9, 4]);
    expect(summarizeEmployerVacancies(NEXO_VACANCIES)).toEqual({ total: 6, active: 3, paused: 1, closed: 2, totalCandidates: 52, inProcessCandidates: 30 });
    expect(summarizeEmployerVacancies([])).toEqual({ total: 0, active: 0, paused: 0, closed: 0, totalCandidates: 0, inProcessCandidates: 0 });
    expect(vacancyInProcessCount({ submitted: 0, in_review: 0, hired: 4, rejected: 5 })).toBe(0);
  });
  it("exposes unique stable ids and one canonical pipeline URL each", () => {
    const ids = NEXO_VACANCIES.map((vacancy) => vacancy.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))).toBe(true);
    expect(vacancyPipelineHref("backend-developer-senior")).toBe("/empresa/vacantes/backend-developer-senior/pipeline");
    const hrefs = NEXO_VACANCIES.map((vacancy) => vacancyPipelineHref(vacancy.id));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href).toMatch(/^\/empresa\/vacantes\/[^/]+\/pipeline$/u);
  });
  it("freezes every fixture, nested block, and label dictionary", () => {
    for (const object of reachableObjects(NEXO_VACANCIES)) expect(Object.isFrozen(object)).toBe(true);
    for (const dictionary of DICTIONARIES) expect(Object.isFrozen(dictionary)).toBe(true);
    for (const vacancy of NEXO_VACANCIES) {
      expect(() => Object.defineProperty(vacancy, "title", { value: "Otra" })).toThrow();
      expect(() => Object.defineProperty(vacancy.candidateCounts, "submitted", { value: 99 })).toThrow();
    }
  });
  it("rejects invalid state, count, timestamp, and unknown shape", () => {
    const invalid = [
      { ...VALID_INPUT, state: "archived" },
      { ...VALID_INPUT, state: "Activa" },
      { ...VALID_INPUT, candidateCounts: { ...VALID_INPUT.candidateCounts, submitted: -1 } },
      { ...VALID_INPUT, candidateCounts: { ...VALID_INPUT.candidateCounts, in_review: 1.5 } },
      { ...VALID_INPUT, candidateCounts: { ...VALID_INPUT.candidateCounts, interview: 2 } },
      { ...VALID_INPUT, candidateCounts: { submitted: 1, in_review: 1, hired: 1 } },
      { ...VALID_INPUT, publishedAt: "2026-03-09" },
      { ...VALID_INPUT, publishedAt: "hace 5 días" },
      { ...VALID_INPUT, teamSize: -2 },
      { ...VALID_INPUT, id: "Backend Developer" },
      { ...VALID_INPUT, workMode: "flexible" },
      { ...VALID_INPUT, employmentType: "freelance" },
      { ...VALID_INPUT, headline: "extra" },
    ];
    for (const [index, input] of invalid.entries()) expect(employerVacancySchema.safeParse(input).success, `invalid[${index}]`).toBe(false);
    expect(() => parseEmployerVacancies([{ ...VALID_INPUT, state: "nope" }])).toThrow();
    // The portfolio boundary validates the whole list: a single bad member or a non-array rejects it.
    expect(employerVacanciesSchema.safeParse({ ...VALID_INPUT }).success).toBe(false);
    expect(employerVacanciesSchema.safeParse([VALID_INPUT, { ...VALID_INPUT, state: "nope" }]).success).toBe(false);
    expect(employerVacanciesSchema.safeParse([VALID_INPUT]).success).toBe(true);
  });
  it("resolves exact ids only and never mutates the fixture list", () => {
    expect(NEXO_VACANCIES.map((vacancy) => vacancy.id)).toEqual(["backend-developer-senior", "frontend-engineer-react", "fullstack-developer", "devops-engineer", "qa-automation-engineer", "data-analyst"]);
    for (const jobId of ["", "backend-developer", "backend-developer-senior ", "Backend-Developer-Senior", "nexo-labs"]) {
      expect(findEmployerVacancy(NEXO_VACANCIES, jobId), jobId).toBeUndefined();
    }
    expect(findEmployerVacancy([], "backend-developer-senior")).toBeUndefined();
    expect(findEmployerVacancy(NEXO_VACANCIES, "frontend-engineer-react")).toBe(NEXO_VACANCIES[1]);
    expect(NEXO_VACANCIES.map((vacancy) => vacancy.id)).toHaveLength(6);
  });
  it("stays free of transport, React, browser, and backend schema imports", () => {
    const modulesOf = (source: string): readonly string[] => [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
    expect(modulesOf(modelSource)).toEqual(["zod"]);
    expect(modulesOf(fixtureSource)).toEqual(["./model"]);
    for (const source of [modelSource, fixtureSource]) {
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|window\.|document\.|useState\(|useEffect\(|"use client"/u);
      expect(source).not.toMatch(/Date\.now|Math\.random|new Date\(|randomUUID/u);
      expect(source).not.toMatch(/jobItemSchema|features\/jobs|company-dashboard|prototype-jobs/u);
    }
  });
});
