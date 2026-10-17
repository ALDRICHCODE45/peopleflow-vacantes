import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { decodeIdentity, errorEnvelopeSchema, usableToken, type ClientResult } from "./me-client";
import { normalizedName, validName } from "./model";

const bodySchema = z.object({ full_name: z.string().transform(normalizedName).refine(validName) }).strict();
/** One explicit write only. Email is resolved by the API from Cognito, never supplied here. */
export async function createCandidateAccount(input: { token: string; body: unknown }): Promise<ClientResult> {
  if (!usableToken(input.token)) return { ok: false, error: { kind: "missing_token" } };
  const body = bodySchema.safeParse(input.body);
  if (!body.success) return { ok: false, error: { kind: "invalid_request" } };
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL("/v2/me/candidate-account", serverEnv.apiBaseUrl).toString(), {
    method: "POST", body: body.data, redirect: "error", headers: { authorization: `Bearer ${input.token}` },
    // Contract: 201 created or 200 already a candidate; any other 2xx is unconfirmed.
    expectedStatus: [200, 201],
    timeoutMs: serverEnv.apiTimeoutMs,
    decoder: value => {
      const data = decodeIdentity(value);
      if (data.role !== "candidate") throw new Error("Invalid identity result");
      return data;
    },
    errorDecoder: value => errorEnvelopeSchema.parse(value), maxErrorBodyBytes: 1024,
  });
}
