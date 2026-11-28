import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { decodeIdentity, errorEnvelopeSchema, usableToken, type ClientResult } from "./me-client";
import { normalizedName, validName } from "./model";

const bodySchema = z.object({ full_name: z.string().transform(normalizedName).refine(validName) }).strict();

/**
 * POST /v2/me/employer-account (embedded-auth-v1, L8/L12): the only path that
 * makes a self-service account a recruiter. One explicit write; the email and
 * its verification come from Cognito on the API side, never from here. No
 * company or membership is created (POST /companies does that next).
 */
export async function createEmployerAccount(input: { token: string; body: unknown }): Promise<ClientResult> {
  if (!usableToken(input.token)) return { ok: false, error: { kind: "missing_token" } };
  const body = bodySchema.safeParse(input.body);
  if (!body.success) return { ok: false, error: { kind: "invalid_request" } };
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL("/v2/me/employer-account", serverEnv.apiBaseUrl).toString(), {
    method: "POST", body: body.data, redirect: "error", headers: { authorization: `Bearer ${input.token}` },
    // Contract: 201 created or 200 already a recruiter (retry); any other 2xx is unconfirmed.
    expectedStatus: [200, 201],
    timeoutMs: serverEnv.apiTimeoutMs,
    decoder: value => {
      const data = decodeIdentity(value);
      if (data.role !== "recruiter") throw new Error("Invalid identity result");
      return data;
    },
    errorDecoder: value => errorEnvelopeSchema.parse(value), maxErrorBodyBytes: 1024,
  });
}
