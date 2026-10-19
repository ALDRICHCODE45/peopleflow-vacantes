import { describe, expect, it } from "vitest";
import { add, adoptSaved, availableSuggestions, canMove, canMoveTo, fromCatalog, isDirty, move, moveTo, reconcileUncertainSave, remove, rename, toPutBody, validate, type SubstatesCatalog } from "./substates-model";

const catalog = (): SubstatesCatalog => ({ version: "0", substates: [], limits: { maxSubstates: 3, nameMaxLength: 40 }, suggestions: ["Primera entrevista", "Segunda entrevista", "Pruebas"] });
const populated = () => add(add(add(fromCatalog(catalog()), "Uno"), "Dos"), "Tres");
describe("substate catalog editor", () => {
  it("starts empty and valid without writes, copies the catalog and retains suggestions", () => {
    const input = catalog(); const state = fromCatalog(input);
    input.suggestions.push("Changed"); input.limits.maxSubstates = 99;
    expect(state.entries).toEqual([]); expect(state.limits.maxSubstates).toBe(3);
    expect(state.suggestions).toHaveLength(3); expect(validate(state)).toEqual({ ok: true, errors: {} });
    expect(isDirty(state)).toBe(false); expect(toPutBody(state)).toEqual({ substates: [] });
  });
  it("adds empty or suggested entries up to the server limit and never reuses local keys", () => {
    let state = add(fromCatalog(catalog())); const key = state.entries[0].key;
    expect(state.entries[0]).toMatchObject({ id: null, name: "" });
    expect(validate(state).errors[key]).toBe("required");
    state = add(remove(state, key), "Primera entrevista");
    expect(state.entries[0].key).not.toBe(key);
    state = add(add(state, "Dos"), "Tres"); expect(add(state)).toBe(state);
    expect(remove(state, "missing")).toBe(state);
  });
  it("normalizes exactly like column names; empty names are required, never duplicates", () => {
    let state = add(add(fromCatalog(catalog()), ""), " \u00a0 ");
    expect(Object.values(validate(state).errors)).toEqual(["required", "required"]);
    state = rename(state, state.entries[0].key, "  A\u0301REA\u00a0 técnica  ");
    state = rename(state, state.entries[1].key, "área técnica");
    expect(Object.values(validate(state).errors)).toEqual(["duplicate", "duplicate"]);
    expect(toPutBody(state).substates[0]).toEqual({ name: "ÁREA técnica" });
    expect(rename(state, "missing", "x")).toBe(state);
  });
  it.each([["x".repeat(41), "too_long"], ["Bad\u0000", "control_character"], ["😀".repeat(40), undefined]])("validates %j by code points", (name, error) => {
    const state = add(fromCatalog(catalog()), name!);
    expect(validate(state).errors[state.entries[0].key]).toBe(error);
  });
  it("casefolds without losing accents and reports a catalog-level limit error", () => {
    const state = add(add(fromCatalog(catalog()), "Straße"), "STRASSE");
    expect(Object.values(validate(state).errors)).toEqual(["duplicate", "duplicate"]);
    expect(validate({ ...state, limits: { ...state.limits, maxSubstates: 1 } }).errors.$catalog).toBe("too_many_substates");
    expect(validate(add(add(fromCatalog(catalog()), "Área"), "Area")).ok).toBe(true);
  });
  it("moves any entry to either endpoint, preserves relative order and refuses invalid targets", () => {
    const state = populated(); const first = state.entries[0].key;
    expect(canMove(state, first, "up")).toBe(false); expect(canMove(state, first, "down")).toBe(true);
    expect(move(state, first, "up")).toBe(state);
    expect(move(state, first, "down").entries.map(e => e.name)).toEqual(["Dos", "Uno", "Tres"]);
    const last = moveTo(state, first, 2); expect(last.entries.map(e => e.name)).toEqual(["Dos", "Tres", "Uno"]);
    expect(moveTo(last, first, 0).entries).toEqual(state.entries);
    for (const target of [-1, 3, 0.5, NaN, 0]) { expect(canMoveTo(state, first, target)).toBe(false); expect(moveTo(state, first, target)).toBe(state); }
    expect(canMoveTo(state, "missing", 1)).toBe(false);
  });
  it("filters suggestions against normalized saved and unsaved names and restores them on removal", () => {
    const state = add(fromCatalog(catalog()), " PRIMERA\u00a0entrevista ");
    expect(availableSuggestions(state)).toEqual(["Segunda entrevista", "Pruebas"]);
    expect(availableSuggestions(remove(state, state.entries[0].key))).toEqual(catalog().suggestions);
  });
  it("detects normalized dirtiness, preserves existing ids, and adopts server ids by position", () => {
    const input = { ...catalog(), substates: [{ id: "saved", name: "Uno", in_use: false }] };
    let state = fromCatalog(input); expect(isDirty(rename(state, "saved", " Uno "))).toBe(false);
    state = add(state, " Dos "); expect(isDirty(state)).toBe(true);
    expect(toPutBody(state)).toEqual({ substates: [{ id: "saved", name: "Uno" }, { name: "Dos" }] });
    const saved = adoptSaved(state, { ...input, version: "1", substates: [{ id: "saved", name: "Uno", in_use: false }, { id: "server", name: "Dos", in_use: false }] });
    expect(saved.entries.map(e => e.key)).toEqual(state.entries.map(e => e.key)); expect(saved.entries[1].id).toBe("server");
    expect(saved.nextKey).toBe(state.nextKey); expect(isDirty(saved)).toBe(false);
  });
  it("reconciles matching writes (including no-ops and new ids), not_saved and conflict without replay", () => {
    const input = catalog(); const state = add(fromCatalog(input), " Uno ");
    const matching = { ...input, substates: [{ id: "server", name: "Uno", in_use: false }] };
    expect(reconcileUncertainSave(state, matching)).toBe("saved");
    expect(reconcileUncertainSave(state, input)).toBe("not_saved");
    expect(reconcileUncertainSave(state, { ...input, version: "2" })).toBe("conflict");
    const existing = fromCatalog(matching);
    expect(reconcileUncertainSave(existing, { ...matching, version: "2", substates: [{ id: "other", name: "Uno", in_use: false }] })).toBe("conflict");
    expect(reconcileUncertainSave(fromCatalog(input), input)).toBe("saved");
  });
});
