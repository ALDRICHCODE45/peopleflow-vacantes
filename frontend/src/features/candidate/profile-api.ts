import { z } from "zod";
import { locationReadSchema, locationWriteSchema, parseGeographyErrors, type LocationIssue } from "@/features/geo/model";
import { candidateProfileSchema } from "./model";

// Wire nullables are omitted by Go's omitempty. Keep the wire boundary strict;
// normalization into editor values belongs to the editor adapter.
const fields = candidateProfileSchema.shape;
const editable = {
  phone: fields.phone.optional(),
  linkedin_url: fields.linkedinUrl.optional(),
  portfolio_url: fields.portfolioUrl.optional(),
  professional_title: fields.professionalTitle.optional(),
  current_company: fields.currentCompany.optional(),
  years_of_experience: fields.yearsOfExperience.optional(),
  profile_summary: fields.summary.optional(),
  birth_date: fields.birthDate.optional(),
  seniority: fields.seniority.optional(),
  education: fields.education.optional(),
  skills: fields.skills.optional(),
  current_salary_gross: fields.currentSalaryGross.optional(),
  current_salary_net: fields.currentSalaryNet.optional(),
  expected_salary: fields.expectedSalary.optional(),
  salary_currency: fields.salaryCurrency,
  expected_salary_period: fields.expectedSalaryPeriod.optional(),
};
export const profileReadSchema = z.object({
  ...editable,
  user_id: z.string().uuid(),
  location: locationReadSchema,
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).strict();
// Even postal_code:null is forbidden for candidates, not silently discarded.
const candidateLocationWriteSchema = locationWriteSchema.unwrap().omit({ postal_code: true }).strict().nullable();
export const profileWriteSchema = z.object({
  ...editable,
  salary_currency: fields.salaryCurrency.optional(),
  location: candidateLocationWriteSchema.optional(),
}).strict();
export const languagesSchema = z.object({ languages: fields.languages }).strict();
export type ProfileRead = z.infer<typeof profileReadSchema>;
export type ProfileWrite = z.infer<typeof profileWriteSchema>;
export type ProfileLanguages = z.infer<typeof languagesSchema>;
const locationEnvelope = z.object({
  error: z.string(), code: z.literal("invalid_location"),
  details: z.array(z.object({ field: z.string().regex(/^location\.(country|state|municipality|postal_code)$/), reason: z.enum(["required", "unknown", "mismatch", "not_allowed"]) }).strict()).min(1),
}).strict();
const fieldIssueSchema = z.object({ field: z.string(), code: z.enum(["required", "invalid", "too_long", "not_allowed", "duplicate"]) }).strict();
const validationEnvelope = z.object({ error: z.string(), code: z.literal("validation_error"), fields: z.array(fieldIssueSchema) }).strict();
export const profileErrorSchema = z.union([
  locationEnvelope,
  validationEnvelope,
  z.object({ error: z.string(), code: z.string() }).strict(),
]);
export function profileLocationErrors(status: number | undefined, body: unknown): LocationIssue[] {
  const parsed = locationEnvelope.safeParse(body);
  if (!parsed.success) return [];
  const mapped = { ...parsed.data, details: parsed.data.details.map(detail => ({ ...detail, field: `fields.${detail.field}` })) };
  return parseGeographyErrors(status, mapped)?.location ?? [];
}
export type ProfileFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "not_found" | "invalid_request" | "invalid_location" | "no_response" | "server_error" | "unrecognized_response";
  reference: { status?: number; code?: string };
  locationIssues?: LocationIssue[];
  fields?: z.infer<typeof fieldIssueSchema>[];
};
export type ProfileResult<T> = { ok: true; data: T } | ProfileFailure;
const safeCodes = new Set(["unauthenticated", "account_required", "wrong_role", "forbidden", "not_found", "invalid_request", "invalid_location", "validation_error", "internal_error"]);
export function profileFailure(result: { error: { kind: string; status?: number }; envelope?: unknown }): ProfileFailure {
  const { kind, status } = result.error;
  const envelope = profileErrorSchema.safeParse(result.envelope);
  const code = envelope.success && safeCodes.has(envelope.data.code) ? envelope.data.code : undefined;
  const locationIssues = profileLocationErrors(status, result.envelope);
  const validation = status === 400 ? validationEnvelope.safeParse(result.envelope) : null;
  let reason: ProfileFailure["reason"] = "unrecognized_response";
  if (kind === "missing_token" || status === 401) reason = "unauthenticated";
  else if (kind === "invalid_request" || status === 400) reason = "invalid_request";
  else if (kind === "network" || kind === "timeout") reason = "no_response";
  else if (status === 403) reason = "forbidden";
  else if (status === 404) reason = "not_found";
  else if (locationIssues.length) reason = "invalid_location";
  else if (status !== undefined && status >= 500) reason = "server_error";
  return { ok: false, reason, reference: { ...(status === undefined ? {} : { status }), ...(code ? { code } : {}) }, ...(locationIssues.length ? { locationIssues } : {}), ...(validation?.success ? { fields: validation.data.fields } : {}) };
}
