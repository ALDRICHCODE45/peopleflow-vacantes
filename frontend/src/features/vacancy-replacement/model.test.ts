import { describe, expect, it } from "vitest";
import { replacementsViewSchema, summarizeReplacements } from "./model";
import { ids, neverPublishedWire, replacementItemWire, replacementsWire } from "./test-fixtures";

// replacement-processes-v1 «GET V/replacements» as the backend (R4) really answers it.
const chain = () => {
  const wire = replacementsWire();
  return { ...wire, items: [...wire.items, replacementItemWire(ids.newDraft)] };
};

describe("replacementsViewSchema (R4 wire)", () => {
  it("accepts the original as sequence 0 followed by its replacement", () => {
    const view = replacementsViewSchema.parse(chain());
    expect(view.items.map(item => [item.kind, item.sequence])).toEqual([["original", 0], ["replacement", 1]]);
  });
  it("accepts a draft that never published: empty items, rooted at itself, blocker source_not_closed", () => {
    expect(replacementsViewSchema.parse(neverPublishedWire())).toMatchObject({
      root_process_id: ids.draft, items: [], start_replacement: { allowed: false, blocker: "source_not_closed", publish_ready: null },
    });
  });
  it("tolerates keys the contract may still add", () => {
    expect(replacementsViewSchema.safeParse({ ...chain(), future: 1 }).success).toBe(true);
  });
  it.each([null, -1, 1.5, "0"])("a chain item sequence of %j is not the contract's integer ≥ 0", sequence => {
    const wire = chain();
    wire.items[0] = { ...wire.items[0], sequence } as never;
    expect(replacementsViewSchema.safeParse(wire).success).toBe(false);
  });
});

describe("summarizeReplacements", () => {
  it("keeps only what the board needs: chain names and the credits by participation", () => {
    const summary = summarizeReplacements(replacementsViewSchema.parse(chain()));
    expect(summary.items).toEqual([
      { id: ids.draft, kind: "original", sequence: 0, title: "Supervisor(a) de Almacén", canOpen: true },
      { id: ids.newDraft, kind: "replacement", sequence: 1, title: "Supervisor(a) de Almacén", canOpen: true },
    ]);
    expect(summary.credits).toEqual([
      expect.objectContaining({ id: ids.creditRicardo, participationId: expect.any(String), hiredAt: "2026-10-22T16:00:00.000000Z", leftAt: "2026-11-17T16:00:00.000000Z" }),
      expect.objectContaining({ id: ids.creditLuis }),
    ]);
    expect(JSON.stringify(summary)).not.toContain("Ricardo");
  });
  it("R4b: keeps the fallen credits by participation with their status; absent (older backend) stays absent", () => {
    const wire = chain();
    const withFallen = { ...wire, fallen_credits: [
      { id: ids.creditRicardo, participation_id: ids.ricardo, process_id: ids.draft, hired_at: null, left_at: "2026-11-17T16:00:00.000000Z", exit_reason: "candidate_left", candidate: { kind: "manual", id: ids.ricardo, full_name: "Ricardo Morales García" }, status: "replaced", replaced_by_process_id: ids.newDraft },
      { id: ids.creditLuis, participation_id: ids.luis, process_id: ids.draft, hired_at: null, left_at: null, candidate: { kind: "manual", id: ids.luis, full_name: "Luis Pérez" }, status: "blocked", blocker: "replacement_active" },
    ] };
    expect(summarizeReplacements(replacementsViewSchema.parse(withFallen)).fallen).toEqual([
      { id: ids.creditRicardo, participationId: ids.ricardo, leftAt: "2026-11-17T16:00:00.000000Z", status: "replaced", replacedBy: ids.newDraft },
      { id: ids.creditLuis, participationId: ids.luis, leftAt: null, status: "blocked", replacedBy: null },
    ]);
    expect("fallen" in summarizeReplacements(replacementsViewSchema.parse(wire))).toBe(false);
  });
  it("is empty for the empty shape", () => {
    expect(summarizeReplacements(replacementsViewSchema.parse(neverPublishedWire()))).toEqual({ items: [], credits: [] });
  });
});
