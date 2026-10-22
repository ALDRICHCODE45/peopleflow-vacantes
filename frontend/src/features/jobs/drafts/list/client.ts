import "server-only";

import { z } from "zod";
import { closeReasonSchema } from "@/features/vacancy-lifecycle/model";
import { requestJson, type RequestJsonError } from "@/lib/api/server";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const timestamp = z.string().datetime({ offset: true });
const requesterSchema = z.object({
  kind: z.enum(["internal_area", "client"]),
  id: uuid.nullable(),
  name: z.string().nullable(),
}).strict().refine((value) => value.id === null || typeof value.name === "string");
const candidatesSchema = z.object({
  total: z.number().int().nonnegative(),
  in_process: z.number().int().nonnegative(),
  discarded: z.number().int().nonnegative(),
  by_stage: z.array(z.object({
    id: uuid,
    kind: z.enum(["new", "screening", "screening_ok", "custom", "in_process", "placement"]),
    name: z.string(),
    count: z.number().int().nonnegative(),
  }).strict()),
}).strict();
const rowSchema = z.object({
  id: uuid,
  title: z.string().nullable(),
  status: z.enum(["draft", "published", "paused", "closed"]),
  process: z.enum(["active", "finished"]).nullable(),
  published_at: timestamp.nullable(),
  paused_at: timestamp.nullable(),
  closed_at: timestamp.nullable(),
  close_reason: closeReasonSchema.nullable(),
  close_reason_note: z.string().nullable(),
  process_finished_at: timestamp.nullable(),
  candidates: candidatesSchema.nullable(),
  work_mode: z.enum(["onsite", "remote", "hybrid"]).nullable(),
  work_schedule: z.enum(["full_time", "part_time"]).nullable(),
  requester: requesterSchema.nullable(),
  principal_recruiter: z.object({ id: uuid, name: z.string().nullable() }).strict(),
  version: z.string().regex(/^[1-9][0-9]*$/),
  created_at: timestamp,
  updated_at: timestamp,
}).strict().refine(row => row.status === "draft" ? row.process === null :
  row.process === "active" || (row.status === "closed" && row.process === "finished"))
  .refine(row => (row.status === "draft") === (row.candidates === null));
const listSchema = z.object({
  items: z.array(rowSchema).max(50),
  next_cursor: z.string().nullable(),
}).strict();
const envelopeSchema = z.object({ error: z.string().min(1), code: z.string().min(1) }).strict();

export type DraftListRow = z.infer<typeof rowSchema>;
export type ListDraftsFailure = {
  ok: false;
  error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; retryable: boolean; status?: number };
  envelope?: z.infer<typeof envelopeSchema>;
};
export type ListDraftsResult = { ok: true; data: z.infer<typeof listSchema> } | ListDraftsFailure;
export type DraftListQuery = { cursor?: string; limit?: number };

/** Private v2 list. Cursors remain opaque, versions remain decimal strings. */
export async function listDrafts(input: DraftListQuery & { token: string }): Promise<ListDraftsResult> {
  if (typeof input?.token !== "string" || !input.token.trim())
    return { ok: false, error: { kind: "missing_token", retryable: false } };
  if ((input.cursor !== undefined && typeof input.cursor !== "string") ||
      (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50)))
    return { ok: false, error: { kind: "invalid_request", retryable: false } };

  const { serverEnv } = await import("@/lib/env/server");
  const query = new URLSearchParams({ limit: String(input.limit ?? 20) });
  if (input.cursor !== undefined) query.set("cursor", input.cursor);
  // Same absolute v2 path construction as api/client-v2.ts (never inherit /v1).
  const result = await requestJson(
    new URL(`/v2/me/company/job-drafts?${query}`, serverEnv.apiBaseUrl).toString(),
    {
      headers: { authorization: `Bearer ${input.token.trim()}` },
      redirect: "error",
      expectedStatus: 200,
      timeoutMs: serverEnv.apiTimeoutMs,
      maxErrorBodyBytes: 8192,
      decoder: (value) => listSchema.parse(value),
      errorDecoder: (value) => envelopeSchema.parse(value),
    },
  );
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}
