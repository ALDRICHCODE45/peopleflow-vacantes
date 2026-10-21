import { z } from "zod";

const text = z.string().refine(value => value.trim().length > 0);
export const availabilitySchema = z.enum(["paused", "closed"]);
export const unavailableVacancySchema = z.object({
  id: z.string().uuid(),
  title: text,
  company: z.object({ id: z.string().uuid(), name: text }).strict(),
  availability: availabilitySchema,
}).strict();
export const vacancyUnavailableEnvelopeSchema = z.object({
  error: text,
  code: z.literal("vacancy_unavailable"),
  data: unavailableVacancySchema,
}).strict();
export type UnavailableVacancy = z.infer<typeof unavailableVacancySchema>;
export type VacancyUnavailableEnvelope = z.infer<typeof vacancyUnavailableEnvelopeSchema>;
