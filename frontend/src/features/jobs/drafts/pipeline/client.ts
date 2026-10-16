import "server-only";

import { z } from "zod";
import { isValidJobId } from "@/features/jobs/jobId";
import { requestJson, type RequestJsonError } from "@/lib/api/server";

const uuid = z.string().length(36).refine(isValidJobId);
const stageKindSchema = z.enum(["new", "screening", "screening_ok", "in_process", "placement", "custom"]);
const stageSchema = z.object({ id: uuid, kind: stageKindSchema, name: z.string() }).strict();
const pipelineSchema = z.object({
  // The final assertion requires end-of-input, including after a trailing newline.
  version: z.string().regex(/^(0|[1-9][0-9]*)$(?![\s\S])/),
  stages: z.array(stageSchema),
  exit: z.object({ id: uuid, kind: z.literal("discarded"), name: z.string() }).strict(),
  limits: z.object({ maxCustomStages: z.number().int().positive(), nameMaxLength: z.number().int().positive() }).strict(),
}).strict();
const putBodySchema = z.object({
  stages: z.array(z.object({ id: uuid.optional(), name: z.string() }).strict()),
  exit: z.object({ id: uuid, name: z.string() }).strict(),
}).strict();
const envelopeSchema = z.object({ error: z.string().min(1), code: z.string().min(1) }).strict();

export type DraftPipeline = z.infer<typeof pipelineSchema>;
export type DraftPipelineStage = z.infer<typeof stageSchema>;
export type PipelineStageKind = z.infer<typeof stageKindSchema>;
export type DraftPipelinePutBody = z.infer<typeof putBodySchema>;
export type DraftPipelineFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: false; status?: number };
  envelope?: z.infer<typeof envelopeSchema>;
};
export type DraftPipelineResult = { ok: true; data: DraftPipeline; etag: string } | DraftPipelineFailure;
type ReadInput = { token: string; draftId: string };
export type SaveDraftPipelineInput = ReadInput & { ifMatch: string; body: unknown };

function invalid(kind: "missing_token" | "invalid_request" | "invalid_response"): DraftPipelineFailure {
  return { ok: false, error: { kind, retryable: false } };
}

function guard(input: ReadInput): DraftPipelineFailure | undefined {
  if (typeof input?.token !== "string" || !input.token.trim()) return invalid("missing_token");
  if (typeof input.draftId !== "string" || input.draftId.length !== 36 || !isValidJobId(input.draftId))
    return invalid("invalid_request");
}

async function requestPipeline(
  input: ReadInput,
  write?: { ifMatch: string; body: DraftPipelinePutBody },
): Promise<DraftPipelineResult> {
  // Guards run before environment validation or network access.
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(
    new URL(`/v2/me/company/job-drafts/${input.draftId}/pipeline`, serverEnv.apiBaseUrl).toString(),
    {
      method: write ? "PUT" : "GET",
      headers: {
        authorization: `Bearer ${input.token.trim()}`,
        ...(write ? { "if-match": write.ifMatch } : {}),
      },
      ...(write ? { body: write.body } : {}),
      redirect: "error",
      expectedStatus: 200,
      captureResponseHeaders: ["etag"],
      timeoutMs: serverEnv.apiTimeoutMs,
      maxErrorBodyBytes: 8192,
      decoder: value => pipelineSchema.parse(value),
      errorDecoder: value => envelopeSchema.parse(value),
    },
  );
  // An uncertain write is reconciled with an explicit GET, never replayed.
  if (!result.ok) return { ...result, error: { ...result.error, retryable: false } };
  const etag = result.headers?.etag;
  if (etag === undefined || !etag.trim()) return invalid("invalid_response");
  return { ok: true, data: result.data, etag };
}

/** Reads the private draft pipeline; versions and ETags remain opaque strings. */
export async function getDraftPipeline(input: ReadInput): Promise<DraftPipelineResult> {
  const failure = guard(input);
  return failure ?? requestPipeline(input);
}

/** Full replacement. Only shape is checked here; the editor owns business invariants. */
export async function saveDraftPipeline(input: SaveDraftPipelineInput): Promise<DraftPipelineResult> {
  const failure = guard(input);
  if (failure) return failure;
  if (typeof input.ifMatch !== "string" || !input.ifMatch.trim()) return invalid("invalid_request");
  const body = putBodySchema.safeParse(input.body);
  if (!body.success) return invalid("invalid_request");
  return requestPipeline(input, { ifMatch: input.ifMatch, body: body.data });
}
