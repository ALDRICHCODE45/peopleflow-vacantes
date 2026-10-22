import { z } from "zod";
import { phoneSchema } from "@/lib/phone";
import { candidateLanguageSchema, educationSchema, SENIORITIES, yearsOfExperienceSchema } from "@/features/candidate/model";
import { CONTENT_TYPES, HARD_MAX_BYTES } from "@/features/candidate-cvs/model";
import { participationSchema, coverageSchema, uuidSchema } from "@/features/pipeline-movement/model";
import { deliverySummarySchema } from "@/features/jobs/drafts/pipeline/fulfillment-model";

export const cvLimits = { max_cvs: 1, max_bytes: HARD_MAX_BYTES, content_types: [...CONTENT_TYPES] };
export const intakeResponseSchema = participationSchema.extend({ coverage: coverageSchema, delivery: deliverySummarySchema }).strict();
export type IntakeResponse = z.infer<typeof intakeResponseSchema>;
export { phoneSchema } from "@/lib/phone";
export const contactSchema = z.object({ email: z.string().trim().email().nullable(), phone: phoneSchema.nullable() }).strict().refine(value => value.email !== null || value.phone !== null);
export const matchSchema = z.object({
  kind: z.enum(["manual", "organic"]), id: uuidSchema, full_name: z.string(), email_masked: z.string().nullable(), phone_masked: z.string().nullable(),
  last_vacancy: z.object({ id: uuidSchema, title: z.string() }).strict().nullable(), last_added_at: z.string().datetime({ offset: true }), in_this_process: z.boolean(),
}).strict();
export const duplicatesSchema = z.object({ matches: z.array(matchSchema) }).strict();
export type DuplicateMatch = z.infer<typeof matchSchema>;
export const fieldIssueSchema = z.object({ field: z.string(), code: z.enum(["required", "invalid", "too_long", "not_allowed", "duplicate"]) }).strict();
export type FieldIssue = z.infer<typeof fieldIssueSchema>;
export const errorSchema = z.object({ error: z.string(), code: z.string(), fields: z.array(fieldIssueSchema).optional(), data: z.object({ matches: z.array(matchSchema).optional(), participation_id: uuidSchema.optional() }).strip().optional() }).strict();
export type IntakeFailure = { ok: false; reason: string; reference: { status?: number; code?: string }; fields?: FieldIssue[]; matches?: DuplicateMatch[]; participationId?: string };
export type IntakeResult<T> = { ok: true; data: T } | IntakeFailure;
const short = z.string().trim().min(1).max(120);
const url = z.string().trim().url().max(2048).refine(value => value.startsWith("https://"));
export const candidateSchema = z.object({
  full_name: short, education: z.array(educationSchema).min(1).max(10), email: z.string().trim().email().nullable(), phone: phoneSchema.nullable(),
  residence: z.object({ country: z.string().regex(/^[A-Z]{2}$/), state: z.string().regex(/^\d{2}$/).nullable(), municipality: z.string().regex(/^\d{5}$/).nullable(), postal_code: z.string().regex(/^\d{5}$/).nullable() }).strict(),
  professional_title: short.optional(), current_company: short.optional(), years_of_experience: yearsOfExperienceSchema.nullable(), seniority: z.enum(SENIORITIES).nullable(),
  summary: z.string().trim().min(1).max(2000).optional(), skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  languages: z.array(candidateLanguageSchema).max(10).superRefine((rows, context) => {
    const seen = new Set<string>();
    rows.forEach((row, index) => {
      if (seen.has(row.code)) context.addIssue({ code: "custom", path: [index, "code"], message: "Quita el idioma repetido." });
      seen.add(row.code);
    });
  }),
  linkedin_url: url.optional(), portfolio_url: url.optional(),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export type IntakeBody = { stage_id: string; existing: { kind: "manual" | "organic"; id: string } | null; confirmed_distinct: boolean; candidate: Candidate | null };
export const intakeBodySchema = z.object({ stage_id: uuidSchema, existing: z.object({ kind: z.enum(["manual", "organic"]), id: uuidSchema }).strict().nullable(), confirmed_distinct: z.boolean(), candidate: candidateSchema.nullable() }).strict()
 .refine(body => body.existing ? body.candidate === null && !body.confirmed_distinct : body.candidate !== null);
