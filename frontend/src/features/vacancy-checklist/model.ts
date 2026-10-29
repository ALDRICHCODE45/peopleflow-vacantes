import { z } from "zod";
import { SENIORITIES, EDUCATION_LEVELS } from "@/features/candidate/model";
import { draftMinYearsSchema } from "@/features/jobs/drafts/scalars";
import { draftLanguageSchema } from "@/features/jobs/drafts/nested";
import { countryCodeSchema, stateCodeSchema } from "@/features/geo/model";

const uuid = z.string().uuid();
export const normalizeSkillName = (value: string) => value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const unique = <T extends z.ZodTypeAny>(schema: T, min: number, max: number) => z.array(schema).min(min).max(max).refine(items => new Set(items.map(item => typeof item === "string" && uuid.safeParse(item).success ? item.toLowerCase() : item)).size === items.length, "duplicate");
const text = (max: number) => z.string().trim().min(1).refine(value => [...value].length <= max, "too_long");
const common = { id: uuid, label: text(200), importance: z.enum(["required", "desirable"]) };
export const criterionSchema = z.discriminatedUnion("kind", [
  z.object({ ...common, kind: z.literal("min_years_experience"), params: z.object({ min: draftMinYearsSchema.unwrap() }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("seniority"), params: z.object({ accepted: unique(z.enum(SENIORITIES), 1, 7) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("education"), params: z.object({ min_level: z.enum(EDUCATION_LEVELS), accepts_in_progress: z.boolean() }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("language"), params: draftLanguageSchema }).strict(),
  z.object({ ...common, kind: z.literal("skill"), params: z.object({ name: text(60) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("location"), params: z.object({ country: countryCodeSchema, states: unique(stateCodeSchema, 0, 32) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("screening_answer"), params: z.object({ question_id: uuid, accepted_option_ids: unique(uuid, 1, 8) }).strict() }).strict(),
  z.object({ ...common, kind: z.literal("manual"), params: z.object({}).strict() }).strict(),
]);
export type Criterion = z.infer<typeof criterionSchema>;
/** Compare parsed params in schema order, not caller object-key order. */
export function updateCriterionIdentity(previous: Criterion, edited: Criterion): Criterion {
  const before = criterionSchema.parse(previous);
  const next = criterionSchema.parse(edited);
  const unchanged = before.kind === next.kind && JSON.stringify(before.params) === JSON.stringify(next.params);
  return { ...next, id: unchanged ? previous.id : crypto.randomUUID() };
}
export const criteriaSchema = z.array(criterionSchema).max(50).superRefine((criteria, context) => {
  const seen = new Set<string>();
  criteria.forEach((c, index) => {
    const keys = [`id:${c.id.toLowerCase()}`];
    if (c.kind === "language") keys.push(`language:${c.params.code}`);
    if (c.kind === "skill") keys.push(`skill:${normalizeSkillName(c.params.name)}`);
    if (c.kind === "screening_answer") keys.push(`question:${c.params.question_id.toLowerCase()}`);
    if (c.kind === "location") keys.push("location");
    for (const key of keys) {
      if (seen.has(key)) context.addIssue({ code: "custom", path: [index], message: "duplicate" });
      seen.add(key);
    }
  });
});
export const checklistBodySchema = z.object({ criteria: criteriaSchema, reminder_stage_ids: unique(uuid, 0, Infinity) }).strict();
export const checklistSchema = checklistBodySchema.extend({ version: z.string().regex(/^(0|[1-9][0-9]*)$(?![\s\S])/) }).strict();
export const markBodySchema = z.object({ verdict: z.enum(["met", "not_met"]), note: z.string().trim().refine(value => [...value].length <= 500, "too_long").nullable().transform(value => value || null) }).strict();
export const markSchema = markBodySchema.extend({ participation_id: uuid, criterion_id: uuid, marked_by: z.object({ id: uuid, full_name: z.string() }).strict(), marked_at: z.string().datetime({ offset: true }) }).strict();
export const marksSchema = z.object({ items: z.array(markSchema) }).strict();
export const validationFieldSchema = z.object({ field: z.string(), code: z.enum(["required", "invalid", "too_long", "duplicate", "not_allowed"]) }).strict();
export type Checklist = z.infer<typeof checklistSchema>;
export type ChecklistBody = z.infer<typeof checklistBodySchema>;
export type Mark = z.infer<typeof markSchema>;
export type MarkBody = z.infer<typeof markBodySchema>;
export type Marks = z.infer<typeof marksSchema>;
export type ValidationField = z.infer<typeof validationFieldSchema>;
export type FailureReason = "unauthenticated" | "forbidden" | "not_found" | "version_conflict" | "process_finished" | "precondition_required" | "validation_error" | "invalid_request" | "no_response" | "unrecognized_response" | "server_error";
export type Result<T> = { ok: true; data: T; etag?: string } | { ok: false; reason: FailureReason; fields?: ValidationField[]; reference: { status?: number; code?: string } };
