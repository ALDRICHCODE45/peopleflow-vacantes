import "server-only";
import type { z } from "zod";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { usableToken } from "@/features/candidate-cvs/client";
import { jobIdSchema, removedJobsSchema, savedJobIdsSchema, savedJobSchema, savedJobsErrorSchema, savedJobsSchema, type SavedJobsFailure, type SavedJobsResult } from "./model";

async function failure(response: Response, signal: AbortSignal): Promise<SavedJobsFailure> {
  let envelope: z.infer<typeof savedJobsErrorSchema> | undefined;
  try { envelope = savedJobsErrorSchema.parse(await boundedJson(response, 4096, signal)); } catch { /* Never expose a raw error or unknown code. */ }
  const status = response.status;
  const code = envelope?.code;
  const reference = { status, ...(code ? { code } : {}) };
  if (status === 401) return { ok: false, reason: "unauthenticated", reference };
  if (status === 403) return { ok: false, reason: "forbidden", reference };
  if (status >= 500) return { ok: false, reason: "server_error", reference };
  if (status === 404 && code === "not_found") return { ok: false, reason: code, reference };
  if (status === 409 && code === "job_unavailable") return { ok: false, reason: code, reference };
  if (status === 409 && envelope?.code === "saved_jobs_limit") return { ok: false, reason: envelope.code, limit: envelope.data.limit, reference };
  if (status === 400 && code === "validation_error") return { ok: false, reason: code, reference };
  return { ok: false, reason: "unrecognized_response", reference };
}

/** Mirrors candidate-cvs: server-only Bearer, no cache/redirects, bounded bodies and deadline. */
async function request<T>(token: string, suffix: string, method: "GET" | "PUT" | "DELETE", statuses: number[], schema?: z.ZodType<T>): Promise<SavedJobsResult<T>> {
  if (!usableToken(token)) return { ok: false, reason: "unauthenticated", reference: {} };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const { serverEnv } = await import("@/lib/env/server");
    timer = setTimeout(() => controller.abort(), serverEnv.apiTimeoutMs);
    // Only these endpoint suffixes can reach the configured backend origin.
    if (!["", "/ids", "?availability=closed"].includes(suffix) && !jobIdSchema.safeParse(suffix.slice(1)).success)
      return { ok: false, reason: "not_found", reference: {} };
    const base = new URL(serverEnv.apiBaseUrl);
    const url = new URL(`/v2/me/saved-jobs${suffix}`, base);
    if (!["https:", "http:"].includes(url.protocol) || url.origin !== base.origin || url.username || url.password)
      return { ok: false, reason: "no_response", reference: {} };
    const response = await fetch(url, {
      method, headers: new Headers({ authorization: `Bearer ${token}`, accept: "application/json" }),
      redirect: "error", cache: "no-store", signal: controller.signal,
    });
    if (!response.ok) return await failure(response, controller.signal);
    if (!statuses.includes(response.status)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, reason: "unrecognized_response", reference: { status: response.status } };
    }
    if (response.status === 204) return { ok: true, data: null as T };
    try {
      return { ok: true, data: schema!.parse(await boundedJson(response, 2_097_152, controller.signal)) };
    } catch { return { ok: false, reason: controller.signal.aborted ? "no_response" : "unrecognized_response", reference: { status: response.status } }; }
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
  finally { if (timer) clearTimeout(timer); }
}
export function loadSavedJobs({ token }: { token: string }) { return request(token, "", "GET", [200], savedJobsSchema); }
export function loadSavedJobIds({ token }: { token: string }) { return request(token, "/ids", "GET", [200], savedJobIdsSchema); }
export function removeClosedSavedJobs({ token }: { token: string }) { return request(token, "?availability=closed", "DELETE", [200], removedJobsSchema); }
export async function saveJob({ token, id }: { token: string; id: unknown }) {
  if (!jobIdSchema.safeParse(id).success) return { ok: false as const, reason: "not_found" as const, reference: {} };
  const result = await request(token, `/${id}`, "PUT", [200, 201], savedJobSchema);
  return result.ok && result.data.job_id.toLowerCase() !== (id as string).toLowerCase()
    ? { ok: false as const, reason: "unrecognized_response" as const, reference: {} } : result;
}
export function removeSavedJob({ token, id }: { token: string; id: unknown }): Promise<SavedJobsResult<null>> {
  if (!jobIdSchema.safeParse(id).success) return Promise.resolve({ ok: false, reason: "not_found", reference: {} });
  return request<null>(token, `/${id}`, "DELETE", [204]);
}
