import { z } from "zod";
import { teamSchema, memberSchema, companyMembersSchema, historyItemSchema, tramoSchema, functionPeriodSchema, snapshotSchema } from "./model";

const user = memberSchema.shape.user.strict();
export const apiTeamSchema = teamSchema.extend({
  members: z.array(memberSchema.extend({ user }).strict()).min(1),
  viewer: teamSchema.shape.viewer.extend({ can: teamSchema.shape.viewer.shape.can.strict() }).strict(),
}).strict();
const companyMember = companyMembersSchema.shape.members.element;
export const apiCompanyMembersSchema = companyMembersSchema.extend({ members: z.array(companyMember.extend({ user: companyMember.shape.user.strict() }).strict()) }).strict();
const snapshot = snapshotSchema.extend({
  lifecycle: snapshotSchema.shape.lifecycle.strict(),
  stage_counts: z.array(snapshotSchema.shape.stage_counts.element.extend({ kind: z.enum(["new", "screening", "screening_ok", "in_process", "placement", "custom"]) }).strict()),
  tramo: snapshotSchema.shape.tramo.strict(), delivery: snapshotSchema.shape.delivery.strict(), placements: snapshotSchema.shape.placements.strict(),
}).strict();
const [tramo, reassignment, modeChange] = historyItemSchema.options;
export const apiHistorySchema = z.object({ items: z.array(z.discriminatedUnion("kind", [
  tramo.extend({ tramo: tramoSchema.extend({ user, started_by: user.nullable(), ended_by: user.nullable(), functions: z.array(functionPeriodSchema.strict()) }).strict() }).strict(),
  reassignment.extend({ reassignment: reassignment.shape.reassignment.extend({ from_user: user, to_user: user, performed_by: user, state_snapshot: snapshot }).strict() }).strict(),
  modeChange.extend({ mode_change: modeChange.shape.mode_change.extend({ responsible_user: user.nullable(), performed_by: user }).strict() }).strict(),
])), next_cursor: z.string().nullable() }).strict();
export type ReadResult<T> = { ok: true; data: T; etag?: string } | { ok: false; code: string; status?: number };
