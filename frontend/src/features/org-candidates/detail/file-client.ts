import "server-only";
import { deadlineStream } from "./deadline-stream";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { CONTENT_TYPES, errorEnvelopeSchema } from "@/features/candidate-cvs/model";
import type { Download } from "@/features/candidate-cvs/file-client";
import type { ClientFailure } from "@/features/candidate-cvs/failure";
import { uuidSchema } from "@/features/pipeline-movement/model";
import { orgCandidateIdentitySchema, type OrgCandidateIdentity } from "./detail-model";

/** Same streaming safeguards as the board; authorization uses the organization pool endpoint. */
export async function downloadOrgCandidateCv(token: string, candidate: OrgCandidateIdentity, participationId: string, version: "current" | "original" = "current"): Promise<{ ok: true; data: Download } | ClientFailure> {
  if (!token?.trim()) return { ok: false, error: { kind: "missing_token" } };
  const identity = orgCandidateIdentitySchema.safeParse(candidate);
  if (!identity.success || !uuidSchema.safeParse(participationId).success) return { ok: false, error: { kind: "invalid_request" } };
  const controller = new AbortController(); let timedOut = false; let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { serverEnv } = await import("@/lib/env/server");
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, serverEnv.apiTimeoutMs);
    const base = new URL(serverEnv.apiBaseUrl);
    const { kind, id } = identity.data;
    const url = new URL(`/v2/me/company/candidates/${kind}/${id}/participations/${participationId}/cv${version === "original" ? "/original" : ""}`, base);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== base.origin || url.username || url.password) return { ok: false, error: { kind: "invalid_request" } };
    const response = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token.trim()}` }, cache: "no-store", redirect: "error", signal: controller.signal });
    if (!response.ok) {
      let envelope;
      try { envelope = errorEnvelopeSchema.parse(await boundedJson(response, 1024, controller.signal)); } catch { /* Never expose upstream text. */ }
      return { ok: false, error: { kind: "status", status: response.status }, ...(envelope ? { envelope } : {}) };
    }
    const contentType = response.headers.get("content-type"), disposition = response.headers.get("content-disposition");
    if (response.status !== 200 || !response.body || !(CONTENT_TYPES as readonly (string | null)[]).includes(contentType) || !disposition || !/^attachment(?:;|$)/i.test(disposition) || /[\r\n]/.test(disposition)) {
      void response.body?.cancel().catch(() => {});
      return { ok: false, error: { kind: "invalid_response" } };
    }
    const deadline = timer;
    const body = deadlineStream(response.body, controller.signal, () => clearTimeout(deadline));
    timer = undefined; // The stream now owns deadline cleanup.
    return { ok: true, data: { body, contentType: contentType!, disposition } };
  } catch { return { ok: false, error: { kind: timedOut ? "timeout" : "network" } }; }
  finally { if (timer) clearTimeout(timer); }
}
