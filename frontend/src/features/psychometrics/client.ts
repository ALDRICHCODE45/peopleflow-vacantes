import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { boundedJson } from "@/features/candidate-cvs/bounded-body";
import { etagSchema } from "@/features/pipeline-movement/model";
import { lifecycleSchema } from "@/features/vacancy-lifecycle/model";
import * as m from "./model";
import { assessmentTokenSegment } from "./link";
export type ReadInput = { token: string; vacancyId: string };
export type SaveProfileInput = ReadInput & { ifMatch: string; body: unknown };
export type ParticipationTarget = ReadInput & { participationId: string };
export type InvitationTarget = ReadInput & { invitationId: string };
/** Public access is deliberately distinct from the session bearer token. Never log this input or its URL. */
export type CandidateInput = { access: "public"; assessmentToken: string } | { access: "account"; token: string; invitationId: string };
export type CandidateBodyInput = CandidateInput & { body: unknown };
export type AnswerInput = CandidateBodyInput & { position: number };
const knownCodes = z.enum([...m.ERROR_CODES, "version_conflict", "precondition_required", "validation_error", "invalid_request", "unauthenticated", "forbidden", "not_found", "server_error"]);
const envelopeSchema = z.object({ code: knownCodes, error: z.string().optional(), fields: z.array(m.validationFieldSchema).optional(), data: z.union([z.object({ missing_positions: z.array(m.positionSchema) }).strict(), z.object({ lifecycle: lifecycleSchema }).strict()]).optional() }).strict();
type Envelope = z.infer<typeof envelopeSchema>;
const fail = (reason: m.FailureReason, status?: number, envelope?: Envelope): m.Result<never> => ({ ok: false, reason, reference: { ...(status === undefined ? {} : { status }), ...(envelope ? { code: envelope.code } : {}) }, ...(reason === "validation_error" && envelope?.fields ? { fields: envelope.fields } : {}), ...(reason === "incomplete" && envelope?.data && "missing_positions" in envelope.data ? { missing_positions: envelope.data.missing_positions } : {}) });
const codeStatus: Record<m.ErrorCode, number> = { assessment_unavailable: 404, consent_required: 403, notice_changed: 409, assessment_finished: 409, invitation_closed: 409, incomplete: 422, profile_disabled: 409, profile_unconfirmed: 409, already_finished: 409, participation_inactive: 409, process_finished: 409, rate_limited: 429 };
function failure(status?: number, envelope?: Envelope): m.Result<never> {
  const code = m.errorCodeSchema.safeParse(envelope?.code);
  if (code.success && codeStatus[code.data] === status) return fail(code.data, status, envelope);
  const reasons: Record<number, m.FailureReason> = { 401: "unauthenticated", 403: "forbidden", 404: "not_found", 412: "version_conflict", 428: "precondition_required", 429: "rate_limited" };
  return fail(status === undefined ? "no_response" : status === 400 ? envelope?.code === "validation_error" ? "validation_error" : "invalid_request" : reasons[status] ?? (status >= 500 ? "server_error" : "unrecognized_response"), status, envelope);
}
function guard(input: ReadInput | ParticipationTarget | InvitationTarget): m.Result<never> | undefined {
  if (!input.token?.trim()) return fail("unauthenticated");
  if (!m.uuidSchema.safeParse(input.vacancyId).success || ("participationId" in input && !m.uuidSchema.safeParse(input.participationId).success) || ("invitationId" in input && !m.uuidSchema.safeParse(input.invitationId).success)) return fail("invalid_request");
}
async function employerRequest<T>(input: ReadInput, path: string, schema: z.ZodType<T>, method = "GET", expectedStatus: number | readonly number[] = 200, body?: unknown, withEtag = false, ifMatch?: string): Promise<m.Result<T>> {
  try {
    const { serverEnv } = await import("@/lib/env/server");
    const result = await requestJson(new URL(`/v2/me/company/job-drafts/${input.vacancyId}/${path}`, serverEnv.apiBaseUrl).toString(), { method, expectedStatus, headers: { authorization: `Bearer ${input.token.trim()}`, ...(ifMatch ? { "if-match": ifMatch } : {}) }, ...(body === undefined ? {} : { body }), redirect: "error", captureResponseHeaders: ["etag"], timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192, decoder: value => schema.parse(value), errorDecoder: value => envelopeSchema.parse(value) });
    if (!result.ok) return result.error.kind === "invalid_response" ? fail("unrecognized_response") : failure("status" in result.error ? result.error.status : undefined, result.envelope);
    if (withEtag && !etagSchema.safeParse(result.headers?.etag).success) return fail("unrecognized_response");
    return { ok: true, data: result.data, ...(withEtag ? { etag: result.headers!.etag! } : {}) };
  } catch { return fail("no_response"); }
}
export async function getProfile(input: ReadInput): Promise<m.Result<m.Profile>> { return guard(input) ?? employerRequest(input, "psychometric-profile", m.profileSchema, "GET", 200, undefined, true); }
export async function saveProfile(input: SaveProfileInput): Promise<m.Result<m.Profile>> {
  const invalid = guard(input); if (invalid) return invalid;
  if (!input.ifMatch?.trim()) return fail("precondition_required");
  if (!etagSchema.safeParse(input.ifMatch).success) return fail("invalid_request");
  const body = m.profileBodySchema.safeParse(input.body); if (!body.success) return fail("validation_error");
  return employerRequest(input, "psychometric-profile", m.profileSchema, "PUT", 200, body.data, true, input.ifMatch);
}
export async function getInvitations(input: ReadInput): Promise<m.Result<{ items: m.Invitation[] }>> { return guard(input) ?? employerRequest(input, "psychometric-invitations", m.invitationsSchema); }
export async function createInvitation(input: ParticipationTarget): Promise<m.Result<m.Invitation>> { return guard(input) ?? employerRequest(input, `participations/${input.participationId}/psychometric-invitations`, m.invitationSchema, "POST", [200, 201]); }
const invitationPath = (input: InvitationTarget, suffix: string) => `psychometric-invitations/${input.invitationId}/${suffix}`;
export async function mintLink(input: InvitationTarget): Promise<m.Result<z.infer<typeof m.linkSchema>>> { return guard(input) ?? employerRequest(input, invitationPath(input, "link"), m.linkSchema, "POST"); }
export async function remindInvitation(input: InvitationTarget): Promise<m.Result<m.Invitation>> { return guard(input) ?? employerRequest(input, invitationPath(input, "reminders"), m.invitationSchema, "POST"); }
export async function revokeInvitation(input: InvitationTarget): Promise<m.Result<m.Invitation>> { return guard(input) ?? employerRequest(input, invitationPath(input, "revoke"), m.invitationSchema, "POST"); }
export async function getResult(input: InvitationTarget): Promise<m.Result<m.AssessmentResult>> { return guard(input) ?? employerRequest(input, invitationPath(input, "result"), m.resultSchema); }
export async function createComparison(input: InvitationTarget): Promise<m.Result<m.Comparison>> { return guard(input) ?? employerRequest(input, invitationPath(input, "comparisons"), m.comparisonSchema, "POST", 201); }
function candidateGuard(input: CandidateInput): m.Result<never> | undefined {
  if (input.access === "public") {
    if (assessmentTokenSegment(input.assessmentToken) === null) return fail("invalid_request");
  } else {
    if (!input.token?.trim()) return fail("unauthenticated");
    if (!m.uuidSchema.safeParse(input.invitationId).success) return fail("invalid_request");
  }
}
/** The shared JSON transport cannot accept bodyless 204 or capture Retry-After on failures.
 * Same configured-origin guard as checklist DELETE; all path segments are validated above.
 * Keep public URLs/token inputs out of logs, exceptions and returned references. */
async function candidateRequest<T>(input: CandidateInput, suffix: string, schema: z.ZodType<T>, method = "GET", status = 200, body?: unknown): Promise<m.Result<T>> {
  const invalid = candidateGuard(input); if (invalid) return invalid;
  try {
    const { serverEnv } = await import("@/lib/env/server");
    const origin = new URL(serverEnv.apiBaseUrl);
    const prefix = input.access === "public" ? `/v2/assessments/${assessmentTokenSegment(input.assessmentToken)}` : `/v2/me/assessments/${input.invitationId}`;
    const url = new URL(`${prefix}${suffix}`, origin);
    if (url.origin !== origin.origin || !["http:", "https:"].includes(url.protocol)) return fail("invalid_request");
    const signal = AbortSignal.timeout(serverEnv.apiTimeoutMs);
    const response = await fetch(url, { method, headers: { accept: "application/json", ...(input.access === "account" ? { authorization: `Bearer ${input.token.trim()}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", signal });
    if (response.status === status) {
      if (status === 204) return { ok: true, data: schema.parse(null) };
      try { return { ok: true, data: schema.parse(await boundedJson(response, 1048576, signal)) }; } catch { return fail("unrecognized_response"); }
    }
    if (response.ok) return fail("unrecognized_response");
    let envelope: Envelope | undefined;
    try { envelope = envelopeSchema.parse(await boundedJson(response, 8192, signal)); } catch { /* Status stays authoritative; raw text is never returned. */ }
    const result = failure(response.status, envelope);
    const retryAfter = response.headers.get("retry-after");
    // Do not allow an untrusted response header/field to reflect the public token.
    if (!result.ok && input.access === "public" && result.fields?.some(f => f.field.includes(input.assessmentToken))) delete result.fields;
    return !result.ok && result.reason === "rate_limited" && retryAfter && /^(?:[0-9]+|[A-Za-z]{3}, [0-9]{2} [A-Za-z]{3} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT)$(?![\s\S])/.test(retryAfter) ? { ...result, retryAfter } : result;
  } catch { return fail("no_response"); }
}
export async function getAssessment(input: CandidateInput): Promise<m.Result<m.CandidateBase>> { return candidateRequest(input, "", m.candidateBaseSchema); }
export async function getItems(input: CandidateInput): Promise<m.Result<m.CandidateItems>> { return candidateRequest(input, "/items", m.candidateItemsSchema); }
async function candidateWrite<T>(input: CandidateBodyInput, suffix: string, bodySchema: z.ZodType<T>, method: string): Promise<m.Result<null>> {
  const invalid = candidateGuard(input); if (invalid) return invalid;
  const parsed = bodySchema.safeParse(input.body); if (!parsed.success) return fail("validation_error");
  return candidateRequest(input, suffix, z.null(), method, 204, parsed.data);
}
export async function giveConsent(input: CandidateBodyInput): Promise<m.Result<null>> { return candidateWrite(input, "/consent", m.consentBodySchema, "POST"); }
export async function putAnswer(input: AnswerInput): Promise<m.Result<null>> { return !m.positionSchema.safeParse(input.position).success ? fail("invalid_request") : candidateWrite(input, `/answers/${input.position}`, m.answerBodySchema, "PUT"); }
export async function deleteAnswer(input: AnswerInput): Promise<m.Result<null>> { return !m.positionSchema.safeParse(input.position).success ? fail("invalid_request") : candidateWrite(input, `/answers/${input.position}`, m.clearAnswerBodySchema, "DELETE"); }
export async function finishAssessment(input: CandidateInput): Promise<m.Result<z.infer<typeof m.finishedSchema>>> { return candidateRequest(input, "/finish", m.finishedSchema, "POST"); }
