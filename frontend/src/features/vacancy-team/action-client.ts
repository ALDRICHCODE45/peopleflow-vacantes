import { TeamError, type TeamClient } from "./client";
import { loadTeamAction, loadTeamHistoryAction, loadTeamMembersAction, loadTeamCalendarAction } from "./actions";
import type { ReadResult } from "./api-model";
async function unwrap<T>(result: Promise<ReadResult<T>>): Promise<T> {
  const value = await result;
  if (!value.ok) throw new TeamError(value.code, value.status ?? 0);
  return value.data;
}
/** Reads only until backend slice 2. No write action or network fallback exists. */
export function createApiClient(vacancyId: string): TeamClient {
  let etag: string | undefined;
  let calendar: TeamClient["calendar"];
  const unavailable = async (): Promise<never> => { throw new TeamError("not_available_yet"); };
  return {
    get etag() { return etag; }, get calendar() { return calendar; },
    async getTeam() {
      const result = await loadTeamAction(vacancyId);
      if (!result.ok) throw new TeamError(result.code, result.status ?? 0);
      etag = result.etag;
      calendar = await unwrap(loadTeamCalendarAction(vacancyId));
      return result.data;
    },
    getHistory: cursor => unwrap(loadTeamHistoryAction(vacancyId, cursor)),
    getCompanyMembers: () => unwrap(loadTeamMembersAction(vacancyId)),
    addMember: unavailable, removeMember: unavailable, leave: unavailable, editDeadline: unavailable, reassign: unavailable, changeMode: unavailable,
  };
}
