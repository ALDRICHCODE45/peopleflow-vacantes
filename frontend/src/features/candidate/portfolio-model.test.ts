import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  APPLICATION_SOURCES, APPLICATION_SOURCE_LABELS, APPLICATION_STATUSES, APPLICATION_STATUS_LABELS,
  CV_LANGUAGES, CV_LANGUAGE_LABELS, applicationInProcessCount, applicationPublicJobHref, applicationTotalCount,
  candidateApplicationSchema, candidateApplicationViewSchema, candidateApplicationViewsSchema, candidateCvSchema,
  candidateCvsSchema, countApplicationsByStatus, findPrimaryCv, parseCandidateApplicationViews, parseCandidateCvs, summarizeCvs,
} from "./portfolio-model";
import type { ApplicationSource, ApplicationStatus, CvLanguage } from "./portfolio-model";
import { CANDIDATE_APPLICATIONS, CANDIDATE_CVS } from "./prototype-portfolio";

const dir = join(process.cwd(), "src", "features", "candidate");
const modelSource = readFileSync(join(dir, "portfolio-model.ts"), "utf8");
const fixtureSource = readFileSync(join(dir, "prototype-portfolio.ts"), "utf8");
const DICTIONARIES: readonly Readonly<Record<string, string>>[] = [APPLICATION_STATUS_LABELS, APPLICATION_SOURCE_LABELS, CV_LANGUAGE_LABELS];
const FRONTEND_JOB_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e";
const GO_JOB_ID = "0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d92";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** Base application facts without the candidate-only public link field. */
const BASE_APPLICATION: Record<string, unknown> = Object.fromEntries(
  Object.entries(CANDIDATE_APPLICATIONS[0]).filter(([key]) => key !== "publicJobHref"),
);
const BASE_HREF = applicationPublicJobHref(String(BASE_APPLICATION.jobId));
const CV_INPUT = { ...CANDIDATE_CVS[0] };
/** Every object reachable from the input, so the freeze check stays deep. */
function reachableObjects(value: unknown): readonly object[] {
  if (typeof value !== "object" || value === null) return [];
  return [value, ...Object.values(value).flatMap(reachableObjects)];
}
/** Module specifiers imported by a source file. */
function modulesOf(source: string): readonly string[] {
  return [...new Set([...source.matchAll(/from "([^"]+)"/gu)].map((match) => match[1]))];
}

describe("candidate application and CV portfolio model", () => {
  it("validates every frozen fixture at the module boundary", () => {
    expect(parseCandidateApplicationViews(CANDIDATE_APPLICATIONS)).toEqual(CANDIDATE_APPLICATIONS);
    expect(parseCandidateCvs(CANDIDATE_CVS)).toEqual(CANDIDATE_CVS);
    expect(CANDIDATE_APPLICATIONS).toHaveLength(4);
    expect(CANDIDATE_CVS).toHaveLength(2);
  });

  it("pins the exact status, source, and CV-language vocabularies and Spanish labels", () => {
    expectTypeOf<ApplicationStatus>().toEqualTypeOf<"submitted" | "in_review" | "hired" | "rejected">();
    expectTypeOf<ApplicationSource>().toEqualTypeOf<"referral" | "linkedin" | "job_board" | "direct" | "other">();
    expectTypeOf<CvLanguage>().toEqualTypeOf<"es" | "en">();
    expect(APPLICATION_STATUSES).toEqual(["submitted", "in_review", "hired", "rejected"]);
    expect(APPLICATION_SOURCES).toEqual(["referral", "linkedin", "job_board", "direct", "other"]);
    expect(CV_LANGUAGES).toEqual(["es", "en"]);
    expect(APPLICATION_STATUS_LABELS).toEqual({ submitted: "Enviada", in_review: "En revisión", hired: "Contratada", rejected: "Rechazada" });
    expect(APPLICATION_SOURCE_LABELS).toEqual({ referral: "Referida", linkedin: "LinkedIn", job_board: "Portal de empleo", direct: "Directa", other: "Otra" });
    expect(CV_LANGUAGE_LABELS).toEqual({ es: "Español", en: "Inglés" });
    for (const dictionary of DICTIONARIES) {
      for (const label of Object.values(dictionary)) expect(label.length).toBeGreaterThan(0);
      expect(Object.isFrozen(dictionary)).toBe(true);
    }
  });

  it("covers all four statuses with four distinct representative sources", () => {
    expect(CANDIDATE_APPLICATIONS.map((application) => application.status)).toEqual(["submitted", "in_review", "hired", "rejected"]);
    expect(new Set(CANDIDATE_APPLICATIONS.map((application) => application.status)).size).toBe(4);
    expect(new Set(CANDIDATE_APPLICATIONS.map((application) => application.source)).size).toBe(4);
  });

  it("resolves exactly two canonical public links and two honest null links", () => {
    const linked = CANDIDATE_APPLICATIONS.filter((application) => application.publicJobHref !== null);
    const historical = CANDIDATE_APPLICATIONS.filter((application) => application.publicJobHref === null);
    expect(linked.map((application) => [application.jobId, application.publicJobHref])).toEqual([
      [GO_JOB_ID, `/vacantes/${GO_JOB_ID}`],
      [FRONTEND_JOB_ID, `/vacantes/${FRONTEND_JOB_ID}`],
    ]);
    expect(applicationPublicJobHref(FRONTEND_JOB_ID)).toBe(`/vacantes/${FRONTEND_JOB_ID}`);
    expect(historical).toHaveLength(2);
    for (const application of historical) {
      expect(application.jobId).toMatch(UUID);
      expect([FRONTEND_JOB_ID, GO_JOB_ID]).not.toContain(application.jobId);
    }
    expect(new Set(CANDIDATE_APPLICATIONS.map((application) => application.jobId)).size).toBe(4);
    expect(candidateApplicationViewSchema.safeParse({ ...BASE_APPLICATION, publicJobHref: BASE_HREF }).success).toBe(true);
    expect(candidateApplicationViewSchema.safeParse({ ...BASE_APPLICATION, publicJobHref: `${BASE_HREF}/` }).success).toBe(false);
    expect(candidateApplicationViewSchema.safeParse({ ...BASE_APPLICATION, publicJobHref: "/vacantes/otro" }).success).toBe(false);
    expect(candidateApplicationViewSchema.safeParse({ ...BASE_APPLICATION, publicJobHref: null }).success).toBe(true);
  });

  it("rejects duplicate application ids, duplicate job ids, and reversed timestamps", () => {
    const [first, second] = CANDIDATE_APPLICATIONS;
    expect(candidateApplicationViewsSchema.safeParse([first, { ...second, id: first.id }]).success).toBe(false);
    expect(candidateApplicationViewsSchema.safeParse([first, { ...second, jobId: first.jobId, publicJobHref: null }]).success).toBe(false);
    expect(candidateApplicationSchema.safeParse(BASE_APPLICATION).success).toBe(true);
    expect(candidateApplicationSchema.safeParse({ ...BASE_APPLICATION, updatedAt: "2020-01-01T00:00:00-06:00" }).success).toBe(false);
    expect(candidateApplicationViewSchema.safeParse({ ...BASE_APPLICATION, updatedAt: "2020-01-01T00:00:00-06:00", publicJobHref: null }).success).toBe(false);
  });

  it("summarizes statuses and in-process totals purely from the input", () => {
    const counts = countApplicationsByStatus(CANDIDATE_APPLICATIONS);
    expect(counts).toEqual({ submitted: 1, in_review: 1, hired: 1, rejected: 1 });
    expect(applicationInProcessCount(counts)).toBe(2);
    expect(applicationTotalCount(counts)).toBe(4);
    expect(countApplicationsByStatus([])).toEqual({ submitted: 0, in_review: 0, hired: 0, rejected: 0 });
    expect(applicationInProcessCount(countApplicationsByStatus([]))).toBe(0);
    expect(applicationTotalCount(countApplicationsByStatus([]))).toBe(0);
  });

  it("rejects malformed application facts and extra keys", () => {
    const invalid: readonly Record<string, unknown>[] = [
      { id: "not-a-uuid" }, { jobId: "nope" }, { companyId: "nope" }, { jobTitle: "" }, { jobTitle: "  " }, { companyName: "" },
      { coverLetter: "" }, { coverLetter: "x".repeat(2001) }, { status: "screening" }, { source: "newspaper" },
      { createdAt: "2026-02-20" }, { updatedAt: "2026-03-01" }, { extra: true },
    ];
    for (const [index, patch] of invalid.entries()) {
      expect(candidateApplicationSchema.safeParse({ ...BASE_APPLICATION, ...patch }).success, `application[${index}]`).toBe(false);
    }
  });

  it("mirrors strict CV metadata with no URL, upload, or generated state", () => {
    expect(Object.keys(CANDIDATE_CVS[0]).sort()).toEqual(["fileName", "id", "isPrimary", "label", "language", "sizeBytes", "updatedAt"]);
    expect(Object.keys(CANDIDATE_APPLICATIONS[0]).sort()).toEqual([
      "companyId", "companyName", "coverLetter", "createdAt", "id", "jobId", "jobTitle", "publicJobHref", "source", "status", "updatedAt",
    ]);
    const invalid: readonly Record<string, unknown>[] = [
      { id: "CV Principal" }, { label: "" }, { fileName: "cv.docx" }, { fileName: "cv" }, { language: "fr" }, { sizeBytes: 0 },
      { sizeBytes: -1 }, { sizeBytes: 10 * 1024 * 1024 + 1 }, { sizeBytes: 1.5 }, { updatedAt: "2026-03-10" }, { isPrimary: "yes" },
      { url: "https://example.test/cv.pdf" }, { uploadKey: "abc" }, { status: "uploaded" }, { downloadUrl: "https://example.test" },
      { generatedAt: "2026-03-10T10:00:00-06:00" }, { parsedAt: "2026-03-10T10:00:00-06:00" }, { callback: () => {} }, { extra: true },
    ];
    for (const [index, patch] of invalid.entries()) {
      expect(candidateCvSchema.safeParse({ ...CV_INPUT, ...patch }).success, `cv[${index}]`).toBe(false);
    }
    expect(candidateCvSchema.safeParse(CV_INPUT).success).toBe(true);
  });

  it("requires exactly one primary CV and unique ids and filenames", () => {
    const [primary, secondary] = CANDIDATE_CVS;
    expect(CANDIDATE_CVS.map((cv) => cv.language)).toEqual(["es", "en"]);
    expect(CANDIDATE_CVS.filter((cv) => cv.isPrimary)).toHaveLength(1);
    expect(candidateCvsSchema.safeParse([primary, { ...secondary, isPrimary: true }]).success).toBe(false);
    expect(candidateCvsSchema.safeParse([{ ...primary, isPrimary: false }, secondary]).success).toBe(false);
    expect(candidateCvsSchema.safeParse([primary, { ...secondary, id: primary.id }]).success).toBe(false);
    expect(candidateCvsSchema.safeParse([primary, { ...secondary, fileName: primary.fileName }]).success).toBe(false);
    expect(candidateCvsSchema.safeParse([]).success).toBe(false);
    expect(findPrimaryCv(CANDIDATE_CVS)).toBe(primary);
    expect(findPrimaryCv([])).toBeUndefined();
    expect(summarizeCvs(CANDIDATE_CVS)).toEqual({ total: 2, primary });
  });

  it("deeply freezes every fixture object, list, and label dictionary", () => {
    for (const fixture of [CANDIDATE_APPLICATIONS, CANDIDATE_CVS]) {
      for (const object of reachableObjects(fixture)) expect(Object.isFrozen(object)).toBe(true);
    }
    for (const dictionary of DICTIONARIES) for (const object of reachableObjects(dictionary)) expect(Object.isFrozen(object)).toBe(true);
    expect(() => Object.defineProperty(CANDIDATE_APPLICATIONS[0], "status", { value: "hired" })).toThrow();
    expect(() => Object.defineProperty(CANDIDATE_CVS[0], "isPrimary", { value: false })).toThrow();
    expect(() => Object.defineProperty(CV_LANGUAGE_LABELS, "es", { value: "Inglés" })).toThrow();
  });

  it("stays free of React, browser, storage, transport, employer, and public coupling", () => {
    expect(modulesOf(modelSource)).toEqual(["zod"]);
    expect(modulesOf(fixtureSource)).toEqual(["./portfolio-model"]);
    for (const source of [modelSource, fixtureSource]) {
      expect(source).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|localStorage|sessionStorage|indexedDB/u);
      expect(source).not.toMatch(/document\.|window\.|navigator\.|from "react"|"use client"/u);
      expect(source).not.toMatch(/Math\.random|new Date\(|Date\.now|randomUUID/u);
      expect(source).not.toMatch(/uploadKey|downloadUrl|generatedAt|parsedAt|aiStatus/u);
      expect(source).not.toMatch(/employer-vacancies|employer-team|company-profile|prototype-jobs|features\/jobs|prototype-vacancies|prototype-companies/u);
    }
  });
});
