import { z } from "zod";

export const CONTENT_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] as const;
export const HARD_MAX_BYTES = 5_242_880;
export const uuidSchema = z.string().uuid();
export function normalizeCvName(value: string): string {
  return value.normalize("NFC").replace(/\p{White_Space}+/gu, " ").trim();
}
export function validCvName(value: string): boolean {
  return Array.from(value).length >= 1 && Array.from(value).length <= 120 && !/\p{Cc}|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
}
export const renameSchema = z.object({ name: z.string().transform(normalizeCvName).refine(validCvName) }).strict();
const nameSchema = z.string().refine(value => normalizeCvName(value) === value && validCvName(value));
// zod datetime validates calendar dates as well as requiring a complete RFC3339 timestamp.
const timestamp = z.string().datetime({ offset: true });
export const cvSchema = z.object({
  id: uuidSchema, name: nameSchema, size: z.number().int().positive().safe(),
  content_type: z.enum(CONTENT_TYPES), uploaded_at: timestamp, in_use: z.boolean(),
}).strict();
export const limitsSchema = z.object({
  max_cvs: z.number().int().positive().safe(), max_bytes: z.number().int().positive().max(HARD_MAX_BYTES),
  content_types: z.array(z.enum(CONTENT_TYPES)).min(1).refine(types => new Set(types).size === types.length),
}).strict();
export const librarySchema = z.object({ items: z.array(cvSchema), limits: limitsSchema }).strict().superRefine(({ items, limits }, ctx) => {
  if (items.length > limits.max_cvs || new Set(items.map(cv => cv.id)).size !== items.length || items.some(cv => cv.size > limits.max_bytes || !limits.content_types.includes(cv.content_type)))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid library" });
});
export type Cv = z.infer<typeof cvSchema>;
export type CvLimits = z.infer<typeof limitsSchema>;
export type CvLibrary = z.infer<typeof librarySchema>;
export const REASONS = ["cv_too_large", "cv_unsupported_type", "cv_content_mismatch", "cv_library_full", "invalid_request", "unauthenticated", "forbidden", "wrong_role", "storage_unavailable", "not_found", "server_error", "no_response", "unrecognized_response"] as const;
export type CvReason = typeof REASONS[number];
export type CvFailure = { ok: false; reason: CvReason; reference: { status?: number; code?: string } };
export type CvResult<T> = { ok: true; data: T } | CvFailure;
export const errorEnvelopeSchema = z.object({ error: z.string().min(1), code: z.string().min(1) }).strict();
export type CvCode = Exclude<CvReason, "storage_unavailable"> | "cv_storage_unavailable";
export function isCvCode(code: string): code is CvCode { return code === "cv_storage_unavailable" || (code !== "storage_unavailable" && (REASONS as readonly string[]).includes(code)); }
const EXTENSION_TYPES: Readonly<Record<string, (typeof CONTENT_TYPES)[number]>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
/**
 * Browser MIME types are advisory and some browsers send a .docx with an empty or
 * generic type. Accept an allowed type, or an unknown type whose extension maps to an
 * allowed one; the backend decides by real content (cv_content_mismatch).
 */
export function acceptedCvFile(file: Pick<File, "type" | "name">, limits: CvLimits): boolean {
  const allowed = limits.content_types as readonly string[];
  if (allowed.includes(file.type)) return true;
  if (file.type !== "" && file.type !== "application/octet-stream") return false;
  const extension = file.name.toLowerCase().split(".").at(-1) ?? "";
  const mapped = EXTENSION_TYPES[extension];
  return mapped !== undefined && allowed.includes(mapped);
}
export function uploadValidation(file: Pick<File, "size" | "type" | "name">, limits: CvLimits): string | undefined {
  if (!acceptedCvFile(file, limits)) return "Sube un PDF o un documento de Word (.docx).";
  if (file.size > limits.max_bytes) return `El archivo pesa más de ${limits.max_bytes / 1024 / 1024} MB.`;
  if (file.size === 0) return "El archivo está vacío. Elige otro documento.";
}
export function cvRowActions(cv: Pick<Cv, "id">) {
  return [
    { key: "download", label: "Descargar", href: `/api/candidate/cvs/${encodeURIComponent(cv.id)}/file` },
    { key: "rename", label: "Renombrar" },
    { key: "delete", label: "Eliminar" },
  ] as const;
}
