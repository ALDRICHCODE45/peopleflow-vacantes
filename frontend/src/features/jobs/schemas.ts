import { z } from "zod";

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
