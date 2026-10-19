import { expect, it } from "vitest";
import { boardSchema, historySchema, recoverBodySchema } from "./model";
import { board, history, id, item } from "./test-fixtures";

it("requires exact retired stages and a current recovery default for discarded candidates", () => {
  const retired = { id: id(99), kind: "custom", name: "Técnica retirada" };
  const discard = { reason: { group: "candidate", key: "unresponsive" }, discarded_at: item.moved_at, previous_stage_id: retired.id, recovery_stage_id: id(2) };
  const value = { ...board, retired_stages: [retired], participations: [{ ...item, stage_id: board.exit.id, discard }] };
  expect(boardSchema.safeParse(value).success).toBe(true);
  for (const invalid of [
    { ...value, retired_stages: undefined },
    { ...value, retired_stages: [{ ...retired, position: 3 }] },
    { ...value, retired_stages: [{ ...retired, kind: "discarded" }] },
    { ...value, participations: [{ ...value.participations[0], discard: { ...discard, recovery_stage_id: undefined } }] },
    { ...value, participations: [{ ...value.participations[0], discard: { ...discard, recovery_stage_id: retired.id } }] },
  ]) expect(boardSchema.safeParse(invalid).success).toBe(false);
});
it("decodes not_applicable with exactly its stage, actor and date, never a hire", () => {
  const entry = { kind: "not_applicable", stage_id: id(99), actor: history.items[0].actor, at: item.moved_at };
  expect(historySchema.safeParse({ items: [entry] }).success).toBe(true);
  for (const invalid of [{ ...entry, hire: false }, { ...entry, stage_id: undefined }, { ...entry, actor: null }, { ...entry, at: "invalid" }]) {
    expect(historySchema.safeParse({ items: [invalid] }).success).toBe(false);
  }
});
it("permits an optional recovery destination UUID but no other request keys", () => {
  expect(recoverBodySchema.safeParse({ to_stage_id: id(2) }).success).toBe(true);
  expect(recoverBodySchema.safeParse({}).success).toBe(true);
  expect(recoverBodySchema.safeParse({ to_stage_id: "invalid" }).success).toBe(false);
  expect(recoverBodySchema.safeParse({ to_stage_id: id(2), extra: true }).success).toBe(false);
});
