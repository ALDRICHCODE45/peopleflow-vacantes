import type { DraftListRow } from "@/features/jobs/drafts/list/client";

export const selfId = "10000000-0000-4000-8000-000000000001";
export const otherId = "10000000-0000-4000-8000-000000000002";
export const members = [
  { id: "20000000-0000-4000-8000-000000000001", company_id: "30000000-0000-4000-8000-000000000001", role: "owner" as const, created_at: "2026-01-02T12:00:00Z", updated_at: "2026-01-02T12:00:00Z", user: { id: selfId, full_name: "Ana Real", email: "ana@example.test" } },
  { id: "20000000-0000-4000-8000-000000000002", company_id: "30000000-0000-4000-8000-000000000001", role: "recruiter" as "owner" | "recruiter", created_at: "2026-01-02T12:00:00Z", updated_at: "2026-01-02T12:00:00Z", user: { id: otherId, full_name: "José Real", email: "jose@example.test" } },
];
export function draft(id: string, overrides: Partial<DraftListRow> = {}): DraftListRow {
  return { id, title: "Vacante", status: "published", process: "active", published_at: "2026-01-02T12:00:00Z", paused_at: null, closed_at: null, close_reason: null, close_reason_note: null, process_finished_at: null, candidates: { total: 9, in_process: 3, discarded: 6, by_stage: [] }, work_mode: null, work_schedule: null, requester: null, principal_recruiter: { id: otherId, name: "Otro nombre" }, version: "1", created_at: "2026-01-02T12:00:00Z", updated_at: "2026-01-02T12:00:00Z", ...overrides };
}
