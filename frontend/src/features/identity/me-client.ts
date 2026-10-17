import "server-only";
import { z } from "zod";
import { requestJson, type RequestJsonError } from "@/lib/api/server";
import type { Identity } from "./model";

const user = z.object({ id: z.string().uuid(), email: z.string().email(), full_name: z.string().min(1) }).strict();
const identitySchema = z.union([
  z.object({ role: z.enum(["candidate", "recruiter"]), user }).strict(),
  z.object({ role: z.null(), user: z.null() }).strict(),
]);
export const errorEnvelopeSchema = z.object({ error: z.string().min(1), code: z.string().min(1) }).strict();
export function decodeIdentity(value: unknown): Identity { return identitySchema.parse(value); }
export type ClientFailure = { ok: false; error: { kind: RequestJsonError["kind"] | "missing_token" | "invalid_request"; status?: number }; envelope?: { error: string; code: string } };
export type ClientResult = { ok: true; data: Identity } | ClientFailure;
export function usableToken(token: unknown): token is string { return typeof token === "string" && token.length > 0 && !/\s/.test(token); }

export async function loadMe({ token }: { token: string }): Promise<ClientResult> {
  if (!usableToken(token)) return { ok: false, error: { kind: "missing_token" } };
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL("/v2/me", serverEnv.apiBaseUrl).toString(), {
    method: "GET", expectedStatus: 200, redirect: "error", headers: { authorization: `Bearer ${token}` },
    timeoutMs: serverEnv.apiTimeoutMs, decoder: decodeIdentity,
    errorDecoder: value => errorEnvelopeSchema.parse(value), maxErrorBodyBytes: 1024,
  });
}
