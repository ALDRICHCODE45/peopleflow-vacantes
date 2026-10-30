import { z } from "zod";
import { availabilitySchema, vacancyUnavailableEnvelopeSchema, type UnavailableVacancy } from "@/features/jobs/api/vacancy-availability";
import { countryCodeSchema } from "@/features/geo/model";
const uuid = z.string().uuid();
const text = z.string().refine(value => value.trim().length > 0);
const timestamp = z.string().datetime({ offset: true });
const option = z.object({ id: uuid, label: text }).strict();
const question = z.discriminatedUnion("type", [
  z.object({ id: uuid, prompt: text, type: z.literal("open"), options: z.null() }).strict(),
  z.object({ id: uuid, prompt: text, type: z.literal("single_choice"), options: z.array(option).min(1).refine(items => new Set(items.map(item => item.id.toLowerCase())).size === items.length) }).strict(),
]);
export const screeningSchema = z.object({
  questionnaire_revision: text,
  questions: z.array(question).refine(items => new Set(items.map(item => item.id.toLowerCase())).size === items.length),
  limits: z.object({ open_answer_max_length: z.number().int().positive().safe() }).strict(),
}).strict();
export const answerSchema = z.union([
  z.object({ question_id: uuid, text: z.string().trim().min(1).refine(value => Array.from(value).length <= 2000) }).strict(),
  z.object({ question_id: uuid, option_id: uuid }).strict(),
]);
export const applicationBodySchema = z.object({ cv_id: uuid, questionnaire_revision: text, answers: z.array(answerSchema).refine(items => new Set(items.map(item => item.question_id.toLowerCase())).size === items.length) }).strict();
export const submittedSchema = z.object({ id: uuid, vacancy_id: uuid, status: z.literal("submitted"), applied_at: timestamp }).strict();
export const applicationsSchema = z.object({ items: z.array(z.object({ id: uuid, vacancy: z.object({ id: uuid, title: text, state: z.enum(["open", "closed"]) }).strict(), company: z.object({ id: uuid, name: text }).strict(), applied_at: timestamp, updated_at: timestamp.optional(), status: z.enum(["submitted", "in_process", "closed"]), message: text.nullable() }).strict().refine(item => item.status === "closed" || item.message === null).refine(item => item.updated_at === undefined || Date.parse(item.updated_at) >= Date.parse(item.applied_at))).refine(items => new Set(items.map(item => item.id.toLowerCase())).size === items.length), next_cursor: z.string().min(1).nullable() }).strict();
export const querySchema = z.object({ cursor: z.string().min(1).optional(), limit: z.number().int().min(1).max(50).optional() }).strict();
export const detailSchema = z.object({ question_id: uuid, reason: z.enum(["required", "unknown_option", "too_long", "wrong_type"]) }).strict();
export const errorSchema = z.union([
  vacancyUnavailableEnvelopeSchema,
  z.object({ error: text, code: z.literal("vacancy_not_accepting_applications"), data: z.object({ availability: availabilitySchema }).strict() }).strict(),
  z.object({ error: text, code: z.enum(["applicant_country_required", "applicant_country_not_allowed"]), data: z.object({ allowed: z.array(countryCodeSchema).min(1).refine(codes => new Set(codes).size === codes.length) }).strict() }).strict(),
  z.object({ error: text, code: z.literal("invalid_answers"), details: z.array(detailSchema).min(1) }).strict(),
  z.object({ error: text, code: text.refine(code => !["vacancy_unavailable", "vacancy_not_accepting_applications", "invalid_answers", "applicant_country_required", "applicant_country_not_allowed"].includes(code)) }).strict(),
]);
export const CODES = ["vacancy_unavailable", "vacancy_not_accepting_applications", "applicant_country_required", "applicant_country_not_allowed", "not_found", "already_applied", "questionnaire_changed", "invalid_answers", "cv_unavailable", "invalid_request", "idempotency_conflict", "invalid_idempotency_key", "idempotency_key_required", "precondition_required", "unauthenticated", "forbidden", "wrong_role", "internal_error"] as const;
export type Reason = Exclude<typeof CODES[number], "internal_error"> | "no_response" | "server_error" | "unrecognized_response";
export type Failure = { ok: false; reason: Reason; reference: { status?: number; code?: string }; vacancy?: UnavailableVacancy; availability?: UnavailableVacancy["availability"]; allowed?: string[]; details?: z.infer<typeof detailSchema>[] };
export type Result<T> = { ok: true; data: T } | Failure;
export type Screening = z.infer<typeof screeningSchema>;
export type ApplicationBody = z.infer<typeof applicationBodySchema>;
export type Submitted = z.infer<typeof submittedSchema>;
export type ApplicationsPage = z.infer<typeof applicationsSchema>;
export type ApplicationsQuery = z.infer<typeof querySchema>;
export type ErrorEnvelope = z.infer<typeof errorSchema>;
export { uuid as uuidSchema };
