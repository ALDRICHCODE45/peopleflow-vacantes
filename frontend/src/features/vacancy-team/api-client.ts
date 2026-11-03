import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { getDraftDelivery } from "@/features/jobs/drafts/pipeline/delivery-client";
import { etagSchema } from "@/features/pipeline-movement/model";
import { membersSchema } from "@/features/employer-team/members-model";
import { apiTeamSchema, apiHistorySchema, type ReadResult } from "./api-model";
import { reassignSchema, modeSchema, type Team, type History, type CompanyMembers } from "./model";
import type { Delivery } from "@/features/jobs/drafts/pipeline/delivery-model";
export type ReadInput = { token: string; vacancyId: string };
const envelope = z.object({ code: z.string(), error: z.string().optional() });
function guard(input: ReadInput): ReadResult<never> | undefined {
  if (!input.token?.trim()) return { ok: false, code: "unauthenticated", status: 401 };
  if (!z.string().uuid().safeParse(input.vacancyId).success) return { ok: false, code: "invalid_request" };
}
async function read<T>(input: ReadInput, path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, withEtag = false): Promise<ReadResult<T>> {
  const invalid = guard(input); if (invalid) return invalid;
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(path, serverEnv.apiBaseUrl).toString(), {
    method: "GET", headers: { authorization: `Bearer ${input.token.trim()}` }, redirect: "error", expectedStatus: 200,
    timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192, captureResponseHeaders: ["etag"],
    decoder: value => schema.parse(value), errorDecoder: value => envelope.parse(value),
  });
  if (!result.ok) {
    const status = "status" in result.error ? result.error.status : undefined;
    const code = status === 401 ? "unauthenticated" : status === 404 ? result.envelope?.code === "team_access_ended" ? "team_access_ended" : "not_found" : status === 400 && result.envelope?.code === "invalid_cursor" ? "invalid_cursor" : result.error.kind === "invalid_response" ? "invalid_response" : "read_failed";
    return { ok: false, code, ...(status === undefined ? {} : { status }) };
  }
  if (withEtag && !etagSchema.safeParse(result.headers?.etag).success) return { ok: false, code: "invalid_response" };
  return { ok: true, data: result.data, ...(withEtag ? { etag: result.headers!.etag! } : {}) };
}
const uuid = z.string().uuid();
const deadline = z.string().date().nullable();
const teamWriteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add"), body: z.object({ user_id: uuid, recruiter_deadline: deadline }).strict() }).strict(),
  z.object({ kind: z.literal("remove"), userId: uuid }).strict(),
  z.object({ kind: z.literal("leave") }).strict(),
  z.object({ kind: z.literal("deadline"), userId: uuid, deadline }).strict(),
  z.object({ kind: z.literal("reassign"), body: reassignSchema }).strict(),
  z.object({ kind: z.literal("mode"), body: z.object({ mode: modeSchema, responsible_user_id: uuid.optional() }).strict() }).strict(),
]);
export type TeamWrite = z.infer<typeof teamWriteSchema>;
export type TeamWriteInput = ReadInput & { ifMatch: string; idempotencyKey?: string; write: TeamWrite };
/** All writes share the team resource decoder and never retry automatically. */
export async function writeTeam(input: TeamWriteInput): Promise<ReadResult<Team>> {
  const invalid = guard(input); if (invalid) return invalid;
  const parsed = teamWriteSchema.safeParse(input.write);
  if (!parsed.success || !etagSchema.safeParse(input.ifMatch).success) return { ok: false, code: "invalid_request" };
  const write = parsed.data;
  const method = write.kind === "mode" ? "PUT" : write.kind === "deadline" ? "PATCH" : "POST";
  if (method === "POST" && !uuid.safeParse(input.idempotencyKey).success) return { ok: false, code: "invalid_request" };
  const path = write.kind === "add" ? "/members" : write.kind === "remove" ? `/members/${write.userId}/remove` : write.kind === "deadline" ? `/members/${write.userId}` : write.kind === "reassign" ? "/reassign-responsible" : `/${write.kind}`;
  const body = "body" in write ? write.body : write.kind === "deadline" ? { recruiter_deadline: write.deadline } : {};
  const { serverEnv } = await import("@/lib/env/server");
  const result = await requestJson(new URL(`${root(input)}/team${path}`, serverEnv.apiBaseUrl).toString(), {
    method, headers: { authorization: `Bearer ${input.token.trim()}`, "if-match": input.ifMatch, ...(method === "POST" ? { "idempotency-key": input.idempotencyKey! } : {}) }, body,
    redirect: "error", expectedStatus: 200, timeoutMs: serverEnv.apiTimeoutMs, maxErrorBodyBytes: 8192, captureResponseHeaders: ["etag"],
    decoder: value => apiTeamSchema.parse(value), errorDecoder: value => envelope.parse(value),
  });
  if (!result.ok) {
    const status = "status" in result.error ? result.error.status : undefined;
    const code = status === 401 ? "unauthenticated" : status === 403 ? "team_action_forbidden" : status === 412 ? "team_version_conflict" : status && status >= 400 && status < 500 ? result.envelope?.code ?? "invalid_request" : "write_failed";
    return { ok: false, code, ...(status === undefined ? {} : { status }) };
  }
  if (!etagSchema.safeParse(result.headers?.etag).success) return { ok: false, code: "invalid_response" };
  return { ok: true, data: result.data, etag: result.headers!.etag! };
}
const root = (input: ReadInput) => `/v2/me/company/job-drafts/${input.vacancyId}`;
export async function getTeam(input: ReadInput): Promise<ReadResult<Team>> { return read(input, `${root(input)}/team`, apiTeamSchema, true); }
export async function getHistory(input: ReadInput & { cursor?: string }): Promise<ReadResult<History>> {
  const query = input.cursor === undefined ? "" : `?${new URLSearchParams({ cursor: input.cursor })}`;
  return read(input, `${root(input)}/team/history${query}`, apiHistorySchema);
}
// Member routes live under /me, not /v2/me (contract 9bc2a080). Same strict decoder as employer-team;
// a membership without a user (deactivated account) cannot join a team, so it is skipped.
const companyMembersRead = membersSchema.transform(({ members }): CompanyMembers => ({
  members: members.flatMap(member => member.user ? [{ id: member.id, role: member.role, user: member.user }] : []),
}));
export async function getCompanyMembers(input: ReadInput): Promise<ReadResult<CompanyMembers>> { return read(input, "/me/company/members", companyMembersRead); }
export async function getCalendar(input: ReadInput): Promise<ReadResult<Pick<Delivery, "calendar" | "commitmentDate">>> {
  const invalid = guard(input); if (invalid) return invalid;
  const result = await getDraftDelivery({ token: input.token, draftId: input.vacancyId });
  if (result.ok) return { ok: true, data: { calendar: result.data.calendar, commitmentDate: result.data.commitmentDate } };
  const status = "status" in result.error ? result.error.status : undefined;
  return { ok: false, code: status === 401 ? "unauthenticated" : status === 404 ? "not_found" : "read_failed", ...(status === undefined ? {} : { status }) };
}
