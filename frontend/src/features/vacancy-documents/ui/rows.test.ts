import { describe, expect, it } from "vitest";
import { overviewSchema } from "../model";
import { ids, overviewWire } from "../test-fixtures";
import { buildRows, chooseCandidate, chooseScope, filterRows, NO_FILTERS, scopeCounts } from "./rows";
import { withItem, withoutRow } from "./overview-state";

const overview = () => overviewSchema.parse(overviewWire());

describe("filter rule (S13)", () => {
  it("choosing a candidate sets «Candidatos»; clearing it keeps the scope", () => {
    const chosen = chooseCandidate(NO_FILTERS, ids.participation);
    expect(chosen).toMatchObject({ scope: "candidates", participationId: ids.participation });
    expect(chooseCandidate(chosen, null)).toMatchObject({ scope: "candidates", participationId: null });
  });
  it("«Vacante» clears the candidate; «Todos» and «Candidatos» keep it", () => {
    const chosen = chooseCandidate(NO_FILTERS, ids.participation);
    expect(chooseScope(chosen, "vacancy")).toMatchObject({ scope: "vacancy", participationId: null });
    expect(chooseScope(chosen, "all").participationId).toBe(ids.participation);
  });
});

describe("rows", () => {
  it("merges items and links newest first and filters by scope and by name without accents", () => {
    const rows = buildRows(overview());
    expect(rows.map(row => row.at)).toEqual([...rows.map(row => row.at)].sort().reverse());
    expect(filterRows(rows, { scope: "vacancy", search: "" }).every(row => row.owner.kind === "vacancy")).toBe(true);
    expect(filterRows(rows, { scope: "candidates", search: "" }).every(row => row.owner.kind === "participation")).toBe(true);
    expect(filterRows(rows, { scope: "all", search: "  CONTRATO  " }).map(row => row.kind)).toContain("item");
    expect(filterRows(rows, { scope: "all", search: "órigínál" }).map(row => row.kind)).toEqual(["link"]);
  });
  it("takes the vacancy count from scope.counts and hides the candidate side when narrowed or truncated", () => {
    const value = overview();
    const rows = buildRows(value);
    expect(scopeCounts(value, rows, false)).toEqual({ all: 4, vacancy: 2, candidates: 2 });
    expect(scopeCounts(value, rows, true)).toEqual({ all: null, vacancy: 2, candidates: null });
    expect(scopeCounts({ ...value, truncated: true }, rows, false).candidates).toBeNull();
  });
});

describe("local updates from a write's scope", () => {
  it("a removed row leaves the list and the vacancy scope replaces counts and flags", () => {
    const value = overview();
    const scope = { ...value.scope, counts: { documents: 0, links: 1 }, allowed_actions: ["upload" as const] };
    const next = withoutRow(value, { kind: "item", id: ids.document2 }, null, scope);
    expect(next.items.map(item => item.id)).not.toContain(ids.document2);
    expect(next.scope).toEqual(scope);
  });
  it("a participation's scope updates only that person's flags; an unknown owner asks for a re-read", () => {
    const value = overview();
    const scope = { ...value.scope, allowed_actions: [], upload_blocked_reason: "limit_reached" as const };
    const next = withItem(value, value.items[0], ids.participation, scope)!;
    expect(next.scope).toEqual(value.scope);
    expect(next.participations[0]).toMatchObject({ scope_allowed_actions: [], upload_blocked_reason: "limit_reached" });
    expect(withItem(value, value.items[0], ids.draft, scope)).toBeUndefined();
  });
});
