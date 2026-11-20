import { replacementsViewSchema, type StartContext } from "./model";

/** Wire fixtures for replacement-processes-v1 «GET V/replacements» and «POST V/replacements». */
export const uuid = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ids = {
  draft: uuid(1), newDraft: uuid(2), root: uuid(3), creditRicardo: uuid(11), creditLuis: uuid(12),
  ricardo: uuid(21), luis: uuid(22), mauricio: uuid(31), alma: uuid(32), karen: uuid(33), owner: uuid(41), ana: uuid(42),
  key: uuid(51),
  stageNew: uuid(61), stageReview: uuid(62), stageInterview: uuid(63), stageOffer: uuid(64), stagePlacement: uuid(65),
};
export const etag = `"vl-${ids.draft}-v7"`;
export const sourceStages = [
  { id: ids.stageNew, kind: "new", name: "Nuevos" },
  { id: ids.stageReview, kind: "screening", name: "En revisión" },
  { id: ids.stageInterview, kind: "in_process", name: "Entrevista" },
  { id: ids.stageOffer, kind: "custom", name: "Oferta" },
  { id: ids.stagePlacement, kind: "placement", name: "Contratación" },
] as const;
export const credit = (creditId: string, candidateId: string, name: string, extra: object = {}) => ({
  credit_id: creditId, process_id: ids.draft, participation_id: uuid(70 + Number(creditId.slice(6, 8))),
  candidate: { kind: "manual", id: candidateId, full_name: name },
  hired_at: "2026-10-22T16:00:00.000000Z", left_at: "2026-11-17T16:00:00.000000Z", exit_reason: "candidate_left",
  recipients: [{ user_id: ids.owner, name: "Sofía Ramírez", kind: "direct" }], ...extra,
});
export const carry = (candidateId: string, name: string, stage: { kind: string; name: string }, discarded: boolean, kind = "manual") => ({
  candidate: { kind, id: candidateId, full_name: name }, process_id: ids.draft, participation_id: uuid(80 + Number(candidateId.slice(6, 8))),
  stage, discarded, eligible: true,
});
export const replacementsWire = (start: object = {}, extra: object = {}) => ({
  root_process_id: ids.root,
  items: [{
    id: ids.draft, kind: "original", sequence: null, replacement_of: null, title: "Supervisor(a) de Almacén", visibility: "public",
    lifecycle: { publication: "closed", process: "finished", close_reason: "filled", closed_at: "2026-11-03T12:00:00.000000Z" },
    started_at: "2026-09-01T15:00:00.000000Z", started_by: { id: ids.owner, name: "Sofía Ramírez" },
    coverage: { covered: 1, required: 2 }, replaced_credit_ids: [], can_open: true,
  }],
  start_replacement: {
    allowed: true, blocker: null, active_replacement_id: null,
    startable_credits: [credit(ids.creditRicardo, ids.ricardo, "Ricardo Morales García"), credit(ids.creditLuis, ids.luis, "Luis Pérez")],
    publish_ready: true, missing: [], ...start,
  },
  carry_candidates: [
    carry(ids.mauricio, "Mauricio Peña Gil", { kind: "in_process", name: "Entrevista" }, false),
    carry(ids.alma, "Alma Reyes Vidal", { kind: "screening", name: "En revisión" }, false),
    carry(ids.karen, "Karen Ortiz Lara", { kind: "custom", name: "Oferta" }, true, "organic"),
  ],
  carry_candidates_truncated: false,
  ...extra,
});
export const calendar = { timeZone: "America/Mexico_City", today: "2026-11-19", minDate: "2026-11-19", maxDate: "2027-11-19", nonBusinessDates: ["2026-11-21", "2026-11-22"] };
export const members = [
  { id: uuid(91), role: "owner" as const, user: { id: ids.owner, full_name: "Sofía Ramírez", email: "sofia@example.com" } },
  { id: uuid(92), role: "recruiter" as const, user: { id: ids.ana, full_name: "Ana López", email: "ana@example.com" } },
];
export const context = (start: object = {}, extra: object = {}): StartContext => ({
  replacements: replacementsViewSchema.parse(replacementsWire(start, extra)), etag, members, calendar,
});
export const lifecycleWire = (id: string, version = "1") => ({
  publication: "published", process: "active", version, published_at: "2026-11-19T18:00:00.000000Z", paused_at: null, closed_at: null,
  close_reason: null, close_reason_note: null, process_finished_at: null, allowed_actions: ["pause", "close"],
  kind: "replacement", sequence: 1, replacement_of: ids.draft, root_process_id: ids.root, visibility: "private", closed_covered: false,
  can_start_replacement: false, start_replacement_blocker: "source_not_closed", startable_credits_count: 0, active_replacement_id: id,
});
export const startedWire = (extra: object = {}) => ({
  id: ids.newDraft, kind: "replacement", sequence: 1, replacement_of: ids.draft, root_process_id: ids.root, visibility: "private",
  started_at: "2026-11-19T18:00:00.000000Z", stage_map: [{ kind: "new", source_stage_id: ids.stageNew, stage_id: uuid(99), extra: true }],
  carried: [{ participation_id: uuid(98), whatever: 1 }], delivery: { delivered: 1, target: 2, fulfilled: false },
  source: { id: ids.draft, finished_by_start: true }, future_key: { nested: true },
  lifecycle: lifecycleWire(ids.newDraft), ...extra,
});
