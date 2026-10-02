/**
 * Pure, React-free validation for the optional local CV the public `postular`
 * wizard collects on its penultimate step. It owns convenience rules only — the
 * file extension and the declared byte size — and never a content-security
 * check: a browser-declared MIME type is treated as a hint, so a blank or
 * variant type is accepted and the real type is only known after a future
 * upload transport validates the bytes. It reaches no network, storage, router,
 * clock, randomness or React, never reads a file, and never mutates its input.
 */

/** Accepted CV extensions, matched case-insensitively against the file name. */
export const APPLICATION_CV_EXTENSIONS = ["pdf", "doc", "docx"] as const;
export type ApplicationCvExtension = (typeof APPLICATION_CV_EXTENSIONS)[number];

/** Inclusive 10 MiB local limit for one CV: exactly this size is accepted. */
export const APPLICATION_CV_MAX_BYTES = 10 * 1024 * 1024;

/** Human format list the form hint and the rejection message share. */
export const APPLICATION_CV_FORMATS_LABEL = "PDF, DOC o DOCX";

/** Stable DOM id shared by the file control, its label, its hint and its error. */
export const APPLICATION_CV_INPUT_ID = "application-cv-file";

/** Minimal structural view of a browser file: name, size and MIME hint only. */
export type ApplicationCvFileLike = {
  readonly name: string;
  readonly size: number;
  readonly type: string;
};

/** The single rule a rejected selection broke. */
export type ApplicationCvIssueCode = "count" | "extension" | "size";

/** One rejected selection, carrying its stable code and Spanish message. */
export interface ApplicationCvIssue {
  readonly code: ApplicationCvIssueCode;
  readonly message: string;
}

/** Discriminated outcome: the accepted file, or the single rule it broke. */
export type ApplicationCvSelectionResult<T extends ApplicationCvFileLike> =
  | { readonly ok: true; readonly file: T }
  | { readonly ok: false; readonly issues: readonly ApplicationCvIssue[] };

const COUNT_MESSAGE = "Selecciona un solo archivo para tu CV.";
const EXTENSION_MESSAGE = `El CV debe estar en formato ${APPLICATION_CV_FORMATS_LABEL}.`;
const SIZE_MESSAGE = "El CV no puede superar los 10 MB.";

/** The lowercased trailing extension, or `""` when the name has none. */
export function applicationCvExtension(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot < 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1).toLowerCase();
}

/** Narrows a free-form extension to the closed accepted vocabulary. */
export function isApplicationCvExtension(value: string): value is ApplicationCvExtension {
  return (APPLICATION_CV_EXTENSIONS as readonly string[]).includes(value);
}

/** Deterministic KB/MB size text, mirroring the candidate CV inventory. */
const DECIMAL_FORMAT = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 });
export function formatApplicationCvSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${DECIMAL_FORMAT.format(bytes / 1024 / 1024)} MB`;
  return `${DECIMAL_FORMAT.format(Math.round(bytes / 1024))} KB`;
}

/** Uppercased extension label for the review, e.g. `PDF`. */
export function applicationCvFormatLabel(name: string): string {
  return applicationCvExtension(name).toUpperCase();
}

/**
 * Validates one selection in a fixed order — exactly one file, then the
 * case-insensitive extension, then the inclusive byte limit — and returns the
 * first broken rule. `null`/`undefined` mean "nothing chosen" and fail the count
 * rule so callers never mistake an empty selection for an accepted one.
 */
export function parseApplicationCvSelection<T extends ApplicationCvFileLike>(
  files: readonly T[] | null | undefined,
): ApplicationCvSelectionResult<T> {
  const list = files ?? [];
  if (list.length !== 1) {
    return { ok: false, issues: [{ code: "count", message: COUNT_MESSAGE }] };
  }
  const [file] = list;
  if (!isApplicationCvExtension(applicationCvExtension(file.name))) {
    return { ok: false, issues: [{ code: "extension", message: EXTENSION_MESSAGE }] };
  }
  if (file.size > APPLICATION_CV_MAX_BYTES) {
    return { ok: false, issues: [{ code: "size", message: SIZE_MESSAGE }] };
  }
  return { ok: true, file };
}
