import "server-only";
import { z } from "zod";
import { requestJson } from "@/lib/api/server";
import { getDraftDelivery } from "@/features/jobs/drafts/pipeline/delivery-client";
import { etagSchema } from "@/features/pipeline-movement/model";
import { membersSchema } from "@/features/employer-team/members-model";
import { apiTeamSchema, apiHistorySchema, type ReadResult } from "./api-model";
import type { Team, History, CompanyMembers } from "./model";
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
export async function getCalendar(input: ReadInput): Promise<ReadResult<Delivery["calendar"]>> {
  const invalid = guard(input); if (invalid) return invalid;
  const result = await getDraftDelivery({ token: input.token, draftId: input.vacancyId });
  if (result.ok) return { ok: true, data: result.data.calendar };
  const status = "status" in result.error ? result.error.status : undefined;
  return { ok: false, code: status === 401 ? "unauthenticated" : status === 404 ? "not_found" : "read_failed", ...(status === undefined ? {} : { status }) };
}
