import { z } from "zod";
import { CEFR_LEVELS, EDUCATION_LEVELS } from "@/features/candidate/model";
import { CONTENT_TYPES, HARD_MAX_BYTES } from "@/features/candidate-cvs/model";
import { participationSchema, coverageSchema, uuidSchema } from "@/features/pipeline-movement/model";
import { deliverySummarySchema } from "@/features/jobs/drafts/pipeline/fulfillment-model";

export const cvLimits = { max_cvs: 1, max_bytes: HARD_MAX_BYTES, content_types: [...CONTENT_TYPES] };
export const intakeResponseSchema = participationSchema.extend({ coverage: coverageSchema, delivery: deliverySummarySchema }).strict();
export type IntakeResponse = z.infer<typeof intakeResponseSchema>;
export const phoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/).refine(value => !value.startsWith("+52") || value.length === 13);
export const contactSchema = z.object({ email: z.string().trim().email().nullable(), phone: phoneSchema.nullable() }).strict().refine(value => value.email !== null || value.phone !== null);
export const matchSchema = z.object({
  kind: z.enum(["manual", "organic"]), id: uuidSchema, full_name: z.string(), email_masked: z.string().nullable(), phone_masked: z.string().nullable(),
  last_vacancy: z.string().nullable(), last_added_at: z.string().datetime({ offset: true }), in_this_process: z.boolean(),
}).strict();
export const duplicatesSchema = z.object({ matches: z.array(matchSchema) }).strict();
export type DuplicateMatch = z.infer<typeof matchSchema>;
export const fieldIssueSchema = z.object({ field: z.string(), code: z.enum(["required", "invalid", "too_long", "not_allowed", "duplicate"]) }).strict();
export type FieldIssue = z.infer<typeof fieldIssueSchema>;
export const errorSchema = z.object({ error: z.string(), code: z.string(), fields: z.array(fieldIssueSchema).optional(), data: z.object({ matches: z.array(matchSchema).optional(), participation_id: uuidSchema.optional() }).passthrough().optional() }).strict();
export type IntakeFailure = { ok: false; reason: string; reference: { status?: number; code?: string }; fields?: FieldIssue[]; matches?: DuplicateMatch[]; participationId?: string };
export type IntakeResult<T> = { ok: true; data: T } | IntakeFailure;
const short = z.string().trim().min(1).max(120);
const url = z.string().trim().url().max(2048).refine(value => value.startsWith("https://"));
export const candidateSchema = z.object({
  full_name: short, education_level: z.enum(EDUCATION_LEVELS), email: z.string().trim().email().nullable(), phone: phoneSchema.nullable(),
  residence: z.object({ country: z.string().regex(/^[A-Z]{2}$/), state: z.string().regex(/^\d{2}$/).nullable(), municipality: z.string().regex(/^\d{5}$/).nullable(), postal_code: z.string().regex(/^\d{5}$/).nullable() }).strict(),
  professional_title: short.optional(), current_company: short.optional(), field_of_study: short.optional(), experience_years: z.number().int().min(0).max(60).optional(),
  summary: z.string().trim().min(1).max(2000).optional(), skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  languages: z.array(z.object({ language: z.string().trim().min(1).max(60), level: z.enum(CEFR_LEVELS) }).strict()).max(10).optional(),
  linkedin_url: url.optional(), portfolio_url: url.optional(),
}).strict();
export type Candidate = z.infer<typeof candidateSchema>;
export type IntakeBody = { stage_id: string; existing: { kind: "manual" | "organic"; id: string } | null; confirmed_distinct: boolean; candidate: Candidate | null };
export const intakeBodySchema = z.object({ stage_id: uuidSchema, existing: z.object({ kind: z.enum(["manual", "organic"]), id: uuidSchema }).strict().nullable(), confirmed_distinct: z.boolean(), candidate: candidateSchema.nullable() }).strict()
 .refine(body => body.existing ? body.candidate === null && !body.confirmed_distinct : body.candidate !== null);
