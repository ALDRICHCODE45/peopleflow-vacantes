import { z } from "zod";
import {
  appliedFiltersSchema, applicationListRowSchema, candidateListRowSchema, deliveryListRowSchema, personSchema, requesterSchema,
} from "@/features/company-metrics/model";

/**
 * Decoders for the dashboard lists (contract `company-dashboard-v2` §5, backend d2b `5abe42b0`):
 * `GET /v2/me/company/dashboard/lists/{kind}`, the metrics §5 grammar under the dashboard header. Candidates,
 * deliveries and applications rows are the metrics §5.5 / §5.1 / §5.6 rows; vacancies have their own row.
 */
const count = z.number().int().nonnegative().safe();
const day = z.string().date();
const header = {
  definitions_version: z.string().min(1),
  window: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]), from: day, to: day, previous_from: day, previous_to: day }),
  as_of: z.string().datetime({ offset: true }),
  scope: z.enum(["company", "own_vacancies"]),
};
/** The metrics echo plus the dashboard filters (names resolve only for vacancies in the caller's scope). */
export const dashboardAppliedSchema = appliedFiltersSchema.extend({
  in_process: z.boolean().optional(), on: day.optional(), state: z.string().optional(), status: z.string().optional(), from: day.optional(), to: day.optional(),
});
const list = <R extends z.ZodTypeAny, F extends z.ZodTypeAny>(row: R, facets: F) => z.object({
  ...header, total: count, facets, applied_filters: dashboardAppliedSchema, items: z.array(row).max(100), next_cursor: z.string().nullable(),
});

export const dashboardVacancyRowSchema = z.object({
  vacancy: z.object({ draft_id: z.string().min(1), title: z.string().nullable() }), requester: requesterSchema, responsible: personSchema.nullable(),
  status: z.enum(["published", "paused", "closed", "finished"]), published_at: z.string().datetime({ offset: true }), in_process: count,
  positions: z.object({ covered: count, required: count }),
});
export const dashboardCandidateListSchema = list(candidateListRowSchema, z.object({
  stage_kind: z.object({ new: count, screening: count, screening_ok: count, in_process: count, custom: count, placement: count, retired: count.optional() }),
  stalled: count,
}));
export const dashboardDeliveryListSchema = list(deliveryListRowSchema, z.object({ state: z.object({ overdue: count, due_this_week: count }) }));
/** Backend `812903c8`: `positions` sums every filtered row (all pages, role scope, DD3); always present, 0/0 when empty. */
export const dashboardVacancyListSchema = list(dashboardVacancyRowSchema, z.object({ status: z.object({ published: count, paused: count, closed: count, finished: count }) }))
  .extend({ positions: z.object({ covered: count, required: count }) });
/** Its `total` is the sum of applications in the chosen channels, not the row count. */
export const dashboardApplicationListSchema = list(applicationListRowSchema, z.object({ channel: z.object({ portal: count, careers_site: count, manual: count, unknown: count }) }));

export type DashboardApplied = z.infer<typeof dashboardAppliedSchema>;
export type DashboardVacancyRow = z.infer<typeof dashboardVacancyRowSchema>;
export type DashboardCandidateList = z.infer<typeof dashboardCandidateListSchema>;
export type DashboardDeliveryList = z.infer<typeof dashboardDeliveryListSchema>;
export type DashboardVacancyList = z.infer<typeof dashboardVacancyListSchema>;
export type DashboardApplicationList = z.infer<typeof dashboardApplicationListSchema>;
/** One page of a dashboard list, tagged with its kind (the response itself carries none). */
export type DashboardDetailPage =
  | { kind: "candidates"; page: DashboardCandidateList } | { kind: "deliveries"; page: DashboardDeliveryList }
  | { kind: "vacancies"; page: DashboardVacancyList } | { kind: "applications"; page: DashboardApplicationList };
