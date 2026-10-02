import { z } from "zod";

/**
 * Candidate-owned portfolio contracts for `/candidato`: the strict application
 * facts the candidate sees plus prototype-local CV metadata. It imports only
 * zod, so no public/employer feature module, transport, storage, browser API,
 * React, or callback is reachable from here; nothing is fetched or persisted.
 */
/** Exact candidate-facing application statuses; mirrors the backend parser. */
export const APPLICATION_STATUSES = ["submitted", "in_review", "hired", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
/** Exact application sources; declares how the candidate learned about a job. */
export const APPLICATION_SOURCES = ["referral", "linkedin", "job_board", "direct", "other"] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];
/** Languages a prototype-local CV can be written in. */
export const CV_LANGUAGES = ["es", "en"] as const;
export type CvLanguage = (typeof CV_LANGUAGES)[number];
/** Spanish display labels for the closed status, source, and CV-language vocabularies. */
export const APPLICATION_STATUS_LABELS: Readonly<Record<ApplicationStatus, string>> = Object.freeze({ submitted: "Enviada", in_review: "En revisión", hired: "Contratada", rejected: "Rechazada" });
export const APPLICATION_SOURCE_LABELS: Readonly<Record<ApplicationSource, string>> = Object.freeze({ referral: "Referida", linkedin: "LinkedIn", job_board: "Portal de empleo", direct: "Directa", other: "Otra" });
export const CV_LANGUAGE_LABELS: Readonly<Record<CvLanguage, string>> = Object.freeze({ es: "Español", en: "Inglés" });
const MAX_COVER_LETTER = 2000;
const MAX_CV_BYTES = 10 * 1024 * 1024;
const MAX_CVS = 20;
const offsetAwareIsoDateTime = z.string().datetime({ offset: true });

/** Canonical `/vacantes/<jobId>` detail link for one known public job id. */
export function applicationPublicJobHref(jobId: string): string {
  return `/vacantes/${jobId}`;
}
/** Fields every candidate application exposes, independent of the public link. */
const applicationFields = {
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  companyId: z.string().uuid(),
  jobTitle: z.string().trim().min(1).max(160),
  companyName: z.string().trim().min(1).max(160),
  coverLetter: z.string().trim().min(1).max(MAX_COVER_LETTER).nullable(),
  status: z.enum(APPLICATION_STATUSES),
  source: z.enum(APPLICATION_SOURCES),
  createdAt: offsetAwareIsoDateTime,
  updatedAt: offsetAwareIsoDateTime,
};
/** A reversed timestamp is a fixture bug, not a render-time surprise. */
function addTimestampOrderIssue(createdAt: string, updatedAt: string, context: z.RefinementCtx): void {
  if (Date.parse(updatedAt) < Date.parse(createdAt)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["updatedAt"], message: "updatedAt is before createdAt" });
}
/** Strict candidate-facing application facts; unknown or malformed values fail loudly. */
export const candidateApplicationSchema = z.object(applicationFields).strict()
  .superRefine((application, context) => addTimestampOrderIssue(application.createdAt, application.updatedAt, context));
export type CandidateApplication = z.infer<typeof candidateApplicationSchema>;
/**
 * Application plus the candidate-only public link: `null` for an archived or
 * unlisted historical vacancy (so no dead link renders), otherwise exactly the
 * canonical `/vacantes/<jobId>` route.
 */
export const candidateApplicationViewSchema = z.object({ ...applicationFields, publicJobHref: z.string().nullable() }).strict()
  .superRefine((application, context) => {
    addTimestampOrderIssue(application.createdAt, application.updatedAt, context);
    if (application.publicJobHref !== null && application.publicJobHref !== applicationPublicJobHref(application.jobId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["publicJobHref"], message: "publicJobHref must equal /vacantes/<jobId>" });
    }
  });
export type CandidateApplicationView = z.infer<typeof candidateApplicationViewSchema>;
/** Fixture collection boundary: unique application ids and unique job ids. */
function addCollectionUniquenessIssues(applications: readonly { readonly id: string; readonly jobId: string }[], context: z.RefinementCtx): void {
  const applicationIds = new Set<string>();
  const jobIds = new Set<string>();
  for (const [index, application] of applications.entries()) {
    if (applicationIds.has(application.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: `duplicate application id: ${application.id}` });
    applicationIds.add(application.id);
    if (jobIds.has(application.jobId)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "jobId"], message: `duplicate job id: ${application.jobId}` });
    jobIds.add(application.jobId);
  }
}
export const candidateApplicationViewsSchema = z.array(candidateApplicationViewSchema).max(200)
  .superRefine((applications, context) => addCollectionUniquenessIssues(applications, context));
/** Parses untrusted fixture data into the validated candidate application portfolio. */
export function parseCandidateApplicationViews(input: unknown): readonly CandidateApplicationView[] {
  return candidateApplicationViewsSchema.parse(input);
}
/** Exact application count per status; every status is present, even at zero. */
export type ApplicationStatusCounts = Readonly<Record<ApplicationStatus, number>>;
export function countApplicationsByStatus(applications: readonly CandidateApplication[]): ApplicationStatusCounts {
  const counts: Record<ApplicationStatus, number> = { submitted: 0, in_review: 0, hired: 0, rejected: 0 };
  for (const application of applications) counts[application.status] += 1;
  return counts;
}
/** Applications still in progress: submitted plus in review. */
export function applicationInProcessCount(counts: ApplicationStatusCounts): number {
  return counts.submitted + counts.in_review;
}
/** Every application, across all four statuses. */
export function applicationTotalCount(counts: ApplicationStatusCounts): number {
  return APPLICATION_STATUSES.reduce((total, status) => total + counts[status], 0);
}
/**
 * Prototype-local CV metadata only: id, Spanish label, `.pdf` filename,
 * language, positive bounded size, offset timestamp, and primary flag. There is
 * deliberately no URL, upload key, upload status, download state, parser,
 * generated/AI state, storage handle, or callback.
 */
export const candidateCvSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64),
  label: z.string().trim().min(1).max(80),
  fileName: z.string().trim().min(1).max(120).regex(/\.pdf$/u),
  language: z.enum(CV_LANGUAGES),
  sizeBytes: z.number().int().positive().max(MAX_CV_BYTES),
  updatedAt: offsetAwareIsoDateTime,
  isPrimary: z.boolean(),
}).strict();
export type CandidateCv = z.infer<typeof candidateCvSchema>;
/** CV inventory boundary: unique ids and filenames, exactly one primary CV. */
export const candidateCvsSchema = z.array(candidateCvSchema).min(1).max(MAX_CVS)
  .superRefine((cvs, context) => {
    const ids = new Set<string>();
    const fileNames = new Set<string>();
    let primaryCount = 0;
    for (const [index, cv] of cvs.entries()) {
      const fileName = cv.fileName.toLowerCase();
      if (ids.has(cv.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "id"], message: `duplicate CV id: ${cv.id}` });
      ids.add(cv.id);
      if (fileNames.has(fileName)) context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "fileName"], message: `duplicate CV filename: ${cv.fileName}` });
      fileNames.add(fileName);
      if (cv.isPrimary) primaryCount += 1;
    }
    if (primaryCount !== 1) context.addIssue({ code: z.ZodIssueCode.custom, path: [], message: "exactly one primary CV is required" });
  });
/** Parses untrusted fixture data into the validated local CV inventory. */
export function parseCandidateCvs(input: unknown): readonly CandidateCv[] {
  return candidateCvsSchema.parse(input);
}
/** The single primary CV, or `undefined` when none is flagged (never claimed). */
export function findPrimaryCv(cvs: readonly CandidateCv[]): CandidateCv | undefined {
  return cvs.find((cv) => cv.isPrimary);
}
/** Pure CV inventory summary derived only from the visible metadata. */
export type CvPortfolioSummary = { readonly total: number; readonly primary: CandidateCv | undefined };
export function summarizeCvs(cvs: readonly CandidateCv[]): CvPortfolioSummary {
  return { total: cvs.length, primary: findPrimaryCv(cvs) };
}
