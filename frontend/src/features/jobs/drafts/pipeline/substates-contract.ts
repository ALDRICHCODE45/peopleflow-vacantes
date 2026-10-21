import { z } from "zod";
import { isValidJobId } from "@/features/jobs/jobId";
import { processFinishedSchema } from "./lifecycle-contract";
export const substateErrorSchema = z.union([
  processFinishedSchema,
  z.object({ error: z.string().min(1), code: z.literal("substate_in_use"), details: z.array(z.object({ substate_id: z.string().length(36).refine(isValidJobId) }).strict()).min(1) }).strict(),
  z.object({ error: z.string().min(1), code: z.string().min(1).refine(code => code !== "substate_in_use" && code !== "process_finished") }).strict(),
]);
