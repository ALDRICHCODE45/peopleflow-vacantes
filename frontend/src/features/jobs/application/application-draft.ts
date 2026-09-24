import { z } from "zod";

/**
 * Vacancy application draft contract for the postular route: it normalizes one
 * untrusted draft into a strict, transport-free model. Only zod is imported, so
 * no fixture, router, storage, browser, timer, or randomness coupling is
 * reachable from here; nothing is fetched or persisted.
 */
/** Exact application sources; the ordered vocabulary the form renders. */
export const APPLICATION_DRAFT_SOURCES = ["referral", "linkedin", "job_board", "direct", "other"] as const;
export type ApplicationDraftSource = (typeof APPLICATION_DRAFT_SOURCES)[number];
/** Spanish display labels for the closed source vocabulary. */
export const APPLICATION_DRAFT_SOURCE_LABELS: Readonly<Record<ApplicationDraftSource, string>> = Object.freeze({
  referral: "Referida",
  linkedin: "LinkedIn",
  job_board: "Portal de empleo",
  direct: "Directa",
  other: "Otra",
});
/** Maximum cover letter length measured in Unicode code points, not UTF-16 units. */
export const MAX_APPLICATION_COVER_LETTER_CODE_POINTS = 2000;
/** Counts Unicode code points, so one astral emoji counts as a single character. */
export function countApplicationCoverLetterCodePoints(value: string): number {
  return Array.from(value).length;
}
/** Normalized draft: a closed source plus the trimmed letter or `null` when blank. */
export type ApplicationDraft = Readonly<{ source: ApplicationDraftSource; coverLetter: string | null }>;
/** One normalized validation problem; the path is a dot-joined field path. */
export type ApplicationDraftIssue = Readonly<{ path: string; message: string }>;
/** Discriminated parse outcome: the normalized draft or the flattened issue list. */
export type ApplicationDraftParseResult =
  | Readonly<{ ok: true; draft: ApplicationDraft }>
  | Readonly<{ ok: false; issues: readonly ApplicationDraftIssue[] }>;

const applicationDraftInputSchema = z
  .object({ source: z.enum(APPLICATION_DRAFT_SOURCES), coverLetter: z.string() })
  .strict()
  .superRefine((value, context) => {
    const codePoints = countApplicationCoverLetterCodePoints(value.coverLetter.trim());
    if (codePoints > MAX_APPLICATION_COVER_LETTER_CODE_POINTS) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["coverLetter"], message: `coverLetter exceeds ${MAX_APPLICATION_COVER_LETTER_CODE_POINTS} code points` });
    }
  });

/**
 * Parses one untrusted draft: unknown keys fail, the letter is trimmed before
 * the code-point limit is enforced, whitespace-only input collapses to `null`,
 * and every issue is flattened to a dot-joined field path.
 */
export function parseApplicationDraft(raw: unknown): ApplicationDraftParseResult {
  const parsed = applicationDraftInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.map((segment) => String(segment)).join("."), message: issue.message }));
    return { ok: false, issues };
  }
  const trimmed = parsed.data.coverLetter.trim();
  return { ok: true, draft: { source: parsed.data.source, coverLetter: trimmed === "" ? null : trimmed } };
}
/** Canonical `/vacantes/<jobId>/postular` route for one known vacancy id. */
export function vacancyApplicationHref(jobId: string): string {
  return `/vacantes/${jobId}/postular`;
}
