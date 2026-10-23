import { z } from "zod";

const count = z.number().int().nonnegative().safe();
export const candidatesSummarySchema = z.object({
  total: count,
  with_active_process: count,
  added_last_7_days: count,
  by_kind: z.object({ manual: count, organic: count }).strict(),
}).strict().refine(value => value.by_kind.manual + value.by_kind.organic === value.total, {
  message: "Inconsistent origin counts",
  path: ["by_kind"],
});

export type CandidatesSummary = z.infer<typeof candidatesSummarySchema>;
export type CandidatesSummaryFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "not_found" | "server_error" | "no_response" | "unrecognized_response";
  reference: { status?: number; code?: string };
};
export type CandidatesSummaryResult = { ok: true; data: CandidatesSummary } | CandidatesSummaryFailure;
