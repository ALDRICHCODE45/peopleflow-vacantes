import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CEFR_LEVEL_LABELS,
  CEFR_LEVELS,
  EDUCATION_LEVEL_LABELS,
  EDUCATION_LEVELS,
  SALARY_PERIOD_LABELS,
  SALARY_PERIODS,
  candidateIdentitySchema,
  candidateLanguageSchema,
  candidateProfileSchema,
  parseCandidateProfile,
} from "./model";
import type { CefrLevel, EducationLevel, SalaryPeriod } from "./model";
import { CANDIDATE_IDENTITY, CANDIDATE_PROFILE } from "./prototype-candidate";

const dir = join(process.cwd(), "src", "features", "candidate");
const modelSource = readFileSync(join(dir, "model.ts"), "utf8");
const fixtureSource = readFileSync(join(dir, "prototype-candidate.ts"), "utf8");
const DICTIONARIES: readonly Readonly<Record<string, string>>[] = [EDUCATION_LEVEL_LABELS, SALARY_PERIOD_LABELS, CEFR_LEVEL_LABELS];
/** One minimal identity the schema must accept, reused to build near-miss cases. */
const IDENTITY_INPUT = {
  userId: "6f1a3c2e-9b4d-4e7a-8c2f-5d3b1a9e7f04",
  email: "ximena.barrera@correo.mx",
  fullName: "Ximena Barrera",
  userType: "candidate",
};
/** A full valid profile copy; spreading it into near-miss cases keeps every other field valid. */
const PROFILE_INPUT = { ...CANDIDATE_PROFILE };

/** Every object reachable from the input, so the freeze check stays deep. */
function reachableObjects(value: unknown): readonly object[] {
  if (typeof value !== "object" || value === null) return [];
  return [value, ...Object.values(value).flatMap(reachableObjects)];
}

/** Module specifiers imported by a source file. */
function modulesOf(source: string): readonly string[] {
  return [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
}

describe("candidate identity and profile model", () => {
  it("validates the frozen fixture at the module boundary", () => {
    expect(candidateIdentitySchema.safeParse(CANDIDATE_IDENTITY).success).toBe(true);
    expect(candidateProfileSchema.safeParse(CANDIDATE_PROFILE).success).toBe(true);
    expect(candidateIdentitySchema.parse(CANDIDATE_IDENTITY)).toEqual(CANDIDATE_IDENTITY);
    expect(parseCandidateProfile(CANDIDATE_PROFILE)).toEqual(CANDIDATE_PROFILE);
    expect(CANDIDATE_IDENTITY.userType).toBe("candidate");
    expect(CANDIDATE_IDENTITY.email).toBe("ximena.barrera@correo.mx");
  });

  it("normalizes and bounds the candidate identity", () => {
    expectTypeOf(CANDIDATE_IDENTITY.userType).toEqualTypeOf<"candidate">();
    const normalized = candidateIdentitySchema.parse({
      ...IDENTITY_INPUT,
      email: " XIMENA.Barrera@Correo.MX ",
      fullName: "  Ximena Barrera  ",
    });
    expect(normalized.email).toBe("ximena.barrera@correo.mx");
    expect(normalized.fullName).toBe("Ximena Barrera");
    const invalid = [
      { userId: "not-a-uuid" }, { userId: "" },
      { email: "ximena.barrera" }, { email: "ximena.barrera@correo" },
      { email: "ximena barrera@correo.mx" }, { fullName: " X" },
      { fullName: "" }, { userType: "recruiter" },
      { userType: "candidate " }, { extra: true },
    ];
    for (const [index, patch] of invalid.entries()) {
      expect(candidateIdentitySchema.safeParse({ ...IDENTITY_INPUT, ...patch }).success, `identity[${index}]`).toBe(false);
    }
  });

  it("normalizes skills and language names exactly like the backend", () => {
    const parsed = candidateProfileSchema.parse({
      ...PROFILE_INPUT,
      skills: [" React ", "react", "TYPESCRIPT", "", "  ", "Node.js", "typescript"],
      languages: [{ name: " Español ", level: "C2" }, { name: "INGLÉS", level: "B2" }],
      educationLevel: " Bachelor ",
      expectedSalaryPeriod: " Monthly ",
    });
    expect(parsed.skills).toEqual(["react", "typescript", "node.js"]);
    expect(parsed.languages).toEqual([{ name: "español", level: "C2" }, { name: "inglés", level: "B2" }]);
    expect(parsed.educationLevel).toBe("bachelor");
    expect(parsed.expectedSalaryPeriod).toBe("monthly");
  });

  it("pins the closed education, salary-period, and CEFR vocabularies", () => {
    expectTypeOf<EducationLevel>().toEqualTypeOf<"high_school" | "bachelor" | "master" | "phd">();
    expectTypeOf<SalaryPeriod>().toEqualTypeOf<"monthly" | "annual">();
    expectTypeOf<CefrLevel>().toEqualTypeOf<"A1" | "A2" | "B1" | "B2" | "C1" | "C2">();
    expect(EDUCATION_LEVELS).toEqual(["high_school", "bachelor", "master", "phd"]);
    expect(SALARY_PERIODS).toEqual(["monthly", "annual"]);
    expect(CEFR_LEVELS).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    expect(EDUCATION_LEVEL_LABELS).toEqual({ high_school: "Preparatoria", bachelor: "Licenciatura", master: "Maestría", phd: "Doctorado" });
    expect(SALARY_PERIOD_LABELS).toEqual({ monthly: "Mensual", annual: "Anual" });
    expect(CEFR_LEVEL_LABELS).toEqual({ A1: "Principiante", A2: "Elemental", B1: "Intermedio", B2: "Intermedio alto", C1: "Avanzado", C2: "Dominio" });
    for (const dictionary of DICTIONARIES) {
      for (const label of Object.values(dictionary)) expect(label.length).toBeGreaterThan(0);
      expect(Object.isFrozen(dictionary)).toBe(true);
    }
  });

  it("mirrors the self-service profile fields without the reserved CV key", () => {
    expect(Object.keys(CANDIDATE_PROFILE).sort()).toEqual([
      "birthDate", "city", "country", "createdAt", "currentCompany", "currentSalaryGross", "currentSalaryNet",
      "educationLevel", "expectedSalary", "expectedSalaryPeriod", "fieldOfStudy", "languages", "linkedinUrl",
      "phone", "portfolioUrl", "professionalTitle", "salaryCurrency", "skills", "summary", "updatedAt",
      "yearsOfExperience",
    ]);
    expect(CANDIDATE_PROFILE.salaryCurrency).toBe("MXN");
    expect(modelSource).not.toContain("cv_s3_key");
    expect(fixtureSource).not.toContain("cv_s3_key");
    expect(Object.keys(CANDIDATE_PROFILE)).not.toContain("cv_s3_key");
  });

  it("rejects unknown vocabulary, malformed profile values, and extra keys", () => {
    const invalid = [
      { educationLevel: "vocational" }, { expectedSalaryPeriod: "weekly" },
      { birthDate: "18/06/1994" }, { yearsOfExperience: -1 },
      { yearsOfExperience: 4.5 }, { yearsOfExperience: 99 },
      { currentSalaryGross: -1 }, { expectedSalary: 1.5 },
      { currentSalaryNet: 999_999_999 }, { linkedinUrl: "not-a-url" },
      { portfolioUrl: "" }, { salaryCurrency: "MX" },
      { salaryCurrency: "MXNN" }, { phone: "123" },
      { summary: "" }, { skills: "react" },
      { skills: [1] }, { languages: [{ name: "español", level: "b2" }] },
      { languages: [{ name: "   ", level: "A1" }] }, { languages: [{ name: "español", level: "Z9" }] },
      { languages: [{ name: "español", level: "B1", extra: true }] }, { createdAt: "2026-02-01" },
      { extra: true },
    ];
    for (const [index, patch] of invalid.entries()) {
      expect(candidateProfileSchema.safeParse({ ...PROFILE_INPUT, ...patch }).success, `profile[${index}]`).toBe(false);
    }
    expect(candidateProfileSchema.safeParse({ ...PROFILE_INPUT, salaryCurrency: undefined }).success).toBe(false);
    expect(() => parseCandidateProfile({ ...PROFILE_INPUT, educationLevel: "vocational" })).toThrow();
  });

  it("rejects language names that duplicate case-insensitively", () => {
    expect(candidateLanguageSchema.safeParse({ name: "Inglés", level: "C1" }).success).toBe(true);
    expect(
      candidateProfileSchema.safeParse({
        ...PROFILE_INPUT,
        languages: [{ name: "Español", level: "C2" }, { name: "español", level: "B1" }],
      }).success,
    ).toBe(false);
  });

  it("deeply freezes every fixture object, list, and label dictionary", () => {
    for (const fixture of [CANDIDATE_IDENTITY, CANDIDATE_PROFILE]) {
      for (const object of reachableObjects(fixture)) expect(Object.isFrozen(object)).toBe(true);
    }
    expect(() => Object.defineProperty(CANDIDATE_PROFILE, "city", { value: "Guadalajara" })).toThrow();
    expect(() => Object.defineProperty(CANDIDATE_PROFILE.skills, "0", { value: "vue" })).toThrow();
    expect(() => Object.defineProperty(CANDIDATE_PROFILE.languages[0], "level", { value: "A1" })).toThrow();
    expect(() => Object.defineProperty(CANDIDATE_IDENTITY, "userType", { value: "recruiter" })).toThrow();
  });

  it("stays free of React, browser, transport, and employer coupling", () => {
    expect(modulesOf(modelSource)).toEqual(["zod"]);
    expect(modulesOf(fixtureSource)).toEqual(["./model"]);
    for (const source of [modelSource, fixtureSource]) {
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|localStorage|sessionStorage/u);
      expect(source).not.toMatch(/document\.|window\.|navigator\.|from "react"|"use client"/u);
      expect(source).not.toMatch(/Math\.random|new Date\(|Date\.now|randomUUID/u);
      expect(source).not.toMatch(/employer-team|employer-vacancies|company-profile|prototype-team|prototype-vacancies/u);
    }
  });
});
