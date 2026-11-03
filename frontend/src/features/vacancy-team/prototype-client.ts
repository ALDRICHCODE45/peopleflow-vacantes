import { TeamError, type TeamClient } from "./client";
import { companyMembersSchema, historySchema, reassignSchema, snapshotSchema, teamSchema, type FixtureName, type HistoryItem, type Member, type Team, type Tramo } from "./model";

const at = "2026-11-12T16:04:00Z";
const actor = { id: "user-sofia", name: "Sofía Ramírez" };
const company = companyMembersSchema.parse({ members: [
  { id: "membership-ana", role: "recruiter", user: { id: "user-ana", full_name: "Ana López", email: "ana@example.test" } },
  { id: "membership-diego", role: "recruiter", user: { id: "user-diego", full_name: "Diego Hernández", email: "diego@example.test" } },
  { id: "membership-sofia", role: "owner", user: { id: actor.id, full_name: actor.name, email: "sofia@example.test" } },
  { id: "membership-luis", role: "recruiter", user: { id: "user-luis", full_name: "Luis Pérez", email: "luis@example.test" } },
] });
const snapshot = snapshotSchema.parse({ captured_at: at, lifecycle: { publication: "published", process: "active" }, stage_counts: [
  { stage_id: "new", stage_name: "Nuevos", active: 6, discarded: 1 }, { stage_id: "in_process", stage_name: "En proceso", active: 3, discarded: 1 },
], tramo: { started_at: "2026-11-02T18:00:00Z", effective_deadline: "2026-11-20", deadline_source: "recruiter", business_days_elapsed: 7, business_days_total: 12 }, delivery: { target: 5, delivered: 3, fulfilled_at: null, result: null, commitment_date: "2026-11-30" }, placements: { current: 0, credited: 0 } });
const clone = <T,>(value: T): T => structuredClone(value);

/** Isolated per mount; only imported by the development opt-in route. No storage, timers or network. */
export function createFixtureClient(fixture: FixtureName): TeamClient & { snapshot: import("./model").Snapshot } {
  let sequence = 0;
  const owner = fixture !== "collaborator";
  const viewerId = owner ? actor.id : "user-diego";
  const team = teamSchema.parse({ mode: fixture === "shared" ? "shared" : "with_responsible", members: [
    { assignment_id: "assignment-ana", user: { id: "user-ana", name: "Ana López" }, function: fixture === "shared" ? "member" : "responsible", started_at: "2026-11-02T18:00:00Z", recruiter_deadline: "2026-11-20", effective_deadline: "2026-11-20", deadline_source: "recruiter" },
    { assignment_id: "assignment-diego", user: { id: "user-diego", name: "Diego Hernández" }, function: fixture === "shared" ? "member" : "collaborator", started_at: "2026-11-05T18:00:00Z", recruiter_deadline: null, effective_deadline: "2026-11-30", deadline_source: "commitment" },
  ], viewer: { function: owner ? null : "collaborator", is_owner: owner, can: { add_member: owner, remove_member: owner, leave: !owner, reassign_responsible: owner && fixture !== "shared", change_mode: owner, edit_deadline: owner, renegotiate_commitment: true } } });
  function newTramo(member: Member, cause: Tramo["start_cause"]): HistoryItem {
    return { kind: "tramo", at: member.started_at, tramo: { assignment_id: member.assignment_id, user: member.user, started_at: member.started_at, started_by: actor, start_cause: cause, ended_at: null, ended_by: null, end_cause: null, recruiter_deadline: member.recruiter_deadline, closing_deadline: null, functions: [{ function: member.function, started_at: member.started_at, ended_at: null, start_cause: cause, end_cause: null }] } };
  }
  // Active tramos exist in the adapter even when the empty-history presentation is selected.
  const items: HistoryItem[] = team.members.map(member => newTramo(member, "added"));
  if (fixture === "long-history") {
    items.push(...Array.from({ length: 24 }, (_, index): HistoryItem => ({ kind: "mode_change", at: `2026-10-${String(28 - index).padStart(2, "0")}T16:00:00Z`, mode_change: { id: `past-mode-${index}`, from_mode: index % 2 ? "shared" : "with_responsible", to_mode: index % 2 ? "with_responsible" : "shared", responsible_user: index % 2 ? team.members[0].user : null, performed_by: actor } })));
  }
  if (fixture !== "empty-history") items.push({ kind: "reassignment", at: "2026-11-06T16:04:00Z", reassignment: { id: "past-reassignment", from_user: team.members[1].user, to_user: team.members[0].user, reason: "workload", note: "Distribuimos la carga de esta semana.", previous_responsible: "keep_as_collaborator", performed_by: actor, state_snapshot: snapshot } });
  let hideInitialHistory = fixture === "empty-history";
  const requireCan = (permission: keyof Team["viewer"]["can"]) => { if (!team.viewer.can[permission]) throw new TeamError("team_action_forbidden", 403); };
  const find = (userId: string) => { const member = team.members.find(member => member.user.id === userId); if (!member) throw new TeamError("team_member_not_found", 404); return member; };
  const tramo = (member: Member) => {
    const item = items.find(item => item.kind === "tramo" && item.tramo.assignment_id === member.assignment_id);
    if (!item || item.kind !== "tramo") throw new Error("Missing fixture tramo");
    return item;
  };
  function setFunction(member: Member, next: Member["function"], cause: "mode_change" | "reassignment") {
    if (member.function === next) return;
    const item = tramo(member); const previous = item.tramo.functions.at(-1)!;
    previous.ended_at = at; previous.end_cause = cause;
    item.tramo.functions.push({ function: next, started_at: at, ended_at: null, start_cause: cause, end_cause: null });
    item.at = at; member.function = next;
  }
  function end(member: Member, cause: "removed" | "left" | "reassigned") {
    const item = tramo(member);
    Object.assign(item.tramo, { ended_at: at, ended_by: actor, end_cause: cause, closing_deadline: member.effective_deadline });
    Object.assign(item.tramo.functions.at(-1)!, { ended_at: at, end_cause: "tramo_ended" }); item.at = at;
    team.members = team.members.filter(active => active.assignment_id !== member.assignment_id);
  }
  function add(userId: string, deadline: string | null, cause: "added" | "reassignment") {
    if (team.members.some(member => member.user.id === userId)) throw new TeamError("team_member_already_active");
    const person = company.members.find(member => member.user.id === userId);
    if (!person) throw new TeamError("not_company_member", 422);
    const member: Member = { assignment_id: `assignment-new-${++sequence}`, user: { id: userId, name: person.user.full_name }, function: team.mode === "shared" ? "member" : "collaborator", started_at: at, recruiter_deadline: deadline, effective_deadline: deadline ?? snapshot.delivery.commitment_date, deadline_source: deadline ? "recruiter" : "commitment" };
    team.members.push(member); items.push(newTramo(member, cause)); return member;
  }
  function done() {
    hideInitialHistory = false;
    team.viewer.function = team.members.find(member => member.user.id === viewerId)?.function ?? null;
    team.viewer.can.reassign_responsible = owner && team.mode === "with_responsible";
    team.viewer.can.leave = !!team.viewer.function && team.viewer.function !== "responsible" && team.members.length > 1;
    return clone(teamSchema.parse(team));
  }
  const client: TeamClient & { snapshot: import("./model").Snapshot } = {
    calendar: { timeZone: "America/Mexico_City", today: "2026-11-02", minDate: "2026-11-02", maxDate: "2027-11-02", nonBusinessDates: ["2026-11-16", "2026-12-25", "2027-01-01", "2027-02-01", "2027-03-15"] },
    get commitmentDate() { return snapshot.delivery.commitment_date; },
    get snapshot() {
      const current = clone(snapshot);
      const responsible = team.members.find(member => member.function === "responsible");
      if (responsible) current.tramo = { ...current.tramo, started_at: responsible.started_at, effective_deadline: responsible.effective_deadline, deadline_source: responsible.deadline_source };
      return current;
    },
    async getTeam() { return clone(team); },
    async getCompanyMembers() { return clone(company); },
    async getHistory(cursor) {
      if (cursor !== undefined && !/^page:[1-9]\d*$/.test(cursor)) throw new TeamError("invalid_cursor", 400);
      const offset = cursor ? Number(cursor.slice(5)) : 0;
      const id = (item: HistoryItem) => item.kind === "tramo" ? item.tramo.assignment_id : item.kind === "mode_change" ? item.mode_change.id : item.reassignment.id;
      const ordered = hideInitialHistory ? [] : [...items].sort((a, b) => b.at.localeCompare(a.at) || a.kind.localeCompare(b.kind) || id(a).localeCompare(id(b)));
      return clone(historySchema.parse({ items: ordered.slice(offset, offset + 20), next_cursor: offset + 20 < ordered.length ? `page:${offset + 20}` : null }));
    },
    async addMember(body) { requireCan("add_member"); add(body.user_id, body.recruiter_deadline, "added"); return done(); },
    async removeMember(userId) { requireCan("remove_member"); const member = find(userId); if (member.function === "responsible") throw new TeamError("use_reassign_responsible"); if (team.members.length === 1) throw new TeamError("team_last_member"); end(member, "removed"); return done(); },
    async leave() { requireCan("leave"); const member = find(viewerId); if (member.function === "responsible") throw new TeamError("responsible_cannot_leave"); if (team.members.length === 1) throw new TeamError("team_last_member"); end(member, "left"); return done(); },
    async editDeadline(userId, deadline) { requireCan("edit_deadline"); const member = find(userId); member.recruiter_deadline = deadline; member.effective_deadline = deadline ?? snapshot.delivery.commitment_date; member.deadline_source = deadline ? "recruiter" : "commitment"; tramo(member).tramo.recruiter_deadline = deadline; return done(); },
    async reassign(input) {
      requireCan("reassign_responsible"); const body = reassignSchema.parse(input);
      if (team.mode !== "with_responsible") throw new TeamError("team_mode_mismatch");
      const previous = team.members.find(member => member.function === "responsible")!;
      if (previous.user.id === body.to_user_id) throw new TeamError("reassign_target_is_responsible");
      if (!company.members.some(member => member.user.id === body.to_user_id)) throw new TeamError("not_company_member", 422);
      const target = team.members.find(member => member.user.id === body.to_user_id) ?? add(body.to_user_id, body.recruiter_deadline, "reassignment");
      const state = clone(snapshot); state.tramo.started_at = previous.started_at; state.tramo.effective_deadline = previous.effective_deadline; state.tramo.deadline_source = previous.deadline_source;
      if (body.previous_responsible === "remove") end(previous, "reassigned"); else setFunction(previous, "collaborator", "reassignment");
      setFunction(target, "responsible", "reassignment");
      items.push({ kind: "reassignment", at, reassignment: { id: `reassignment-${++sequence}`, from_user: previous.user, to_user: target.user, reason: body.reason, note: body.note || null, previous_responsible: body.previous_responsible, performed_by: actor, state_snapshot: state } });
      return done();
    },
    async changeMode(body) {
      requireCan("change_mode"); if (body.mode === team.mode) throw new TeamError("team_mode_unchanged");
      const responsible = body.mode === "with_responsible" ? team.members.find(member => member.user.id === body.responsible_user_id) : null;
      if (body.mode === "with_responsible" && !responsible) throw new TeamError("responsible_not_on_team", 422);
      items.push({ kind: "mode_change", at, mode_change: { id: `mode-${++sequence}`, from_mode: team.mode, to_mode: body.mode, responsible_user: responsible?.user ?? null, performed_by: actor } });
      team.members.forEach(member => setFunction(member, body.mode === "shared" ? "member" : member === responsible ? "responsible" : "collaborator", "mode_change"));
      team.mode = body.mode; return done();
    },
  };
  return client;
}
