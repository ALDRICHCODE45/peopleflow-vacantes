import { z } from "zod";
import { CONTENT_TYPES, HARD_MAX_BYTES, uploadValidation } from "@/features/candidate-cvs/model";
import { etagSchema, uuidSchema } from "@/features/pipeline-movement/model";
import { orgCandidateIdentitySchema, type OrgCandidateDetail, type OrgCandidateIdentity } from "../detail/detail-model";

export const cvLimits = { max_cvs: 1, max_bytes: HARD_MAX_BYTES, content_types: [...CONTENT_TYPES] };
export const CV_ACCEPT = `${CONTENT_TYPES.join(",")},.pdf,.docx`;
export const CV_ENVELOPE_CAP = HARD_MAX_BYTES + 65_536;
const codes = ["invalid_request", "validation_error", "precondition_failed", "precondition_required", "not_found", "unauthenticated", "forbidden", "company_inactive", "company_not_active", "cv_too_large", "payload_too_large", "cv_unsupported_type", "cv_content_mismatch", "cv_storage_unavailable", "internal_error", "no_response", "unrecognized_response"] as const;
export const cvErrorSchema = z.object({
 code: z.enum(codes), error: z.string().optional(),
 fields: z.array(z.object({ field: z.string(), code: z.string() })).optional(),
});
export type CvReason = typeof codes[number] | "server_error";
export type CvFailure = { ok: false; reason: CvReason; reference: { status?: number; code?: string }; message?: string };
export type CvResult = { ok: true; data: OrgCandidateDetail } | CvFailure;
export function cvFailure(status?: number, value?: unknown): CvFailure {
 const parsed = cvErrorSchema.safeParse(value);
 const code = parsed.success ? parsed.data.code : undefined;
 const reason: CvReason = status === 412 ? "precondition_failed" : status === 428 ? "precondition_required" : status === 413 ? "cv_too_large" : status === 401 ? "unauthenticated" : status === 403 ? "forbidden" : status === 404 ? "not_found" : code === "internal_error" || (status !== undefined && status >= 500 && !code) ? "server_error" : code ?? (status === undefined ? "no_response" : "unrecognized_response");
 return { ok: false, reason, reference: { ...(status === undefined ? {} : { status }), ...(code ? { code } : {}) } };
}
export function validateCvUpload(candidate: OrgCandidateIdentity, participationId: string, etag: string, cv: File): CvFailure | undefined {
 if (!orgCandidateIdentitySchema.safeParse(candidate).success || !uuidSchema.safeParse(participationId).success || !etagSchema.safeParse(etag).success) return cvFailure(400, { code: "invalid_request" });
 if (!(cv instanceof File)) return { ...cvFailure(400, { code: "validation_error" }), message: "Elige un archivo PDF o DOCX." };
 const message = uploadValidation(cv, cvLimits);
 if (message) return { ...cvFailure(cv.size > HARD_MAX_BYTES ? 413 : 400, { code: cv.size > HARD_MAX_BYTES ? "cv_too_large" : "validation_error" }), message };
}
export function cvFailureMessage(failure: CvFailure): string {
 if (failure.message) return failure.message;
 switch (failure.reason) {
 case "cv_too_large": case "payload_too_large": return "El archivo pesa más de 5 MB.";
 case "cv_unsupported_type": return "Sube un PDF o un documento de Word (.docx).";
 case "cv_content_mismatch": return "El contenido no coincide con el tipo de archivo. Elige otro documento.";
 case "validation_error": case "invalid_request": return "Revisa el archivo e intenta de nuevo.";
 case "precondition_failed": return "Esto cambió en otro lugar. Conservamos tu archivo; revisa y vuelve a subirlo.";
 case "precondition_required": return "Actualiza la ficha antes de subir el archivo.";
 case "not_found": return "Este proceso ya no está disponible.";
 case "unauthenticated": return "Tu sesión expiró. Inicia sesión de nuevo.";
 case "forbidden": case "company_inactive": case "company_not_active": return "No tienes permiso para subir este CV.";
 case "cv_storage_unavailable": return "La carga de archivos no está disponible. Intenta más tarde.";
 default: return "No pudimos confirmar el guardado. Actualiza la ficha antes de volver a subirlo.";
 }
}
