import { z } from "zod";
import { COMPENSATION_BASES, COMPENSATION_CURRENCIES, COMPENSATION_MONEY_PATTERN, COMPENSATION_PAY_PERIODS, compensationSchema } from "./drafts/compensation";
import { BENEFITS } from "./drafts/lists";
import { draftRichDescriptionSchema } from "./drafts/rich/description";
import { CONTRACT_TYPES, PROFESSIONAL_AREAS, SENIORITIES, WORK_MODES, WORK_SCHEDULES } from "./drafts/scalars";

const uuid = z.string().uuid();
const nonEmptyString = z.string().min(1);
const offsetAwareIsoDateTime = z.string().datetime({ offset: true });
const integer = z.number().int();

export const jobItemSchema = z.object({
  id: uuid,
  title: nonEmptyString,
  description: z.string(),
  work_mode: z.enum(["onsite", "remote", "hybrid"]),
  employment_type: z.enum(["full_time", "part_time", "contract", "internship"]),
  seniority: z.enum(["intern", "junior", "mid", "senior", "lead"]),
  salary_currency: z.enum(["MXN", "USD"]),
  location: z.string().optional(),
  salary_min: integer.optional(),
  salary_max: integer.optional(),
  published_at: offsetAwareIsoDateTime.optional(),
  company: z.object({
    id: uuid,
    name: nonEmptyString,
  }),
});

export const jobsListSchema = z.object({
  items: z.array(jobItemSchema),
  next_cursor: nonEmptyString.optional(),
});

// v1 above is still consumed by the company careers and legacy application views.
// Public routes decode v2 only; no fallback from malformed v2 data to v1.
const decimalMoney = z.string().regex(COMPENSATION_MONEY_PATTERN);
const currency = z.enum(COMPENSATION_CURRENCIES);
const publicCompensationSchema = z.object({
  mode: z.enum(["fixed", "range"]),
  amount: decimalMoney.nullable(),
  min: decimalMoney.nullable(),
  max: decimalMoney.nullable(),
  currency,
  pay_period: z.enum(COMPENSATION_PAY_PERIODS),
  basis: z.enum(COMPENSATION_BASES),
}).strict().superRefine((value, ctx) => {
  const validDraft = compensationSchema.safeParse({ ...value, public_visible: true }).success;
  const complete = value.mode === "fixed"
    ? value.amount !== null && value.min === null && value.max === null
    : value.amount === null && value.min !== null && value.max !== null;
  if (!validDraft || !complete) ctx.addIssue({ code: "custom", message: "incomplete public compensation" });
});
const legacySalarySchema = z.object({
  min: decimalMoney.nullable(),
  max: decimalMoney.nullable(),
  currency,
}).strict().refine((value) => value.min !== null || value.max !== null);

const publicCommon = {
  id: uuid,
  title: nonEmptyString,
  company: z.object({ id: uuid, name: nonEmptyString }).strict(),
  work_mode: z.enum(WORK_MODES),
  published_at: offsetAwareIsoDateTime,
};
const publicLegacy = z.object({
  ...publicCommon,
  source: z.literal("legacy"),
  location: z.string().nullable(),
  work_schedule: z.null(),
  contract_type: z.null(),
  professional_area: z.null(),
  seniority: z.enum(SENIORITIES),
  legacy_employment_type: z.enum(["full_time", "part_time", "contract", "internship"]),
  compensation: z.null(),
  legacy_salary: legacySalarySchema.nullable(),
});
const publicVacancy = z.object({
  ...publicCommon,
  source: z.literal("vacancy"),
  location: nonEmptyString,
  work_schedule: z.enum(WORK_SCHEDULES),
  contract_type: z.enum(CONTRACT_TYPES),
  professional_area: z.enum(PROFESSIONAL_AREAS),
  seniority: z.enum(SENIORITIES).nullable(),
  legacy_employment_type: z.null(),
  compensation: publicCompensationSchema.nullable(),
  legacy_salary: z.null(),
});
export const publicJobItemSchema = z.discriminatedUnion("source", [publicLegacy.strict(), publicVacancy.strict()]);
export const publicJobsListSchema = z.object({
  items: z.array(publicJobItemSchema),
  next_cursor: nonEmptyString.nullable(),
}).strict();

export const publicJobDetailSchema = z.discriminatedUnion("source", [
  publicLegacy.extend({
    description: z.null(),
    description_plain: z.string(),
    requirements: z.object({ required: z.null(), preferred: z.null() }).strict(),
    benefits: z.object({ predefined: z.array(z.enum(BENEFITS)).max(0), custom: z.array(z.string()).max(0) }).strict(),
  }).strict(),
  publicVacancy.extend({
    description: draftRichDescriptionSchema.refine((value) => value !== null),
    description_plain: z.string(),
    requirements: z.object({ required: z.string().nullable(), preferred: z.string().nullable() }).strict(),
    benefits: z.object({ predefined: z.array(z.enum(BENEFITS)), custom: z.array(z.string()) }).strict(),
  }).strict(),
]);
