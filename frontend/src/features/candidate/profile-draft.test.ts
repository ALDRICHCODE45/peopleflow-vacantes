import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CandidateProfile, CefrLevel, EducationLevel, SalaryPeriod } from "./model";
import { CANDIDATE_PROFILE } from "./prototype-candidate";
import { parseProfileDraft, profileToDraft } from "./profile-draft";
import type { EditedProfile, CandidateLanguageDraft, CandidateProfileDraft, ProfileDraftIssue, ProfileDraftParseResult } from "./profile-draft";

const SOURCE = readFileSync(join(process.cwd(), "src", "features", "candidate", "profile-draft.ts"), "utf8");
/** Every editable draft key, sorted: the form fields and nothing else. */
const DRAFT_KEYS = ["dial", "birthDate", "location", "currentCompany", "currentSalaryGross", "currentSalaryNet", "education", "expectedSalary", "expectedSalaryPeriod", "seniority", "languages", "linkedinUrl", "phone", "portfolioUrl", "professionalTitle", "salaryCurrency", "skills", "summary", "yearsOfExperience"].sort();
/** The validated profile keys: the draft plus the two server-owned timestamps. */
const PROFILE_KEYS = [...DRAFT_KEYS.filter(key => key !== "dial"), "createdAt", "updatedAt"].sort();
/** Nullable profile fields a blank draft value must clear. */
const NULLABLE_KEYS = ["phone", "linkedinUrl", "portfolioUrl", "professionalTitle", "currentCompany", "yearsOfExperience", "summary", "birthDate", "location", "seniority", "currentSalaryGross", "currentSalaryNet", "expectedSalary", "expectedSalaryPeriod"] as const;
/** A valid profile with every nullable field unset; it also proves baseline timestamp ownership. */
const EMPTY_PROFILE: CandidateProfile = {
  phone: null, linkedinUrl: null, portfolioUrl: null, professionalTitle: null, currentCompany: null, yearsOfExperience: null,
  summary: null, birthDate: null, location: null, seniority: null, education: [], skills: [],
  currentSalaryGross: null, currentSalaryNet: null, expectedSalary: null, salaryCurrency: "MXN", expectedSalaryPeriod: null,
  languages: [], createdAt: "2020-01-02T03:04:05+00:00", updatedAt: "2021-02-03T04:05:06+00:00",
};

/** A fresh editable draft built from the frozen fixture; never shared between cases. */
function freshDraft(): CandidateProfileDraft {
  return profileToDraft(CANDIDATE_PROFILE);
}
/** Mirrors one form edit on top of a fresh draft. */
function draftWith(patch: Partial<CandidateProfileDraft>): CandidateProfileDraft {
  return { ...freshDraft(), ...patch };
}
/** Parses a patched draft that must fail and returns its issues. */
function issuesOf(patch: Partial<CandidateProfileDraft>): readonly ProfileDraftIssue[] {
  const result = parseProfileDraft(draftWith(patch), CANDIDATE_PROFILE);
  if (result.ok) throw new Error(`expected issues for ${JSON.stringify(patch)}`);
  return result.issues;
}
/** The validated profile produced by a patch that must succeed. */
function profileOf(patch: Partial<CandidateProfileDraft>, baseline: CandidateProfile = CANDIDATE_PROFILE): EditedProfile {
  const result = parseProfileDraft(draftWith(patch), baseline);
  if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  return result.profile;
}

describe("candidate profile draft adapter", () => {
  it("round-trips the frozen fixture exactly through the draft", () => {
    const draft = profileToDraft(CANDIDATE_PROFILE);
    expectTypeOf(draft).toEqualTypeOf<CandidateProfileDraft>();
    const result = parseProfileDraft(draft, CANDIDATE_PROFILE);
    if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    expect(result.profile).toEqual({ ...CANDIDATE_PROFILE, location: { country: "MX", state: "09" } });
    expect(result.profile).not.toBe(CANDIDATE_PROFILE);
  });
  it("exposes a discriminated result and form-safe field types", () => {
    expectTypeOf<CandidateProfileDraft["phone"]>().toEqualTypeOf<string>();
    expectTypeOf<CandidateProfileDraft["yearsOfExperience"]>().toEqualTypeOf<string>();
    expectTypeOf<CandidateProfileDraft["education"][number]["level"]>().toEqualTypeOf<"" | EducationLevel>();
    expectTypeOf<CandidateProfileDraft["expectedSalaryPeriod"]>().toEqualTypeOf<"" | SalaryPeriod>();
    expectTypeOf<CandidateLanguageDraft>().toEqualTypeOf<{ code: string; level: "" | CefrLevel }>();
    expectTypeOf<CandidateProfileDraft["languages"]>().toEqualTypeOf<readonly CandidateLanguageDraft[]>();
    expectTypeOf<ProfileDraftIssue>().toEqualTypeOf<{ path: string; message: string }>();
    expectTypeOf(parseProfileDraft(freshDraft(), EMPTY_PROFILE)).toEqualTypeOf<ProfileDraftParseResult>();
  });
  it("maps nulls to empty strings, numbers to decimal strings, and hides timestamps", () => {
    const empty = profileToDraft(EMPTY_PROFILE);
    expect(Object.keys(empty).sort()).toEqual(DRAFT_KEYS);
    expect(empty.dial).toBe("+52");
    expect(Object.entries(empty).filter(([key]) => key !== "dial" && key !== "salaryCurrency" && key !== "languages" && key !== "location" && key !== "education").every(([, value]) => value === "")).toBe(true);
    expect(empty.languages).toEqual([]);
    const fixture = profileToDraft(CANDIDATE_PROFILE);
    expect(fixture.yearsOfExperience).toBe("9");
    expect(fixture.currentSalaryGross).toBe("62000");
    expect(fixture.skills).toBe("react, typescript, node.js, design systems");
    expect(fixture.languages).toEqual([{ code: "es", level: "C2" }, { code: "en", level: "B2" }]);
  });
  it("isolates the draft, the profile, and the baseline", () => {
    const before = JSON.stringify(CANDIDATE_PROFILE);
    const draft = profileToDraft(CANDIDATE_PROFILE);
    expect(draft.languages).not.toBe(CANDIDATE_PROFILE.languages);
    expect(draft.languages[0]).not.toBe(CANDIDATE_PROFILE.languages[0]);
    draft.phone = "cambiado";
    draft.languages[0].code = "cambiado";
    draft.languages[0].level = "A1";
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(before);
    expect(CANDIDATE_PROFILE.phone).toBe("+525548217790");
    expect(CANDIDATE_PROFILE.languages[0]).toEqual({ code: "es", level: "C2" });
  });
  it("clears blank nullable fields to null and never mutates its inputs", () => {
    const blank: Partial<CandidateProfileDraft> = {
      phone: "  ", linkedinUrl: "  ", portfolioUrl: "  ", professionalTitle: "  ", currentCompany: "  ", education: [],
      yearsOfExperience: "", summary: "  ", birthDate: "  ", location: { country: null, state: null, municipality: null, postal_code: null }, skills: "   ",
      currentSalaryGross: "  ", currentSalaryNet: "  ", expectedSalary: "  ", languages: [],
      seniority: "",
      expectedSalaryPeriod: "  " as CandidateProfileDraft["expectedSalaryPeriod"],
    };
    const draft = draftWith(blank);
    const draftBefore = JSON.stringify(draft);
    const baselineBefore = JSON.stringify(CANDIDATE_PROFILE);
    const result = parseProfileDraft(draft, CANDIDATE_PROFILE);
    if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    for (const key of NULLABLE_KEYS) expect(result.profile[key], key).toBeNull();
    expect(result.profile.skills).toEqual([]);
    expect(result.profile.languages).toEqual([]);
    expect(JSON.stringify(draft)).toBe(draftBefore);
    expect(JSON.stringify(CANDIDATE_PROFILE)).toBe(baselineBefore);
  });
  it("parses integer drafts and reports off-spec numbers as field issues", () => {
    const parsed = profileOf({ yearsOfExperience: "12.5", expectedSalary: "75000", currentSalaryGross: "0" });
    expect(parsed.yearsOfExperience).toBe("12.5");
    expect(parsed.expectedSalary).toBe(75000);
    expect(parsed.currentSalaryGross).toBe(0);
    for (const bad of ["9.55", "-1", "1e3", "1E3", "+5", "abc", "5 0", "٣"]) {
      const issues = issuesOf({ yearsOfExperience: bad });
      expect(issues.map((issue) => issue.path), bad).toEqual(["yearsOfExperience"]);
      expect(issues[0].message, bad).toContain("decimal");
    }
    expect(issuesOf({ yearsOfExperience: "61" }).map((issue) => issue.path)).toEqual(["yearsOfExperience"]);
    expect(issuesOf({ expectedSalary: "100000001" }).map((issue) => issue.path)).toEqual(["expectedSalary"]);
  });
  it("uppercases the currency and rejects anything but a three-letter code", () => {
    expect(profileOf({ salaryCurrency: " mxn " }).salaryCurrency).toBe("MXN");
    for (const bad of ["MX", "MXNN", "12A", "m-n", "   "]) {
      const issues = issuesOf({ salaryCurrency: bad });
      expect(issues.map((issue) => issue.path), bad).toEqual(["salaryCurrency"]);
      expect(issues[0].message, bad).toMatch(/moneda/u);
    }
  });
  it("splits, normalizes, and dedupes skills through the shared schema", () => {
    expect(profileOf({ skills: " React , react\n , TypeScript ,NODE.JS, " }).skills).toEqual(["React", "TypeScript", "NODE.JS"]);
    expect(profileOf({ skills: "   " }).skills).toEqual([]);
    expect(issuesOf({ skills: ["a".repeat(61), "react"].join(",") }).map((issue) => issue.path)).toEqual(["skills"]);
    expect(issuesOf({ skills: Array.from({ length: 61 }, (_, index) => `s${index}`).join(",") }).map((issue) => issue.path)).toEqual(["skills"]);
  });
  it("preserves opaque language codes and rejects empty added rows", () => {
    const parsed = profileOf({ languages: [{ code: "local:any", level: "C1" }, { code: "es", level: "native" }] });
    expect(parsed.languages).toEqual([{ code: "local:any", level: "C1" }, { code: "es", level: "native" }]);
    expect(issuesOf({ languages: [{ code: "", level: "" }] }).map(issue => issue.path)).toEqual(["languages.0.code", "languages.0.level"]);
  });
  it("reports partial language rows with field-precise paths", () => {
    const issues = issuesOf({ languages: [{ code: "en", level: "" }, { code: "", level: "B1" }] });
    expect(issues.map((issue) => issue.path)).toEqual(["languages.0.level", "languages.1.code"]);
    expect(issues[0].message).toContain("nivel");
    expect(issues[1].message).toContain("idioma");
    const tooMany = Array.from({ length: 11 }, (_, index) => ({ code: `idioma ${index}`, level: "C2" as CefrLevel }));
    expect(issuesOf({ languages: tooMany }).map((issue) => issue.path)).toEqual(["languages"]);
  });
  it("requires exact uppercase CEFR levels and translates duplicate-language issues", () => {
    const lowercase = issuesOf({ languages: [{ code: "en", level: "b2" as CefrLevel }] });
    expect(lowercase.map((issue) => issue.path)).toEqual(["languages.0.level"]);
    expect(lowercase[0].message).toContain("opción");
    const duplicate = issuesOf({ languages: [{ code: "es", level: "C2" }, { code: "es", level: "B1" }] });
    expect(duplicate.map((issue) => issue.path)).toEqual(["languages.1.code"]);
    expect(duplicate[0].message).toBe("Este idioma ya está agregado.");
  });
  it("rejects bad URLs, dates, enums, and oversized text in Spanish", () => {
    const badUrl = issuesOf({ linkedinUrl: "not-a-url" });
    expect(badUrl.map((issue) => issue.path)).toEqual(["linkedinUrl"]);
    expect(badUrl[0].message).toContain("URL");
    expect(issuesOf({ portfolioUrl: `https://example.com/${"a".repeat(300)}` })[0].message).toContain("300");
    for (const date of ["18/06/1994", "1994-02-31", "1994-6-8"]) {
      const issues = issuesOf({ birthDate: date });
      expect(issues.map((issue) => issue.path), date).toEqual(["birthDate"]);
      expect(issues[0].message, date).toContain("AAAA-MM-DD");
    }
    expect(issuesOf({ education: [{ ...freshDraft().education[0], level: "vocational" as EducationLevel }] })[0].path).toBe("education.0.level");
    expect(issuesOf({ expectedSalaryPeriod: "weekly" as SalaryPeriod })[0].message).toContain("periodo");
    expect(issuesOf({ professionalTitle: "x".repeat(121) })[0].message).toContain("120");
    expect(issuesOf({ summary: "x".repeat(2001) })[0].message).toContain("2000");
  });
  it("returns one deterministic issue per failing path in schema order", () => {
    const issues = issuesOf({
      phone: "123", summary: "x".repeat(2001), education: [{ ...freshDraft().education[0], level: "vocational" as EducationLevel }], expectedSalary: "1.5",
      salaryCurrency: "mx", languages: [{ code: "", level: "B1" }, { code: "en", level: "" }],
    });
    expect(issues.map((issue) => issue.path)).toEqual(["phone", "summary", "education.0.level", "expectedSalary", "salaryCurrency", "languages.0.code", "languages.1.level"]);
    expect(new Set(issues.map((issue) => issue.path)).size).toBe(issues.length);
    expect(issues.every((issue) => issue.message.length > 0)).toBe(true);
    expect(issuesOf({ linkedinUrl: `not a url ${"x".repeat(300)}` }).map((issue) => issue.path)).toEqual(["linkedinUrl"]);
  });
  it("carries only createdAt and updatedAt from the validated baseline", () => {
    const typed = profileOf({ location: { country: "MX", state: "14", municipality: "14039", postal_code: null } }, EMPTY_PROFILE);
    expect(Object.keys(typed).sort()).toEqual(PROFILE_KEYS);
    expect(typed.location).toEqual({ country: "MX", state: "14", municipality: "14039" });
    expect(typed.skills).toEqual(CANDIDATE_PROFILE.skills);
    expect(typed.createdAt).toBe(EMPTY_PROFILE.createdAt);
    expect(typed.updatedAt).toBe(EMPTY_PROFILE.updatedAt);
    expect(typed.createdAt).not.toBe(CANDIDATE_PROFILE.createdAt);
  });
  it("never throws and always answers for hostile string input", () => {
    for (const value of ["", "   ", "🙂", "not-a-url", "999999999999999999999", "1e309", "\u0000", "<script>", "-0", "mxn"]) {
      const result = parseProfileDraft(draftWith({ phone: value, linkedinUrl: value, birthDate: value, yearsOfExperience: value, salaryCurrency: value, skills: value, languages: [{ code: value, level: "C1" }] }), CANDIDATE_PROFILE);
      expect(result.ok, value).toBeTypeOf("boolean");
      if (!result.ok) expect(new Set(result.issues.map((issue) => issue.path)).size, value).toBe(result.issues.length);
    }
  });
  it("stays free of fixture, React, browser, and side-effect coupling", () => {
    expect([...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))]).toEqual(["./model", "@/lib/phone", "@/features/geo/model"]);
    expect(SOURCE).not.toMatch(/prototype-candidate|CANDIDATE_PROFILE/u);
    for (const pattern of [/\bfetch\(|XMLHttpRequest|axios/u, /localStorage|sessionStorage|indexedDB/u, /document\.|window\.|navigator\.|from "react"|"use client"|useRouter/u, /Math\.random|new Date\(|Date\.now|randomUUID/u]) expect(SOURCE).not.toMatch(pattern);
  });
});
