import type { Delivery } from "@/features/jobs/drafts/pipeline/delivery-model";
import type { CompanyMembers, History, ModeChange, Reassign, Snapshot, Team } from "./model";

/** All writes return the full resource. A real adapter must carry ETag/If-Match and
 * UUID Idempotency-Key for POSTs; this prototype does not issue HTTP requests. */
export interface TeamClient {
  getTeam(): Promise<Team>;
  getCompanyMembers(): Promise<CompanyMembers>;
  getHistory(cursor?: string): Promise<History>;
  addMember(body: { user_id: string; recruiter_deadline: string | null }): Promise<Team>;
  removeMember(userId: string): Promise<Team>;
  leave(): Promise<Team>;
  editDeadline(userId: string, deadline: string | null): Promise<Team>;
  reassign(body: Reassign): Promise<Team>;
  changeMode(body: ModeChange): Promise<Team>;
  /** Business-day window for deadlines; the real adapter reads it from GET V/pipeline/delivery. */
  calendar: Delivery["calendar"];
  /** Fixture-only preview, not a new backend endpoint. The persisted snapshot is authoritative. */
  snapshot: Snapshot;
}
export class TeamError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
