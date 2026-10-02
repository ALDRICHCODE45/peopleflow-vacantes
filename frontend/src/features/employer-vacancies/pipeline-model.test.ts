import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { VACANCY_PIPELINE_STAGES } from "./model";
import type { VacancyPipelineStage } from "./model";
import { NEXO_VACANCIES } from "./prototype-vacancies";
import {
  CANDIDATE_SOURCE_LABELS,
  CANDIDATE_SOURCES,
  CANDIDATE_STATUS_LABELS,
  filterCandidatesByVacancy,
  findCandidateById,
  parsePipelineCandidates,
  pipelineCandidateSchema,
  pipelineCandidatesSchema,
  summarizeCandidateStages,
  visibleCandidatesCopy,
} from "./pipeline-model";
import type { CandidateSource, CandidateStatus } from "./pipeline-model";
import { NEXO_CANDIDATES } from "./prototype-candidates";

const dir = join(process.cwd(), "src", "features", "employer-vacancies");
const modelSource = readFileSync(join(dir, "pipeline-model.ts"), "utf8");
const fixtureSource = readFileSync(join(dir, "prototype-candidates.ts"), "utf8");
const ALL_STATUSES = new Set<string>(VACANCY_PIPELINE_STAGES);
const ALL_SOURCES = new Set<string>(CANDIDATE_SOURCES);
const INVENTED_STAGES = ["screening", "interview", "entrevista", "offer"];

describe("pipeline candidate fixtures", () => {
  it("validates every fixture at the module boundary", () => {
    expect(NEXO_CANDIDATES.length).toBeGreaterThanOrEqual(10);
    expect(parsePipelineCandidates(NEXO_CANDIDATES)).toEqual(NEXO_CANDIDATES);
    for (const candidate of NEXO_CANDIDATES) expect(pipelineCandidateSchema.safeParse(candidate).success, candidate.id).toBe(true);
  });

  it("uses only the committed application statuses and prototype sources", () => {
    expectTypeOf<CandidateStatus>().toEqualTypeOf<VacancyPipelineStage>();
    expectTypeOf<CandidateSource>().toEqualTypeOf<"direct" | "referral" | "linkedin" | "job_board" | "other">();
    expect(CANDIDATE_STATUS_LABELS).toEqual({ submitted: "Nuevos", in_review: "En revisión", hired: "Contratados", rejected: "Descartados" });
    expect(CANDIDATE_SOURCE_LABELS).toEqual({ direct: "Directo", referral: "Referido", linkedin: "LinkedIn", job_board: "Portal de empleo", other: "Otro" });
    expect(Object.keys(CANDIDATE_STATUS_LABELS).sort()).toEqual([...VACANCY_PIPELINE_STAGES].sort());
    expect(new Set(NEXO_CANDIDATES.map((candidate) => candidate.status))).toEqual(ALL_STATUSES);
    expect(new Set(NEXO_CANDIDATES.map((candidate) => candidate.source))).toEqual(ALL_SOURCES);
    for (const candidate of NEXO_CANDIDATES) {
      expect(ALL_STATUSES.has(candidate.status), candidate.id).toBe(true);
      expect(ALL_SOURCES.has(candidate.source), candidate.id).toBe(true);
      expect(INVENTED_STAGES.includes(candidate.status), candidate.id).toBe(false);
    }
  });

  it("keeps every vacancy and stage within its own portfolio counters", () => {
    const vacancyIds = NEXO_VACANCIES.map((vacancy) => vacancy.id);
    expect(new Set(NEXO_CANDIDATES.map((candidate) => candidate.vacancyId))).toEqual(new Set(vacancyIds));
    for (const vacancy of NEXO_VACANCIES) {
      const cards = filterCandidatesByVacancy(NEXO_CANDIDATES, vacancy.id);
      expect(cards.length, vacancy.id).toBeGreaterThanOrEqual(1);
      // Demo cards are a representative local subset: every stage stays within its own counter.
      const demoStages = summarizeCandidateStages(cards);
      for (const stage of VACANCY_PIPELINE_STAGES) {
        expect(demoStages[stage], `${vacancy.id}:${stage}`).toBeLessThanOrEqual(vacancy.candidateCounts[stage]);
      }
    }
  });

  it("shows all four backend stages and keeps deterministic order and exact helpers", () => {
    const backend = filterCandidatesByVacancy(NEXO_CANDIDATES, "backend-developer-senior");
    expect(new Set(backend.map((candidate) => candidate.status))).toEqual(ALL_STATUSES);
    expect(summarizeCandidateStages(backend)).toEqual({ submitted: 1, in_review: 1, hired: 1, rejected: 1 });
    expect(NEXO_CANDIDATES.map((candidate) => candidate.id)).toEqual(["lucia-fernandez", "diego-salazar", "renata-vargas", "martin-bustos", "sofia-medina", "tomas-aguiar", "camila-rojas", "paula-quintero", "hector-navarro", "ines-cordero"]);
    expect(backend.map((candidate) => candidate.id)).toEqual(["lucia-fernandez", "diego-salazar", "renata-vargas", "martin-bustos"]);
    expect(filterCandidatesByVacancy(NEXO_CANDIDATES, "no-such-vacancy")).toEqual([]);
    expect(summarizeCandidateStages(NEXO_CANDIDATES)).toEqual({ submitted: 3, in_review: 3, hired: 3, rejected: 1 });
    expect(summarizeCandidateStages([])).toEqual({ submitted: 0, in_review: 0, hired: 0, rejected: 0 });
    expect(visibleCandidatesCopy(4, 7)).toBe("Mostrando 4 de 7 candidatos de esta vacante.");
    expect(visibleCandidatesCopy(4, 7)).not.toMatch(/portfolio/u);
    expect(visibleCandidatesCopy(4, 7)).not.toMatch(/demostración|prototipo|vista de/iu);
  });

  it("exposes unique ids, exact lookup, and deep immutability", () => {
    const ids = NEXO_CANDIDATES.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))).toBe(true);
    for (const id of ["", "lucia", "Lucia-Fernandez", "lucia-fernandez "]) expect(findCandidateById(NEXO_CANDIDATES, id), id).toBeUndefined();
    expect(findCandidateById([], "lucia-fernandez")).toBeUndefined();
    expect(findCandidateById(NEXO_CANDIDATES, "renata-vargas")).toBe(NEXO_CANDIDATES[2]);
    for (const candidate of NEXO_CANDIDATES) {
      expect(Object.isFrozen(candidate)).toBe(true);
      expect(Object.isFrozen(candidate.skills)).toBe(true);
      expect(() => Object.defineProperty(candidate, "fullName", { value: "Otra" })).toThrow();
      expect(() => Object.defineProperty(candidate.skills, "0", { value: "Otro" })).toThrow();
    }
    expect(Object.isFrozen(CANDIDATE_STATUS_LABELS)).toBe(true);
    expect(Object.isFrozen(CANDIDATE_SOURCE_LABELS)).toBe(true);
  });

  it("rejects invalid score, count, date, tags, status, source, and extra keys", () => {
    const base = NEXO_CANDIDATES[0]!;
    const invalid: readonly unknown[] = [
      { ...base, matchScore: -1 }, { ...base, matchScore: 101 }, { ...base, matchScore: 88.5 },
      { ...base, commentCount: -1 }, { ...base, commentCount: 2.5 },
      { ...base, yearsOfExperience: -1 }, { ...base, yearsOfExperience: 1.5 },
      { ...base, receivedAt: "2026-03-10" }, { ...base, receivedAt: "hace 2 días" },
      { ...base, lastActivityAt: "2026-03-10T09:15:00" },
      { ...base, skills: [] }, { ...base, skills: ["", "React"] }, { ...base, skills: ["   "] },
      { ...base, skills: ["a", "b", "c", "d", "e"] },
      { ...base, status: "screening" }, { ...base, status: "En revisión" },
      { ...base, source: "agency" }, { ...base, source: "LinkedIn" },
      { ...base, id: "Lucia Fernandez" }, { ...base, vacancyId: "Backend Developer" },
      { ...base, fullName: "" }, { ...base, owner: "" },
      { ...base, nextStep: "" }, { ...base, nextStep: "x".repeat(81) },
      { ...base, extra: true },
    ];
    for (const [index, input] of invalid.entries()) expect(pipelineCandidateSchema.safeParse(input).success, `invalid[${index}]`).toBe(false);
    expect(pipelineCandidatesSchema.safeParse(base).success).toBe(false);
    expect(pipelineCandidatesSchema.safeParse([base, { ...base, status: "nope" }]).success).toBe(false);
    expect(pipelineCandidatesSchema.safeParse([base]).success).toBe(true);
  });

  it("trims padded text and rejects whitespace, oversized, and oversized collections", () => {
    const base = NEXO_CANDIDATES[0]!;
    expect(pipelineCandidateSchema.parse({ ...base, fullName: "  Lucía Fernández  ", owner: " Valeria Ortiz " })).toMatchObject({ fullName: "Lucía Fernández", owner: "Valeria Ortiz" });
    const invalid: readonly unknown[] = [
      { ...base, id: "a".repeat(65) },
      { ...base, fullName: "   " }, { ...base, fullName: "L".repeat(121) },
      { ...base, professionalTitle: "  " }, { ...base, owner: "   " },
      { ...base, yearsOfExperience: 61 }, { ...base, commentCount: 10001 },
      { ...base, skills: ["s".repeat(41)] },
    ];
    for (const [index, input] of invalid.entries()) expect(pipelineCandidateSchema.safeParse(input).success, `bounds[${index}]`).toBe(false);
    expect(pipelineCandidatesSchema.safeParse(Array.from({ length: 501 }, () => base)).success).toBe(false);
    expect(pipelineCandidatesSchema.safeParse(Array.from({ length: 500 }, () => base)).success).toBe(true);
  });

  it("stays free of React, browser, transport, and public job imports", () => {
    const modulesOf = (source: string): readonly string[] => [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
    expect(modulesOf(modelSource)).toEqual(["zod", "./model"]);
    expect(modulesOf(fixtureSource)).toEqual(["./pipeline-model"]);
    for (const source of [modelSource, fixtureSource]) {
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|window\.|document\.|useState\(|useEffect\(|"use client"/u);
      expect(source).not.toMatch(/Date\.now|Math\.random|new Date\(|randomUUID/u);
      expect(source).not.toMatch(/jobItemSchema|features\/jobs|company-dashboard|prototype-jobs/u);
    }
  });
});

describe("visibleCandidatesCopy count agreement", () => {
  it("uses the singular noun when the vacancy total is one", () => {
    expect(visibleCandidatesCopy(1, 1)).toBe("Mostrando 1 de 1 candidato de esta vacante.");
    expect(visibleCandidatesCopy(1, 1)).not.toContain("candidatos");
    expect(visibleCandidatesCopy(1, 1)).not.toMatch(/demostración|prototipo|vista de/iu);
  });

  it("keeps the plural noun for plural or zero totals", () => {
    expect(visibleCandidatesCopy(1, 7)).toBe("Mostrando 1 de 7 candidatos de esta vacante.");
    expect(visibleCandidatesCopy(0, 7)).toBe("Mostrando 0 de 7 candidatos de esta vacante.");
    expect(visibleCandidatesCopy(0, 7)).not.toMatch(/demostración|prototipo|vista de/iu);
  });
});
