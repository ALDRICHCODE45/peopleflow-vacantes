import "server-only";

import { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";

const kindSchema = z.enum(["internal_area", "client"]);
const nameSchema = z.string().refine((value) =>
  value.trim() !== "" && [...value].length <= 160 &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value),
);
const cursorSchema = z.string().min(1).max(4096).regex(/^[A-Za-z0-9_-]+$/);
const entrySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  kind: kindSchema,
  name: nameSchema,
}).strict();
const listSchema = z.object({
  items: z.array(entrySchema).max(50),
  next_cursor: cursorSchema.nullable(),
}).strict();
const envelopeSchema = z.object({
  error: z.string().min(1),
  code: z.string().min(1),
  data: z.object({ existing: entrySchema }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.code === "requester_already_exists") !== (value.data !== undefined)) {
    ctx.addIssue({ code: "custom", message: "unexpected error data" });
  }
});

export type Requester = z.infer<typeof entrySchema>;
export type RequesterKind = Requester["kind"];
export type RequesterFailure = {
  ok: false;
  error:
    | { kind: RequestJsonError["kind"]; retryable: boolean; status?: number }
    | { kind: "missing_token" | "invalid_request" | "invalid_name"; retryable: false };
  envelope?: z.infer<typeof envelopeSchema>;
};
type Result<T> = { ok: true; data: T } | RequesterFailure;
type Identity = { token: string; kind: RequesterKind };

const fail = (kind: "missing_token" | "invalid_request" | "invalid_name"): RequesterFailure =>
  ({ ok: false, error: { kind, retryable: false } });

function guard(input: Identity) {
  if (typeof input?.token !== "string" || !input.token.trim()) return fail("missing_token");
  if (!kindSchema.safeParse(input.kind).success) return fail("invalid_request");
}

function checkKind(entry: Requester, kind: RequesterKind) {
  if (entry.kind !== kind) throw new Error("Unexpected requester kind");
  return entry;
}

/** Prefix search with opaque cursor passthrough. No credentials or env read before guards. */
export async function listRequesters(
  input: Identity & { q?: string; cursor?: string; limit?: number },
): Promise<Result<z.infer<typeof listSchema>>> {
  const invalid = guard(input);
  if (invalid) return invalid;
  if (
    (input.q !== undefined && (typeof input.q !== "string" || [...input.q].length > 160)) ||
    (input.cursor !== undefined && !cursorSchema.safeParse(input.cursor).success) ||
    (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50))
  ) return fail("invalid_request");

  const { serverEnv } = await import("@/lib/env/server");
  const query = new URLSearchParams({ kind: input.kind });
  if (input.q !== undefined) query.set("q", input.q);
  if (input.limit !== undefined) query.set("limit", String(input.limit));
  if (input.cursor !== undefined) query.set("cursor", input.cursor);

  return requestJson(
    new URL(`/me/company/requesters?${query}`, serverEnv.apiBaseUrl).toString(),
    {
      headers: { authorization: `Bearer ${input.token.trim()}` },
      redirect: "error",
      expectedStatus: 200,
      timeoutMs: serverEnv.apiTimeoutMs,
      maxErrorBodyBytes: 8192,
      decoder: (value) => {
        const list = listSchema.parse(value);
        list.items.forEach((entry) => checkKind(entry, input.kind));
        return list;
      },
      errorDecoder: (value) => envelopeSchema.parse(value),
    },
  );
}

/** One explicit create; normalization belongs to the backend, and no write is retried. */
export async function createRequester(
  input: Identity & { name: string },
): Promise<Result<Requester>> {
  const invalid = guard(input);
  if (invalid) return invalid;
  if (!nameSchema.safeParse(input.name).success) return fail("invalid_name");

  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(
    new URL("/me/company/requesters", serverEnv.apiBaseUrl).toString(),
    {
      method: "POST",
      body: { kind: input.kind, name: input.name },
      headers: { authorization: `Bearer ${input.token.trim()}` },
      redirect: "error",
      expectedStatus: 201,
      timeoutMs: serverEnv.apiTimeoutMs,
      maxErrorBodyBytes: 8192,
      decoder: (value) => checkKind(entrySchema.parse(value), input.kind),
      errorDecoder: (value) => {
        const envelope = envelopeSchema.parse(value);
        if (envelope.data) checkKind(envelope.data.existing, input.kind);
        return envelope;
      },
    },
  );
  return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}
