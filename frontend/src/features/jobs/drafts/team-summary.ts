import { z } from "zod";

/** Required read-only summary shared by the draft list and v2 GET/POST/PATCH. */
export const draftTeamSummarySchema = z.object({
  mode: z.enum(["with_responsible", "shared"]),
  responsible: z.object({ id: z.string().uuid(), name: z.string().nullable() }).strict().nullable(),
  members_count: z.number().int().nonnegative(),
  viewer_function: z.enum(["responsible", "collaborator", "member"]).nullable(),
}).strict();
