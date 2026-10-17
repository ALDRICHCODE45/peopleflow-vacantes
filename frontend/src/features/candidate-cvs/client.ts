import "server-only";
import { requestJson } from "@/lib/api/server";
import { cvSchema, librarySchema, renameSchema, uuidSchema, errorEnvelopeSchema, type Cv, type CvLibrary } from "./model";
import { deleteFile } from "./file-client";
import type { ClientFailure } from "./failure";
export type ClientResult<T> = { ok: true; data: T } | ClientFailure;
export function usableToken(token: unknown): token is string { return typeof token === "string" && token.length > 0 && !/\s/.test(token); }
export async function loadCvs({ token }: { token: string }): Promise<ClientResult<CvLibrary>> {
  if (!usableToken(token)) return { ok: false, error: { kind: "missing_token" } };
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL("/v2/me/cvs", serverEnv.apiBaseUrl).toString(), {
    method: "GET", expectedStatus: 200, redirect: "error", headers: { authorization: `Bearer ${token}` },
    timeoutMs: serverEnv.apiTimeoutMs, decoder: value => librarySchema.parse(value),
    errorDecoder: value => errorEnvelopeSchema.parse(value), maxErrorBodyBytes: 1024,
  });
}
export async function renameCv({ token, id, body }: { token: string; id: unknown; body: unknown }): Promise<ClientResult<Cv>> {
  if (!usableToken(token)) return { ok: false, error: { kind: "missing_token" } };
  const parsed = renameSchema.safeParse(body);
  if (!uuidSchema.safeParse(id).success || !parsed.success) return { ok: false, error: { kind: "invalid_request" } };
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL(`/v2/me/cvs/${id}`, serverEnv.apiBaseUrl).toString(), {
    method: "PATCH", body: parsed.data, expectedStatus: 200, redirect: "error", headers: { authorization: `Bearer ${token}` },
    timeoutMs: serverEnv.apiTimeoutMs, decoder: value => {
      const cv = cvSchema.parse(value);
      if (cv.id.toLowerCase() !== (id as string).toLowerCase()) throw new Error("Unexpected CV");
      return cv;
    },
    errorDecoder: value => errorEnvelopeSchema.parse(value), maxErrorBodyBytes: 1024,
  });
}
export async function deleteCv({ token, id }: { token: string; id: unknown }): Promise<ClientResult<null>> {
  if (!usableToken(token)) return { ok: false, error: { kind: "missing_token" } };
  if (!uuidSchema.safeParse(id).success) return { ok: false, error: { kind: "invalid_request" } };
  return deleteFile(token, id as string);
}
