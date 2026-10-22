"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { listTeamMembers, mutateTeamMember, type TeamClientFailure } from "./client";
import { memberIdSchema, memberRoleSchema, type CompanyMember } from "./members-model";
import type { TeamMemberRole } from "./model";

export type TeamFailure = { ok: false; reason: "unauthenticated" | "not_member" | "forbidden" | "invalid_request" | "last_owner" | "server_error" | "no_response" | "unrecognized_response"; reference: { status?: number; code?: string } };
export type TeamListResult = { ok: true; members: CompanyMember[] } | TeamFailure;
export type TeamMutationResult = { ok: true } | TeamFailure;
function failure(result: TeamClientFailure): TeamFailure {
  const status = "status" in result.error ? result.error.status : undefined;
  if (status === 409 && result.code === "last_owner") return { ok: false, reason: "last_owner", reference: { status, code: "last_owner" } };
  const reason = status === 401 ? "unauthenticated" : status === 404 ? "not_member" : status === 403 ? "forbidden" : status === 400 ? "invalid_request" :
    status !== undefined && status >= 500 && status < 600 ? "server_error" :
      result.error.kind === "network" || result.error.kind === "timeout" ? "no_response" : "unrecognized_response";
  return { ok: false, reason, reference: status === undefined ? {} : { status } };
}
const noResponse: TeamFailure = { ok: false, reason: "no_response", reference: {} };
const unauthenticated: TeamFailure = { ok: false, reason: "unauthenticated", reference: {} };

export async function listTeamMembersAction(): Promise<TeamListResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await listTeamMembers(token);
    return result.ok ? { ok: true, members: result.data } : failure(result);
  } catch { return noResponse; }
}
async function mutate(id: string, role?: TeamMemberRole): Promise<TeamMutationResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    if (!memberIdSchema.safeParse(id).success || (role !== undefined && !memberRoleSchema.safeParse(role).success))
      return { ok: false, reason: "invalid_request", reference: {} };
    const result = await mutateTeamMember(token, id, role);
    return result.ok ? { ok: true } : failure(result);
  } catch { return noResponse; }
}
export async function changeTeamRoleAction(id: string, role: TeamMemberRole): Promise<TeamMutationResult> {
  // Role is mandatory here; an absent runtime argument must never become DELETE.
  if (!memberRoleSchema.safeParse(role).success) return { ok: false, reason: "invalid_request", reference: {} };
  return mutate(id, role);
}
export async function removeTeamMemberAction(id: string): Promise<TeamMutationResult> { return mutate(id); }
