import type { z } from "zod";

import type { jobItemSchema, jobsListSchema } from "./schemas";

/**
 * Validated wire shape of one vacancy, inferred from the feature-owned
 * `jobItemSchema` so the runtime schema stays the single source of truth.
 */
export type JobItem = z.infer<typeof jobItemSchema>;

/**
 * Validated wire shape of the root-level "/jobs" list envelope, inferred from
 * `jobsListSchema`; consumed by the future list/detail query functions.
 */
export type JobsList = z.infer<typeof jobsListSchema>;
