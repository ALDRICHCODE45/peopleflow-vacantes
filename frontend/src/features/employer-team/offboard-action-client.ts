import { previewOffboardAction, offboardMemberAction, removeTeamMemberAction, type TeamFailure } from "./actions";
import { OffboardError, type OffboardBody, type OffboardResult } from "./offboard-client";
function error(result: TeamFailure) {
  return new OffboardError(result.reference.status ?? 0, result.reference.code ?? result.reason, result.vacancies);
}
/** A dialog owns one frozen intent until a definitive response; uncertain retries reuse its UUID and body. */
export function createOffboardApiClient() {
  let attempt: { id: string; body: unknown; key: string } | undefined;
  return {
    async preview(id: string) {
      const result = await previewOffboardAction(id);
      if (!result.ok) throw error(result);
      return result.data;
    },
    async remove(id: string) {
      const result = await removeTeamMemberAction(id);
      if (!result.ok) throw error(result);
    },
    async offboard(id: string, body: OffboardBody): Promise<OffboardResult> {
      attempt ??= { id, body: structuredClone({ ...body, ...(body.default_to_user_id === null ? { default_to_user_id: undefined } : {}) }), key: crypto.randomUUID() };
      const result = await offboardMemberAction(attempt.id, attempt.body, attempt.key);
      if (!result.ok) {
        if (result.reference.status && result.reference.status >= 400 && result.reference.status < 500) attempt = undefined;
        throw error(result);
      }
      attempt = undefined;
      return result.data;
    },
  };
}
