import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", async () => await import("@/lib/api/requestJson"));
vi.mock("@/lib/env/server", () => ({ serverEnv: { apiBaseUrl: "http://localhost:8080", apiTimeoutMs: 20 } }));
vi.mock("@/lib/auth/action-session", () => ({ getActionAccessToken: vi.fn().mockResolvedValue("server-token") }));
import { discardParticipationAction, recoverParticipationAction } from "./actions";
import { discardBodySchema, boardSchema, detailSchema, historySchema } from "./model";
import { applyParticipationToBoard, allowedMoveTargets } from "./helpers";
import { discardCatalog, validateDiscardText, buildDiscardBody } from "./discard-text";
import { board, item, mutationItem, detail, history, id } from "./test-fixtures";
import { applicationsSchema } from "@/features/candidate-applications/model";
const reason = { group: "recruiter", key: "other" } as const;
const discard = { reason, recovery_stage_id: id(1), previous_stage_id: id(1), discarded_at: item.moved_at };
const discarded = { ...mutationItem, stage_id: id(6), discard, coverage: board.coverage, delivery: { ...board.delivery, state: "pending" as const } };
const input = { vacancyId: id(30), participationId: item.id, etag: item.etag };
afterEach(() => vi.unstubAllGlobals());
it("reason uses key, never code, in request, board, detail and discard history", () => {
  const reasonWithKey = { group: "recruiter", key: "other" };
  const reasonWithCode = { group: "recruiter", code: "other" };
  const base = { ...history.items[0], kind: "discard", from_stage_id: id(1), to_stage_id: id(6), hire: false, comment: "Motivo", candidate_message: null };
  for (const [reason, expected] of [[reasonWithKey, true], [reasonWithCode, false], [{ ...reasonWithKey, code: "other" }, false]] as const) {
    expect(discardBodySchema.safeParse({ reason, comment: "Motivo" }).success).toBe(expected);
    const value = { ...discardedItem(), discard: { ...discard, reason } };
    expect(boardSchema.safeParse({ ...board, participations: [value] }).success).toBe(expected);
    expect(detailSchema.safeParse({ ...detail, ...value, comment: "Motivo", candidate_message: null }).success).toBe(expected);
    expect(historySchema.safeParse({ items: [{ ...base, reason }] }).success).toBe(expected);
  }
});
it("catalog binds exact codes to their groups and other requires an explanation", () => {
  expect(discardCatalog.map(group => [group.group, group.label, group.reasons.map(reason => reason.key)])).toEqual([
    ["recruiter", "Decisión de la empresa", ["requirements_not_met", "profile_mismatch", "salary_expectation", "other_candidate_selected", "other"]],
    ["candidate", "Decisión del candidato", ["accepted_other_offer", "no_longer_interested", "unresponsive", "other"]],
  ]);
  expect(discardBodySchema.safeParse({ reason }).success).toBe(false);
  expect(discardBodySchema.safeParse({ reason: { group: "candidate", key: "requirements_not_met" } }).success).toBe(false);
});
it("counts code points after Unicode White_Space trim, preserves interior, rejects controls and omits blank optional fields", () => {
  expect(validateDiscardText("\u0085😀\n\t x\u2003", 1000)).toEqual({ value: "😀\n\t x", count: 5, error: null });
  expect(validateDiscardText("😀".repeat(1000), 1000).error).toBeNull();
  expect(validateDiscardText("😀".repeat(1001), 1000).error).toBe("too_long");
  expect(validateDiscardText("😀".repeat(500), 500).error).toBeNull();
  expect(validateDiscardText("😀".repeat(501), 500).error).toBe("too_long");
  expect(validateDiscardText("a\u0085b", 500).error).toBe("control_character");
  expect(validateDiscardText("a\u0000b", 500).error).toBe("control_character");
  expect(validateDiscardText("\ufeffx\ufeff", 500).value).toBe("\ufeffx\ufeff");
  expect(buildDiscardBody({ group: "candidate", key: "unresponsive" }, "\u0085 ", "\t\n")).toEqual({ reason: { group: "candidate", key: "unresponsive" } });
  expect(buildDiscardBody(reason, "\u2003 explicación \u0085", " Hola ")).toEqual({ reason, comment: "explicación", candidate_message: "Hola" });
});
it.each(["discard", "recover"] as const)("%s action sends the unchanged ETag and exact body, without retries", async operation => {
  const response = operation === "discard" ? discarded : { ...mutationItem, discard: null, coverage: board.coverage, delivery: board.delivery };
  const fetch = vi.fn().mockResolvedValue(Response.json(response)); vi.stubGlobal("fetch", fetch);
  const body = operation === "discard" ? { reason, comment: "Motivo", confirm_placement_exit: true } : { confirm_placement_reentry: true };
  const call = operation === "discard" ? discardParticipationAction : recoverParticipationAction;
  expect(await call({ ...input, body })).toEqual({ ok: true, data: response });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, init] = fetch.mock.calls[0];
  expect(url).toMatch(new RegExp(`/participations/${item.id}/${operation}$`));
  expect(new Headers(init.headers).get("if-match")).toBe(item.etag);
  expect(init.body).toBe(JSON.stringify(body));
});
it("recover sends an explicitly selected destination without changing the response contract", async () => {
  const response = { ...mutationItem, coverage: board.coverage, delivery: board.delivery };
  const fetch = vi.fn().mockResolvedValue(Response.json(response)); vi.stubGlobal("fetch", fetch);
  expect(await recoverParticipationAction({ ...input, body: { to_stage_id: id(1) } })).toEqual({ ok: true, data: response });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ to_stage_id: id(1) });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("recover accepts an empty body; discard omits empty optional text at the client boundary", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(discarded)); vi.stubGlobal("fetch", fetch);
  await discardParticipationAction({ ...input, body: { reason: { group: "candidate", key: "unresponsive" }, comment: " ", candidate_message: "\u0085" } });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ reason: { group: "candidate", key: "unresponsive" } });
  await recoverParticipationAction({ ...input, body: {} });
  expect(fetch.mock.calls[1][1].body).toBe("{}");
});
it.each([[409, "recovery_stage_required"], [409, "already_discarded"], [409, "not_discarded"], [409, "placement_reentry_confirmation_required"], [400, "validation_error"]] as const)("maps %s %s without forwarding raw data", async (status, code) => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "private", code }, { status })); vi.stubGlobal("fetch", fetch);
  expect(await recoverParticipationAction({ ...input, body: {} })).toEqual({ ok: false, reason: code, reference: { status, code } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("strict decoders require discard/detail fields, discriminate history, and reject unknown codes or extra keys", () => {
  expect(boardSchema.safeParse({ ...board, participations: [discardedItem()] }).success).toBe(true);
  expect(detailSchema.safeParse({ ...detail, ...discardedItem(), comment: "Motivo", candidate_message: null }).success).toBe(true);
  for (const bad of [undefined, { ...discard, reason: { group: "recruiter", key: "unknown" } }, { ...discard, extra: true }]) {
    expect(boardSchema.safeParse({ ...board, participations: [{ ...item, discard: bad }] }).success).toBe(false);
  }
  expect(detailSchema.safeParse({ ...detail, comment: undefined }).success).toBe(false);
  const base = { ...history.items[0], from_stage_id: id(1), to_stage_id: id(6) };
  const entry = { ...base, kind: "discard", reason, comment: "Motivo", candidate_message: null };
  expect(historySchema.safeParse({ items: [entry, { ...base, kind: "recovery", departure: false }] }).success).toBe(true);
  for (const bad of [{ ...entry, extra: true }, { ...entry, candidate_message: undefined }, { ...entry, hire: true }, { ...base, kind: "recovery", reason }, { ...base, kind: "move", comment: null }]) expect(historySchema.safeParse({ items: [bad] }).success).toBe(false);
});
function discardedItem() { const { coverage, delivery, ...value } = discarded; void coverage; void delivery; return { ...item, ...value }; }
it("discard/recovery adoption recomputes counts, adopts coverage, and exit never participates in normal moves", () => {
  const parsed = boardSchema.parse(board);
  const after = applyParticipationToBoard(parsed, { ...discarded, coverage: { ...board.coverage, covered: 1 } });
  expect(after.exit.count).toBe(1); expect(after.stages[0].count).toBe(0); expect(after.coverage.covered).toBe(1);
  expect(allowedMoveTargets(after, after.participations[0])).toEqual([]);
  const recovered = applyParticipationToBoard(after, { ...parsed.participations[0], coverage: board.coverage, delivery: parsed.delivery });
  expect(recovered.exit.count).toBe(0); expect(recovered.stages[0].count).toBe(1);
});
it("rejects inconsistent discard placement, timestamp and previous stage in a board read", () => {
  const value = discardedItem();
  for (const invalid of [
    { ...value, stage_id: id(1) },
    { ...value, discard: null },
    { ...value, moved_at: "2026-10-19T12:00:00Z" },
    { ...value, discard: { ...discard, previous_stage_id: id(6) } },
    { ...value, discard: { ...discard, previous_stage_id: id(99) } },
  ]) expect(boardSchema.safeParse({ ...board, participations: [invalid] }).success).toBe(false);
});
it("candidate applications require message and closed enum without leaking other facts", () => {
  const application = { id: id(90), vacancy: { id: id(30), title: "Vacante" }, company: { id: id(31), name: "Empresa" }, applied_at: item.applied_at, status: "closed", message: "Gracias" };
  expect(applicationsSchema.safeParse({ items: [application], next_cursor: null }).success).toBe(true);
  for (const bad of [{ ...application, status: "rejected" }, { ...application, message: undefined }, { ...application, reason }, { ...application, status: "submitted" }]) expect(applicationsSchema.safeParse({ items: [bad], next_cursor: null }).success).toBe(false);
});
