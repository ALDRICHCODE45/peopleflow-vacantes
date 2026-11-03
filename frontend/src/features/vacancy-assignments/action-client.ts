import { loadAssignmentHistoryAction } from "./actions";
import { AssignmentError, type AssignmentClient } from "./client";

export function createApiClient(): AssignmentClient {
  return { async getHistory(cursor) {
    const result = await loadAssignmentHistoryAction(cursor);
    if (!result.ok) throw new AssignmentError(result.code, result.status);
    return result.data;
  } };
}
