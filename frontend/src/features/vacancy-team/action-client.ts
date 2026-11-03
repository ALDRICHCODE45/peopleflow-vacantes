import { TeamError, type TeamClient } from "./client";
import { loadTeamAction, loadTeamHistoryAction, loadTeamMembersAction, loadTeamCalendarAction, writeTeamAction } from "./actions";
import type { ReadResult } from "./api-model";
async function unwrap<T>(result: Promise<ReadResult<T>>): Promise<T> {
  const value = await result;
  if (!value.ok) throw new TeamError(value.code, value.status ?? 0);
  return value.data;
}
import type { TeamWrite } from "./api-client";
/** One confirmation owns a frozen body, ETag and UUID until a definitive response. */
export function createApiClient(vacancyId: string): TeamClient {
  let etag: string | undefined;
  let calendar: TeamClient["calendar"];
  let commitmentDate: string | null = null;
  let attempt: Parameters<typeof writeTeamAction>[0] | undefined;
  async function write(write: TeamWrite) {
    if (!etag) throw new TeamError("precondition_required", 428);
    attempt ??= { vacancyId, ifMatch: etag, idempotencyKey: crypto.randomUUID(), write: structuredClone(write) };
    let result;
    try { result = await writeTeamAction(attempt); }
    catch { throw new TeamError("write_failed", 0); }
    if (!result.ok) {
      if (result.status && result.status >= 400 && result.status < 500 && result.status !== 428) attempt = undefined;
      throw new TeamError(result.code, result.status ?? 0);
    }
    etag = result.etag; attempt = undefined;
    return result.data;
  }
  return {
    persisted: true,
    beginAttempt() { attempt = undefined; },
    get etag() { return etag; }, get calendar() { return calendar; }, get commitmentDate() { return commitmentDate; },
    async getTeam() {
      const result = await loadTeamAction(vacancyId);
      if (!result.ok) throw new TeamError(result.code, result.status ?? 0);
      etag = result.etag;
      const delivery = await unwrap(loadTeamCalendarAction(vacancyId));
      calendar = delivery.calendar; commitmentDate = delivery.commitmentDate;
      return result.data;
    },
    getHistory: cursor => unwrap(loadTeamHistoryAction(vacancyId, cursor)),
    getCompanyMembers: () => unwrap(loadTeamMembersAction(vacancyId)),
    addMember: body => write({ kind: "add", body }),
    removeMember: userId => write({ kind: "remove", userId }),
    leave: () => write({ kind: "leave" }),
    editDeadline: (userId, deadline) => write({ kind: "deadline", userId, deadline }),
    reassign: body => write({ kind: "reassign", body }),
    changeMode: body => write({ kind: "mode", body }),
  };
}
