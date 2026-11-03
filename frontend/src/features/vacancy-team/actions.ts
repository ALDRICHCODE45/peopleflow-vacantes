"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getTeam, getHistory, getCompanyMembers, getCalendar, writeTeam, type TeamWriteInput } from "./api-client";
import type { ReadResult } from "./api-model";
async function authenticated<T>(call: (token: string) => Promise<ReadResult<T>>): Promise<ReadResult<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, code: "unauthenticated", status: 401 };
    return await call(token);
  } catch { return { ok: false, code: "read_failed" }; }
}
export async function writeTeamAction(input: Omit<TeamWriteInput, "token">) {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false as const, code: "unauthenticated", status: 401 };
    return await writeTeam({ ...input, token });
  } catch { return { ok: false as const, code: "write_failed" }; }
}
export async function loadTeamAction(vacancyId: string) { return authenticated(token => getTeam({ token, vacancyId })); }
export async function loadTeamHistoryAction(vacancyId: string, cursor?: string) { return authenticated(token => getHistory({ token, vacancyId, cursor })); }
export async function loadTeamMembersAction(vacancyId: string) { return authenticated(token => getCompanyMembers({ token, vacancyId })); }
export async function loadTeamCalendarAction(vacancyId: string) { return authenticated(token => getCalendar({ token, vacancyId })); }
