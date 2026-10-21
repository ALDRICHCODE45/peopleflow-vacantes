import "server-only";

import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { isValidJobId } from "@/features/jobs/jobId";
import { publicationErrorEnvelopeSchema } from "@/features/jobs/drafts/pipeline/failure";
import { decodeLifecycleEtag, lifecycleActionSchema, lifecycleSchema, type Lifecycle } from "./model";

export const conflictSchema = z.object({
  error: z.string().min(1),
  code: z.enum(["lifecycle_transition_invalid", "process_finished"]),
  data: z.object({ action: lifecycleActionSchema.optional(), lifecycle: lifecycleSchema }).strict(),
}).strict().refine(value => value.code !== "lifecycle_transition_invalid" || value.data.action !== undefined);
export function decodeLifecycleError(value: unknown) {
  const code = z.object({ code: z.string() }).parse(value).code;
  return code === "lifecycle_transition_invalid" || code === "process_finished"
    ? conflictSchema.parse(value) : publicationErrorEnvelopeSchema.parse(value);
}
export type LifecycleFailure = {
  ok: false;
  error: { kind: "missing_token" | "invalid_request" | "invalid_response" | "not_found" | "status" | "network" | "timeout"; retryable: false; status?: number };
  envelope?: ReturnType<typeof decodeLifecycleError>;
};
export type LifecycleResult = { ok: true; data: Lifecycle; etag: string; idempotencyReplayed?: "true" | "false" } | LifecycleFailure;
type ReadInput = { token: string; draftId: string };
export type TransitionInput = ReadInput & { ifMatch: string; idempotencyKey: string } & (
  | { action: "close"; body: { process: "continue" | "finish" } }
  | { action: "pause" | "resume" | "finish_process" | "reopen"; body: Record<string, never> }
);
const transitionSchema = z.union([
  z.object({ action: z.literal("close"), body: z.object({ process: z.enum(["continue", "finish"]) }).strict() }),
  z.object({ action: z.enum(["pause", "resume", "finish_process", "reopen"]), body: z.object({}).strict() }),
]);
function invalid(kind: LifecycleFailure["error"]["kind"]): LifecycleFailure { return { ok: false, error: { kind, retryable: false } }; }
async function requestLifecycle(input: ReadInput, write?: TransitionInput): Promise<LifecycleResult> {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (!isValidJobId(input.draftId)) return invalid("invalid_request");
  if (write) {
    if (!isValidJobId(write.idempotencyKey) || !transitionSchema.safeParse(write).success) return invalid("invalid_request");
    try { decodeLifecycleEtag(write.ifMatch, input.draftId); } catch { return invalid("invalid_request"); }
  }
  const { serverEnv } = await import("@/lib/env/server");
  const suffix = write ? `/${write.action.replace("_", "-")}` : "";
  const result = await requestJson(new URL(`/v2/me/company/job-drafts/${input.draftId}/lifecycle${suffix}`, serverEnv.apiBaseUrl).toString(), {
    method: write ? "POST" : "GET", redirect: "error", expectedStatus: 200,
    headers: { authorization: `Bearer ${input.token.trim()}`, ...(write ? { "if-match": write.ifMatch, "idempotency-key": write.idempotencyKey } : {}) },
    ...(write ? { body: write.body } : {}),
    captureResponseHeaders: ["etag", "idempotency-replayed"], timeoutMs: serverEnv.apiTimeoutMs,
    maxErrorBodyBytes: 8192, decoder: value => lifecycleSchema.parse(value), errorDecoder: decodeLifecycleError,
  });
  if (!result.ok) return { ...result, error: { ...result.error, retryable: false } };
  let etag: string;
  try { etag = decodeLifecycleEtag(result.headers?.etag, input.draftId, result.data.version); } catch { return invalid("invalid_response"); }
  const replayed = result.headers?.["idempotency-replayed"];
  if (write && replayed !== "true" && replayed !== "false") return invalid("invalid_response");
  return { ok: true, data: result.data, etag, ...(write && (replayed === "true" || replayed === "false") ? { idempotencyReplayed: replayed } : {}) };
}
export async function getLifecycle(input: ReadInput): Promise<LifecycleResult> { return requestLifecycle(input); }
/** The caller creates one UUID per confirmed intent and retains it for exact replays. No retries. */
export async function transitionLifecycle(input: TransitionInput): Promise<LifecycleResult> { return requestLifecycle(input, input); }
