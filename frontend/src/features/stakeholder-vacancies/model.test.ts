import { describe, expect, it } from "vitest";
import { stakeholderVacanciesSchema, statusFilterOf, statusLabelOf, type StakeholderVacancy } from "./model";
import { activeRow, closedRow, draftRow, ids, listWire, pausedRow, replacementRow } from "./test-fixtures";

// S12: the envelope of `GET /v2/me/company/stakeholder/vacancies` exactly as the backend documented it (L8).
describe("stakeholderVacanciesSchema", () => {
  it("accepts the documented envelope, nulls included, without rewriting it", () => {
    const wire = listWire();
    expect(stakeholderVacanciesSchema.parse(wire)).toEqual(wire);
  });
  it("accepts a draft that never published: publication, process, visibility, close_reason and coverage all null", () => {
    expect(stakeholderVacanciesSchema.parse({ items: [draftRow()], next_cursor: "opaque+/=" }).items[0]).toMatchObject({ publication: null, process: null, title: null, coverage: null });
  });
  it.each([[activeRow()], [pausedRow()], [replacementRow()], [closedRow({ publication: "closed", process: "active", close_reason: null, coverage: { covered: 0, required: null } })], [closedRow({ close_reason: "other" })], [closedRow({ close_reason: "cancelled" })]])("accepts the row %j", row => {
    expect(stakeholderVacanciesSchema.safeParse({ items: [row], next_cursor: null }).success).toBe(true);
  });
  it("accepts an empty list", () => {
    expect(stakeholderVacanciesSchema.parse({ items: [], next_cursor: null })).toEqual({ items: [], next_cursor: null });
  });
  const rejected: Array<[string, unknown]> = [
    ["an unknown key on the envelope", { ...listWire(), extra: 1 }],
    ["a missing next_cursor", { items: [] }],
    ["a non-string cursor", { items: [], next_cursor: 4 }],
    ["more than 50 rows", { items: Array.from({ length: 51 }, () => closedRow()), next_cursor: null }],
    ["an unknown key on a row", { items: [closedRow({ extra: true })], next_cursor: null }],
    ...["id", "title", "publication", "process", "kind", "visibility", "close_reason", "coverage", "documents_count"].map((key): [string, unknown] => [`a missing ${key}`, { items: [closedRow({ [key]: undefined })], next_cursor: null }]),
    ["a malformed id", { items: [closedRow({ id: "no-uuid" })], next_cursor: null }],
    ["an id with a trailing newline", { items: [closedRow({ id: `${ids.closed}\n` })], next_cursor: null }],
    ["the job-drafts status vocabulary «draft»", { items: [closedRow({ publication: "draft" })], next_cursor: null }],
    ["«published» with no process", { items: [activeRow({ process: null })], next_cursor: null }],
    ["a draft with a process", { items: [draftRow({ process: "active" })], next_cursor: null }],
    ["an unknown process", { items: [closedRow({ process: "stalled" })], next_cursor: null }],
    ["an unknown kind", { items: [closedRow({ kind: "clone" })], next_cursor: null }],
    ["an unknown visibility", { items: [closedRow({ visibility: "hidden" })], next_cursor: null }],
    ["an unknown close reason", { items: [closedRow({ close_reason: "lost" })], next_cursor: null }],
    ["a negative count", { items: [closedRow({ documents_count: -1 })], next_cursor: null }],
    ["a fractional count", { items: [closedRow({ documents_count: 1.5 })], next_cursor: null }],
    ["a coverage with an extra key", { items: [closedRow({ coverage: { covered: 1, required: 1, extra: 1 } })], next_cursor: null }],
    ["a negative coverage", { items: [closedRow({ coverage: { covered: -1, required: 1 } })], next_cursor: null }],
  ];
  it.each(rejected)("rejects %s", (_name, wire) => {
    expect(stakeholderVacanciesSchema.safeParse(wire).success).toBe(false);
  });
});

describe("status of a row", () => {
  const row = (over: Record<string, unknown>) => stakeholderVacanciesSchema.parse({ items: [closedRow(over)], next_cursor: null }).items[0] as StakeholderVacancy;
  it("labels every state and puts it in the filter the recruiter list uses", () => {
    const cases: Array<[Record<string, unknown>, string, string]> = [
      [{ publication: null, process: null, close_reason: null, coverage: null, visibility: null }, "Borrador", "draft"],
      [{ publication: "published", process: "active", close_reason: null, coverage: null }, "Activa", "active"],
      [{ publication: "paused", process: "active", close_reason: null, coverage: null }, "Pausada", "paused"],
      [{}, "Cerrada · Cubierta", "closed"],
    ];
    for (const [over, label, filter] of cases) {
      expect(statusLabelOf(row(over))).toBe(label);
      expect(statusFilterOf(row(over))).toBe(filter);
    }
  });
  it("reads «Cerrada · Cubierta al cierre» when the live coverage fell below the required places", () => {
    expect(statusLabelOf(row({ coverage: { covered: 1, required: 2 } }))).toBe("Cerrada · Cubierta al cierre");
  });
  it.each([["cancelled", "Cancelada"], ["other", "Otro"], [null, "Sin motivo registrado"]] as const)("a closed vacancy with reason %s reads «Cerrada · %s»", (reason, label) => {
    expect(statusLabelOf(row({ close_reason: reason, coverage: null }))).toBe(`Cerrada · ${label}`);
  });
});
