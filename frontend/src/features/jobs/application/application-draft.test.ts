import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { APPLICATION_SOURCE_LABELS, APPLICATION_SOURCES } from "../../candidate/portfolio-model";
import {
  APPLICATION_DRAFT_SOURCE_LABELS,
  APPLICATION_DRAFT_SOURCES,
  MAX_APPLICATION_COVER_LETTER_CODE_POINTS,
  countApplicationCoverLetterCodePoints,
  parseApplicationDraft,
  vacancyApplicationHref,
} from "./application-draft";
import type { ApplicationDraft, ApplicationDraftParseResult } from "./application-draft";

const SOURCE = readFileSync(join(process.cwd(), "src", "features", "jobs", "application", "application-draft.ts"), "utf8");
/** Every module specifier the production model imports; `zod` is the only allowed one. */
const specifiers = (): readonly string[] => [...new Set([...SOURCE.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
/** A valid raw draft with referral source and a blank cover letter unless patched. */
const input = (patch: Partial<{ source: string; coverLetter: string }> = {}): { source: string; coverLetter: string } => ({ source: "referral", coverLetter: "", ...patch });
/** Parses a draft that must succeed and returns its normalized model. */
function draftOf(patch: Partial<{ source: string; coverLetter: string }> = {}): ApplicationDraft {
  const result = parseApplicationDraft(input(patch));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.draft;
}
/** Parses a draft that must fail and returns its issues. */
function issuesOf(raw: unknown): readonly { readonly path: string; readonly message: string }[] {
  const result = parseApplicationDraft(raw as never);
  if (result.ok) throw new Error("expected validation issues");
  return result.issues;
}

describe("application draft model", () => {
  it("keeps the exact ordered source vocabulary and Spanish labels shared with the candidate portfolio", () => {
    expect(APPLICATION_DRAFT_SOURCES).toEqual(["referral", "linkedin", "job_board", "direct", "other"]);
    expect(APPLICATION_DRAFT_SOURCE_LABELS).toEqual({ referral: "Referida", linkedin: "LinkedIn", job_board: "Portal de empleo", direct: "Directa", other: "Otra" });
    expect(APPLICATION_DRAFT_SOURCES).toEqual(APPLICATION_SOURCES);
    expect(APPLICATION_DRAFT_SOURCE_LABELS).toEqual(APPLICATION_SOURCE_LABELS);
  });

  it("exposes a 2000 code point limit and counts one astral emoji as one code point", () => {
    expect(MAX_APPLICATION_COVER_LETTER_CODE_POINTS).toBe(2000);
    expect(countApplicationCoverLetterCodePoints("")).toBe(0);
    expect(countApplicationCoverLetterCodePoints("ab")).toBe(2);
    expect(countApplicationCoverLetterCodePoints("🙂")).toBe(1);
    expect(countApplicationCoverLetterCodePoints("a🙂b")).toBe(3);
    const span = "🙂".repeat(MAX_APPLICATION_COVER_LETTER_CODE_POINTS);
    expect(countApplicationCoverLetterCodePoints(span)).toBe(2000);
    expect(span.length).toBe(4000);
  });

  it("trims a supplied cover letter and collapses whitespace-only input to null", () => {
    expect(draftOf({ coverLetter: "  hola  " }).coverLetter).toBe("hola");
    expect(draftOf({ coverLetter: "hola" }).coverLetter).toBe("hola");
    expect(draftOf({ coverLetter: "" }).coverLetter).toBeNull();
    expect(draftOf({ coverLetter: "   \n\t " }).coverLetter).toBeNull();
  });

  it("accepts exactly 2000 code points and rejects 2001 with a coverLetter issue", () => {
    const pass = "🙂".repeat(MAX_APPLICATION_COVER_LETTER_CODE_POINTS);
    const fail = "🙂".repeat(MAX_APPLICATION_COVER_LETTER_CODE_POINTS + 1);
    expect(draftOf({ coverLetter: pass }).coverLetter).toBe(pass);
    expect(issuesOf({ source: "referral", coverLetter: fail }).map((issue) => issue.path)).toEqual(["coverLetter"]);
  });

  it("requires source inside the closed set and rejects unknown keys", () => {
    expect(draftOf({ source: "job_board" }).source).toBe("job_board");
    expectTypeOf(parseApplicationDraft(input())).toEqualTypeOf<ApplicationDraftParseResult>();
    expect(issuesOf({ coverLetter: "" }).map((issue) => issue.path)).toEqual(["source"]);
    expect(issuesOf({ source: "", coverLetter: "" }).map((issue) => issue.path)).toEqual(["source"]);
    expect(issuesOf(input({ source: "newspaper" })).map((issue) => issue.path)).toEqual(["source"]);
    expect(parseApplicationDraft({ source: "referral", coverLetter: "", extra: true } as never).ok).toBe(false);
    expect(parseApplicationDraft(input()).ok).toBe(true);
  });

  it("builds the canonical postular route as a plain string", () => {
    expect(vacancyApplicationHref("11111111-1111-1111-1111-111111111111")).toBe("/vacantes/11111111-1111-1111-1111-111111111111/postular");
    expectTypeOf(vacancyApplicationHref("x")).toEqualTypeOf<string>();
  });

  it("stays free of fixture, transport, storage, router, browser, timer, and randomness coupling", () => {
    expect(specifiers().every((specifier) => specifier === "zod")).toBe(true);
    expect(SOURCE).not.toMatch(/portfolio|candidate|prototype|CANDIDATE_|public\//u);
    for (const pattern of [/fetch\(|XMLHttpRequest|axios/u, /localStorage|sessionStorage|indexedDB/u, /document\.|window\.|navigator\.|react|"use client"|useRouter|next\/navigation/u, /setTimeout|setInterval|Math\.random|Date\.now|new Date\(|randomUUID/u]) expect(SOURCE).not.toMatch(pattern);
  });
});
