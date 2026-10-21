import { z } from "zod";

export const draftValidationEnvelopeSchema = z.object({
  error: z.string(), code: z.literal("validation_error"),
  fields: z.array(z.object({ field: z.string(), code: z.enum(["required", "invalid", "too_long", "not_allowed", "duplicate"]) }).strict()),
}).strict();
export type DraftValidationIssue = z.infer<typeof draftValidationEnvelopeSchema>["fields"][number];

/** Known field paths only: never render arbitrary server text as UI copy. */
export function draftValidationErrors(issues: readonly DraftValidationIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.field.replace(/^fields\./u, "").replace(/\[(\d+)\]/gu, ".$1");
    if (!/^(seniority|min_years_of_experience|min_education_level|accepts_in_progress_education|languages(?:\.\d+(?:\.(?:code|min_level))?)?)$/u.test(path)) continue;
    errors[path] ??= issue.code === "duplicate" ? "Este idioma ya está agregado." : issue.code === "required" ? "Completa este dato." : "Revisa este dato.";
  }
  return errors;
}
