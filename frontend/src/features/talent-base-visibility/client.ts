import "server-only";
import { requestJson } from "@/lib/api/server";
import { talentBaseErrorEnvelopeSchema, talentBaseVisibilityBodySchema, talentBaseVisibilitySchema, type TalentBaseVisibility, type TalentBaseVisibilityBody } from "./model";

const PATH = "/v2/me/company/talent-base-visibility";
/** A 412 answers with the current document; every other failure answers with the standard envelope. */
type ErrorBody = { kind: "document"; document: TalentBaseVisibility } | { kind: "envelope"; code: string; fields?: { field: string; code: string }[] };
function decodeErrorBody(value: unknown): ErrorBody {
  const document = talentBaseVisibilitySchema.safeParse(value);
  if (document.success) return { kind: "document", document: document.data };
  const envelope = talentBaseErrorEnvelopeSchema.parse(value);
  return { kind: "envelope", code: envelope.code, ...(envelope.fields ? { fields: envelope.fields } : {}) };
}

export async function getTalentBaseVisibility(token: string) {
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL(PATH, serverEnv.apiBaseUrl).toString(), {
    headers: { authorization: `Bearer ${token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 16384,
    decoder: value => talentBaseVisibilitySchema.parse(value), errorDecoder: decodeErrorBody,
  });
}

/** The caller sends the quoted version as If-Match; auth and body are validated before transport. */
export async function putTalentBaseVisibility(token: string, etag: string, body: TalentBaseVisibilityBody) {
  const payload = talentBaseVisibilityBodySchema.parse(body);
  const { serverEnv } = await import("@/lib/env/server");
  return requestJson(new URL(PATH, serverEnv.apiBaseUrl).toString(), {
    method: "PUT", headers: { authorization: `Bearer ${token.trim()}`, "if-match": etag }, body: payload,
    redirect: "error", expectedStatus: 200, timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 16384,
    decoder: value => talentBaseVisibilitySchema.parse(value), errorDecoder: decodeErrorBody,
  });
}
