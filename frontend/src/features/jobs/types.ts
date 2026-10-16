import type { z } from "zod";

import type { jobItemSchema, jobsListSchema, publicJobDetailSchema, publicJobItemSchema, publicJobsListSchema } from "./schemas";

/**
 * v1 model retained for company careers and the unchanged legacy application.
 * Public routes use PublicJobItem/PublicJobDetail, never this schema.
 */
export type JobItem = z.infer<typeof jobItemSchema>;

/**
 * Validated wire shape of the root-level "/jobs" list envelope, inferred from
 * `jobsListSchema`; retained with the v1 prototype contract.
 */
export type JobsList = z.infer<typeof jobsListSchema>;

/** Anonymous v2 public projection; source narrows every nullable dimension. */
export type PublicJobItem = z.infer<typeof publicJobItemSchema>;
export type PublicJobDetail = z.infer<typeof publicJobDetailSchema>;
export type PublicJobsList = z.infer<typeof publicJobsListSchema>;
