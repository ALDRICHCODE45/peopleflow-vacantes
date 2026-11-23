import { isValidJobId } from "@/features/jobs/jobId";

/**
 * Backend paths of `placement-vacancy-documents-v1` «Endpoints»: `V = /v2/me/company/job-drafts/{id}`, `P` = `V` (vacancy scope) or
 * `V/participations/{pid}` (participation scope). The BFF routes mirror them under `/api/company/job-drafts/…`. Pure: no I/O.
 */
export type DocumentScope = { draftId: string; participationId?: string };

/** Canonical dashed UUID; the value is never trimmed, so a newline or a path fragment can never reach a URL. */
export const isId = (value: unknown): value is string => typeof value === "string" && isValidJobId(value);

/** `null` when an id is malformed (nothing is requested then). */
export function backendScopePath({ draftId, participationId }: DocumentScope): string | null {
  if (!isId(draftId)) return null;
  if (participationId === undefined) return `/v2/me/company/job-drafts/${draftId}`;
  return isId(participationId) ? `/v2/me/company/job-drafts/${draftId}/participations/${participationId}` : null;
}
