import "server-only";
import { requestJson } from "@/lib/api/server";
import type { OrgCandidateIdentity } from "../detail/detail-model";
import { contactsBodySchema, contactsResponseSchema, contactIdentityKey } from "./contacts-model";

/** Fixed, authenticated export endpoint; contact never enters list or detail caches. */
export async function postCandidateContacts(input: { token: string; candidates: OrgCandidateIdentity[] }) {
 const body = contactsBodySchema.safeParse({ candidates: input.candidates });
 if (typeof input.token !== "string" || !input.token.trim() || !body.success) return { ok: false, error: { kind: "invalid_request", retryable: false } } as const;
 const { serverEnv } = await import("@/lib/env/server");
 const requested = body.data.candidates.map(contactIdentityKey);
 const result = await requestJson(new URL("/v2/me/company/candidates/contacts", serverEnv.apiBaseUrl).toString(), {
  method: "POST", headers: { authorization: `Bearer ${input.token.trim()}` }, body: body.data,
  redirect: "error", expectedStatus: 200, timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192,
  decoder: value => {
   const data = contactsResponseSchema.parse(value);
   let previous = -1;
   for (const item of data.items) {
    const index = requested.indexOf(contactIdentityKey(item));
    if (index <= previous) throw new Error("Unexpected contact identity or order");
    previous = index;
   }
   return data;
  },
 });
 return result.ok ? result : { ...result, error: { ...result.error, retryable: false } };
}
