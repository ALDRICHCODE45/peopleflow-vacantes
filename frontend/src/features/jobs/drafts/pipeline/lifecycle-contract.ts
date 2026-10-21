import { z } from "zod";
import { lifecycleSchema, type Lifecycle } from "@/features/vacancy-lifecycle/model";

export const processFinishedSchema = z.object({
  error: z.string().min(1), code: z.literal("process_finished"),
  data: z.object({ lifecycle: lifecycleSchema }).strict(),
}).strict();
export type ProcessFinishedFailure = {
  ok: false; reason: "process_finished"; lifecycle: Lifecycle;
  reference: { status?: number; code?: string };
};
