import { z } from "zod";
import { closeReasonSchema, closeResultLabel, processKindSchema } from "@/features/vacancy-lifecycle/model";
import { isValidJobId } from "@/features/jobs/jobId";

/**
 * `GET /v2/me/company/stakeholder/vacancies` (owner and stakeholder; placement-vacancy-documents P7c, L8). Pure schema, no I/O.
 * `publication` uses the lifecycle vocabulary, so `null` is a draft that never published (unlike the job-drafts list's `draft`);
 * `process`, `visibility`, `close_reason` and `coverage` are null for it, and `title` while it has none.
 */
const id = z.string().refine(isValidJobId, "Invalid vacancy id.");
const count = z.number().int().nonnegative().safe();

export const stakeholderVacancySchema = z.object({
  id,
  title: z.string().nullable(),
  publication: z.enum(["published", "paused", "closed"]).nullable(),
  process: z.enum(["active", "finished"]).nullable(),
  kind: processKindSchema,
  visibility: z.enum(["public", "private"]).nullable(),
  close_reason: closeReasonSchema.nullable(),
  coverage: z.object({ covered: count, required: z.number().int().positive().safe().nullable() }).strict().nullable(),
  documents_count: count,
}).strict().refine(row => row.publication === null ? row.process === null : row.process === "active" || (row.publication === "closed" && row.process === "finished"),
  { message: "publication and process disagree.", path: ["process"] });

/** Keyset page: at most 50 rows (`limit` 1..50, default 20), `next_cursor` opaque and null on the last page. */
export const stakeholderVacanciesSchema = z.object({
  items: z.array(stakeholderVacancySchema).max(50),
  next_cursor: z.string().nullable(),
}).strict();

export type StakeholderVacancy = z.infer<typeof stakeholderVacancySchema>;
export type StakeholderVacanciesPage = z.infer<typeof stakeholderVacanciesSchema>;

/** The client-side filters of the list, the same four states as the recruiter portfolio. */
export type StatusFilter = "all" | "draft" | "active" | "paused" | "closed";
export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" }, { value: "draft", label: "Borradores" }, { value: "active", label: "Activas" }, { value: "paused", label: "Pausadas" }, { value: "closed", label: "Cerradas" },
];

export function statusFilterOf(row: Pick<StakeholderVacancy, "publication">): Exclude<StatusFilter, "all"> {
  switch (row.publication) {
    case null: return "draft";
    case "published": return "active";
    case "paused": return "paused";
    case "closed": return "closed";
  }
}

/** «Cerrada · Cubierta al cierre» when the live coverage fell below the required places (S8), like the recruiter portfolio. */
export function statusLabelOf(row: Pick<StakeholderVacancy, "publication" | "close_reason" | "coverage">): string {
  switch (row.publication) {
    case null: return "Borrador";
    case "published": return "Activa";
    case "paused": return "Pausada";
    case "closed": return `Cerrada · ${closeResultLabel(row.close_reason, row.coverage ?? undefined)}`;
  }
}
