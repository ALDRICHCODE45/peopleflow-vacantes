import { z } from "zod";
import { candidateProfileSchema } from "@/features/candidate/model";
import { profileSchema, uuidSchema } from "@/features/pipeline-movement/model";
import type { DetailFailure } from "../detail/detail-model";

const text = z.string().refine(value => !!value.trim());
// Values are discriminated by field: a valid value for one field cannot mask drift in another.
function valueChange<F extends string, V extends z.ZodTypeAny>(field: F, value: V) {
  const shape = { field: z.literal(field), from: value, to: value };
  return z.union([z.object(shape).strict(), z.object({ ...shape, reset: z.literal(true) }).strict()]);
}
export const historyChangeSchema = z.union([
  z.object({ field: z.enum(["full_name", "email", "phone"]), contact: z.literal(true) }).strict(),
  valueChange("professional_title", candidateProfileSchema.shape.professionalTitle),
  valueChange("current_company", candidateProfileSchema.shape.currentCompany),
  valueChange("years_of_experience", profileSchema.shape.years_of_experience),
  valueChange("seniority", profileSchema.shape.seniority),
  valueChange("education", candidateProfileSchema.shape.education.nullable()),
  valueChange("languages", profileSchema.shape.languages.nullable()),
  valueChange("location", profileSchema.shape.location),
  valueChange("skills", profileSchema.shape.skills.nullable()),
  valueChange("linkedin_url", candidateProfileSchema.shape.linkedinUrl),
  valueChange("portfolio_url", candidateProfileSchema.shape.portfolioUrl),
]);
const entry = {
  id: uuidSchema, at: z.string().datetime({ offset: true }),
  actor: z.object({ id: uuidSchema, name: text.nullable() }).strict(),
};
export const orgCandidateHistorySchema = z.object({
  items: z.array(z.discriminatedUnion("kind", [
    z.object({ ...entry, kind: z.literal("edit"), changes: z.array(historyChangeSchema).min(1) }).strict(),
    z.object({ ...entry, kind: z.literal("cv_corrected"), participation_id: uuidSchema, file_name: text }).strict(),
  ])).max(50),
  next_cursor: z.string().min(1).nullable(),
}).strict();
export type HistoryChange = z.infer<typeof historyChangeSchema>;
export type OrgCandidateHistory = z.infer<typeof orgCandidateHistorySchema>;
export type HistoryEntry = OrgCandidateHistory["items"][number];
export type HistoryResult = { ok: true; data: OrgCandidateHistory } | DetailFailure;
