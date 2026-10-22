import { z } from "zod";
import { contactSchema, etagSchema, profileSchema, uuidSchema } from "@/features/pipeline-movement/model";
import { educationSchema } from "@/features/candidate/model";
import { locationWriteSchema } from "@/features/geo/model";
import { candidateSchema, fieldIssueSchema, type FieldIssue } from "@/features/manual-intake/model";
import type { OrgCandidateDetail } from "../detail/detail-model";

/** Visual field order is also the editor's error/focus order. */
export const CANDIDATE_EDIT_FIELDS = ["full_name", "email", "phone", "location", "professional_title", "current_company", "seniority", "years_of_experience", "education", "languages", "skills", "linkedin_url", "portfolio_url"] as const;
export type CandidateEditField = typeof CANDIDATE_EDIT_FIELDS[number];
export const candidateEditFieldSchema = z.enum(CANDIDATE_EDIT_FIELDS);
export const candidateOriginalSchema = z.object({
 full_name: z.string(), contact: contactSchema, professional_title: z.string().nullable(), current_company: z.string().nullable(),
 profile: profileSchema, education: z.null(), linkedin_url: z.string().nullable(), portfolio_url: z.string().nullable(),
}).strict();
/** Merge .shape into orgCandidateDetailSchema. No runtime dependency on detail-model (avoids a cycle). */
export const candidateEditDetailFieldsSchema = z.object({
 etag: etagSchema, updated_at: z.string().datetime({ offset: true }).nullable(),
 updated_by: z.object({ id: uuidSchema, name: z.string().nullable() }).strict().nullable(),
 corrected_fields: z.array(candidateEditFieldSchema), original: candidateOriginalSchema.nullable(),
 education: z.array(educationSchema).nullable(), skills: z.array(z.string()), linkedin_url: z.string().nullable(), portfolio_url: z.string().nullable(),
});
export type EditableOrgCandidate = OrgCandidateDetail & z.infer<typeof candidateEditDetailFieldsSchema>;
const fields = candidateSchema.shape;
export const candidateEditValuesSchema = z.object({
 full_name: fields.full_name.nullable(), email: fields.email, phone: fields.phone, location: locationWriteSchema,
 professional_title: fields.professional_title.unwrap().nullable(), current_company: fields.current_company.unwrap().nullable(),
 seniority: fields.seniority, years_of_experience: fields.years_of_experience, education: z.array(educationSchema).max(10).nullable(),
 languages: fields.languages.nullable(), skills: fields.skills.unwrap().nullable(),
 linkedin_url: fields.linkedin_url.unwrap().nullable(), portfolio_url: fields.portfolio_url.unwrap().nullable(),
}).strict();
export type CandidateEditValues = z.infer<typeof candidateEditValuesSchema>;
// `reset` is organic-only and the backend rejects the key itself on manual records,
// so an empty list is dropped from the wire body instead of being sent.
export const candidateEditBodySchema = z.object({ set: candidateEditValuesSchema.partial(), reset: z.array(candidateEditFieldSchema).optional() }).strict()
 .transform(({ set, reset }) => reset?.length ? { set, reset } : { set })
 .refine(body => Object.keys(body.set).length + (body.reset?.length ?? 0) > 0)
 .refine(body => !body.reset || (new Set(body.reset).size === body.reset.length && body.reset.every(field => !(field in body.set))));
export type CandidateEditBody = { set: Partial<CandidateEditValues>; reset?: CandidateEditField[] };
export const editErrorEnvelopeSchema = z.object({ error: z.string(), code: z.string(), fields: z.array(fieldIssueSchema).optional() }).strict();
export type CandidateEditFailureReason = "precondition_failed" | "precondition_required" | "validation_error" | "invalid_request" | "not_found" | "unauthenticated" | "forbidden" | "company_inactive" | "company_not_active" | "server_error" | "no_response" | "unrecognized_response";
export type CandidateEditFailure = { ok: false; reason: CandidateEditFailureReason; fields?: FieldIssue[]; reference: { status?: number; code?: string } };
export type CandidateEditResult = { ok: true; data: EditableOrgCandidate } | CandidateEditFailure;
export const CANDIDATE_EDIT_CONFLICT_NOTICE = "Alguien más guardó cambios en este candidato. Conservamos lo que escribiste; revisa los datos marcados y vuelve a guardar.";
type EditValue = CandidateEditValues[CandidateEditField];
const empty = (value: EditValue): EditValue => typeof value === "string" ? value.trim() || null : Array.isArray(value) && value.length === 0 ? null : value;
export const sameEditValue = (a: EditValue, b: EditValue) => JSON.stringify(empty(a)) === JSON.stringify(empty(b));
export function buildCandidateEditBody(kind: "manual" | "organic", baseline: CandidateEditValues, next: CandidateEditValues, resets: readonly CandidateEditField[] = []): CandidateEditBody {
 const reset = kind === "organic" ? [...new Set(resets)] : [];
 const set: Partial<CandidateEditValues> = {};
 for (const field of CANDIDATE_EDIT_FIELDS) if (!reset.includes(field) && !sameEditValue(baseline[field], next[field])) Object.assign(set, { [field]: empty(next[field]) });
 return reset.length ? { set, reset } : { set };
}
export function candidateEditErrors(issues: readonly FieldIssue[]): Record<string, string> {
 const messages = { required: "Completa este dato.", invalid: "Revisa este dato.", too_long: "Este dato es demasiado largo.", not_allowed: "Este dato no se permite aquí.", duplicate: "Quita el valor repetido." };
 const errors: Record<string, string> = {};
 for (const issue of issues) {
  let path = issue.field.replace(/^candidate\./, "").replace(/\[(\d+)\]/g, ".$1");
  if (path.startsWith("skills.")) path = "skills";
  if (path === "location") path = "location.country";
  errors[path] ??= path === "contact" ? "Agrega un correo o un teléfono." : messages[issue.code];
 }
 return errors;
}
export function classifyCandidateEditFailure(status: number | undefined, code: string | undefined, kind: string): CandidateEditFailureReason {
 if (status === 412) return "precondition_failed";
 if (status === 428) return "precondition_required";
 if (status === 404) return "not_found";
 if (status === 401) return "unauthenticated";
 if (status === 403) return code === "company_inactive" || code === "company_not_active" ? code : "forbidden";
 if (status === 400 && (code === "validation_error" || code === "invalid_request")) return code;
 if (status && status >= 500) return "server_error";
 return kind === "network" || kind === "timeout" ? "no_response" : "unrecognized_response";
}
export function candidateEditFailureMessage(reason: CandidateEditFailureReason): string {
 switch (reason) {
  case "precondition_failed": return CANDIDATE_EDIT_CONFLICT_NOTICE;
  case "precondition_required": return "Actualiza los datos del candidato antes de guardar.";
  case "validation_error": return "Revisa los datos marcados.";
  case "unauthenticated": return "Tu sesión expiró. Inicia sesión para guardar; conservamos lo que escribiste.";
  case "forbidden": return "No tienes permiso para editar este candidato.";
  case "company_inactive": case "company_not_active": return "Tu empresa debe estar activa para guardar cambios.";
  case "not_found": return "Este candidato ya no está disponible.";
  case "invalid_request": return "Revisa los datos antes de guardar.";
  default: return "No pudimos confirmar el guardado. Actualiza los datos antes de volver a guardar.";
 }
}
