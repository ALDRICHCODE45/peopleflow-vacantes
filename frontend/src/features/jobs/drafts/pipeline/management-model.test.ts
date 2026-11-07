import { describe, expect, it } from "vitest";
import { adoptSaved, fromManagement, isDirty, isSelectableRequestDate, reconcileUncertainSave, setHeadcountText, setRequestDate, setTargetCloseDate, toPutBody, validate, type Management } from "./management-model";
const fixture = (): Management => ({ version: "0", requestDate: null, hiringHeadcount: null, limits: { maxHiringHeadcount: 999 }, today: "2026-10-16" });
describe("management model", () => {
  it("allows partial/all-null configuration and owns copies", () => {
    const source = fixture(); const state = fromManagement(source);
    expect(validate(state)).toEqual({ ok: true, errors: {} }); expect(isDirty(state)).toBe(false);
    expect(toPutBody(state)).toEqual({ requestDate: null, hiringHeadcount: null });
    source.limits.maxHiringHeadcount = 1; expect(state.limits.maxHiringHeadcount).toBe(999); expect(state.baseline.limits.maxHiringHeadcount).toBe(999);
  });
  it.each([["0", "out_of_range"], ["1", undefined], ["999", undefined], ["1000", "out_of_range"], ["1.5", "not_integer"], ["abc", "not_integer"], ["", undefined], ["-1", "out_of_range"], ["1e2", "not_integer"], [" ", "not_integer"], ["1\n", "not_integer"], ["999999999999999999999999", "out_of_range"]])("validates raw headcount %j", (text, error) => {
    const state = setHeadcountText(fromManagement(fixture()), text!);
    expect(state.headcountText).toBe(text); expect(validate(state).errors.headcountText).toBe(error);
  });
  it("uses server limits rather than a hardcoded ceiling", () => {
    const state = fromManagement({ ...fixture(), limits: { maxHiringHeadcount: 2 } });
    expect(validate(setHeadcountText(state, "3")).errors.headcountText).toBe("out_of_range");
  });
  it.each([["2026-10-15", undefined], ["2026-10-16", undefined], ["2026-10-17", "future"], ["2026-10-11", undefined], ["1900-01-01", undefined], ["2026-02-30", "future"], ["bad", "future"], [null, undefined]])("validates changed date %j including weekends and today", (date, error) => {
    const state = setRequestDate(fromManagement(fixture()), date);
    expect(validate(state).errors.requestDate).toBe(error);
    if (date) expect(isSelectableRequestDate(state, date)).toBe(error === undefined);
  });
  it("preserves an unchanged future stored date while saving another field, but rejects a changed future date", () => {
    const state = setHeadcountText(fromManagement({ ...fixture(), requestDate: "2028-01-01" }), "5");
    expect(validate(state).ok).toBe(true); expect(toPutBody(state).requestDate).toBe("2028-01-01");
    expect(validate(setRequestDate(state, "2028-01-02")).errors.requestDate).toBe("future");
    expect(validate(setRequestDate(state, null)).ok).toBe(true);
  });
  it("tracks raw dirtiness, adopts saved values/today and reconciles without replay", () => {
    const baseline = fixture(); const original = fromManagement(baseline);
    const state = setHeadcountText(setRequestDate(original, "2026-10-16"), "05");
    expect(isDirty(state)).toBe(true); expect(toPutBody(state)).toEqual({ requestDate: "2026-10-16", hiringHeadcount: 5 });
    const saved: Management = { ...baseline, requestDate: "2026-10-16", hiringHeadcount: 5, version: "1", today: "2026-10-17" };
    expect(reconcileUncertainSave(state, saved)).toBe("saved");
    expect(reconcileUncertainSave(state, { ...saved, version: "0" })).toBe("saved");
    expect(reconcileUncertainSave(state, baseline)).toBe("not_saved");
    expect(reconcileUncertainSave(state, { ...baseline, version: "2" })).toBe("conflict");
    const adopted = adoptSaved(state, saved); expect(isDirty(adopted)).toBe(false); expect(adopted.headcountText).toBe("5"); expect(adopted.today).toBe("2026-10-17");
    expect(isDirty(setHeadcountText(original, ""))).toBe(false); expect(isDirty(setHeadcountText(original, "abc"))).toBe(true);
    expect(isDirty(setRequestDate(original, "2026-10-16"))).toBe(true);
  });
  it("omits an unchanged target close date so the server keeps it, while the other fields still save", () => {
    const state = setHeadcountText(fromManagement({ ...fixture(), targetCloseDate: "2026-12-15" }), "5");
    expect(state.targetCloseDate).toBe("2026-12-15"); expect(isDirty(state)).toBe(true);
    expect(toPutBody(state)).toEqual({ requestDate: null, hiringHeadcount: 5 });
    expect(toPutBody(fromManagement(fixture()))).toEqual({ requestDate: null, hiringHeadcount: null });
  });
  it("sends a changed target close date and null to clear it", () => {
    const unset = fromManagement(fixture());
    const set = setTargetCloseDate(unset, "2026-12-15");
    expect(isDirty(set)).toBe(true); expect(validate(set)).toEqual({ ok: true, errors: {} });
    expect(toPutBody(set)).toEqual({ requestDate: null, hiringHeadcount: null, targetCloseDate: "2026-12-15" });
    const cleared = setTargetCloseDate(fromManagement({ ...fixture(), targetCloseDate: "2026-12-15" }), null);
    expect(isDirty(cleared)).toBe(true); expect(toPutBody(cleared)).toEqual({ requestDate: null, hiringHeadcount: null, targetCloseDate: null });
    expect(isDirty(setTargetCloseDate(unset, null))).toBe(false);
  });
  it.each(["2026-02-30", "bad"])("rejects a changed malformed target close date %j", date => {
    expect(validate(setTargetCloseDate(fromManagement(fixture()), date)).errors).toEqual({ targetCloseDate: "invalid" });
  });
  it("reconciles an uncertain target close date write by its value", () => {
    const state = setTargetCloseDate(fromManagement(fixture()), "2026-12-15");
    expect(reconcileUncertainSave(state, { ...fixture(), version: "1", targetCloseDate: "2026-12-15" })).toBe("saved");
    expect(reconcileUncertainSave(state, fixture())).toBe("not_saved");
    const cleared = setTargetCloseDate(fromManagement({ ...fixture(), targetCloseDate: "2026-12-15" }), null);
    expect(reconcileUncertainSave(cleared, { ...fixture(), version: "1" })).toBe("saved");
    expect(reconcileUncertainSave(cleared, { ...fixture(), targetCloseDate: "2026-12-15" })).toBe("not_saved");
  });
});
