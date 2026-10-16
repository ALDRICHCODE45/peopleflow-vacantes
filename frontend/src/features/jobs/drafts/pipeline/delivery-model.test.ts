import { describe, expect, it } from "vitest";
import { adoptSaved, fromDelivery, isDateStale, isDirty, isSelectableDate, reconcileUncertainSave, setCommitmentDate, setCutoffStageId, setTargetText, toPutBody, validate, type Delivery } from "./delivery-model";
export const deliveryFixture = (): Delivery => ({ version: "0", cutoffStageId: null, targetQuantity: null, commitmentDate: null, limits: { maxTargetQuantity: 999 }, calendar: { timeZone: "America/Mexico_City", today: "2026-10-16", minDate: "2026-10-16", maxDate: "2027-10-16", nonBusinessDates: ["2026-10-17", "2026-10-18"] } });
describe("delivery model", () => {
  it("allows partial/all-null configuration and owns copies", () => {
    const source = deliveryFixture(); const state = fromDelivery(source);
    expect(validate(state, [])).toEqual({ ok: true, errors: {} }); expect(isDirty(state)).toBe(false);
    expect(toPutBody(state)).toEqual({ cutoffStageId: null, targetQuantity: null, commitmentDate: null });
    source.calendar.nonBusinessDates.push("2026-10-19"); source.limits.maxTargetQuantity = 1;
    expect(state.calendar.nonBusinessDates).toHaveLength(2); expect(state.limits.maxTargetQuantity).toBe(999);
    expect(state.baseline.calendar.nonBusinessDates).toHaveLength(2);
  });
  it.each([["0", "out_of_range"], ["1", undefined], ["999", undefined], ["1000", "out_of_range"], ["1.5", "not_integer"], ["abc", "not_integer"], ["", undefined], ["-1", "out_of_range"], ["1e2", "not_integer"], [" ", "not_integer"], ["999999999999999999999999", "out_of_range"]])("validates raw target %j", (text, error) => {
    const state = setTargetText(fromDelivery(deliveryFixture()), text!);
    expect(state.targetText).toBe(text); expect(validate(state, []).errors.targetText).toBe(error);
  });
  it("uses server limits rather than a hardcoded ceiling", () => {
    const state = fromDelivery({ ...deliveryFixture(), limits: { maxTargetQuantity: 2 } });
    expect(validate(setTargetText(state, "3"), []).errors.targetText).toBe("out_of_range");
  });
  it("only accepts progression ids including current cutoff", () => {
    const state = setCutoffStageId(fromDelivery(deliveryFixture()), "custom");
    expect(validate(state, ["custom"]).ok).toBe(true); expect(validate(state, ["other"]).errors.cutoffStageId).toBe("unknown_stage");
    expect(validate(setCutoffStageId(state, null), []).ok).toBe(true);
  });
  it.each([["2026-10-15", "outside_window"], ["2026-10-16", undefined], ["2027-10-16", undefined], ["2027-10-17", "outside_window"], ["2026-10-17", "non_business_day"], ["2026-02-30", "outside_window"], ["bad", "outside_window"], [null, undefined]])("validates changed date %j", (date, error) => {
    const state = setCommitmentDate(fromDelivery(deliveryFixture()), date);
    expect(validate(state, []).errors.commitmentDate).toBe(error);
    if (date) expect(isSelectableDate(state, date)).toBe(error === undefined);
  });
  it.each(["2025-01-01", "2028-01-01", "2026-10-17"])("preserves unchanged stored date %s when saving another field", date => {
    const state = setTargetText(fromDelivery({ ...deliveryFixture(), commitmentDate: date }), "5");
    expect(validate(state, []).ok).toBe(true); expect(toPutBody(state).commitmentDate).toBe(date);
    expect(isDateStale(state)).toBe(date !== "2026-10-17");
    expect(isDateStale(setCommitmentDate(state, "2026-10-16"))).toBe(false);
  });
  it("tracks dirtiness, adopts saved values/calendar and reconciles without replay", () => {
    const baseline = deliveryFixture(); const original = fromDelivery(baseline);
    const state = setTargetText(setCutoffStageId(setCommitmentDate(original, "2026-10-16"), "custom"), "05");
    expect(isDirty(state)).toBe(true); expect(toPutBody(state)).toEqual({ cutoffStageId: "custom", targetQuantity: 5, commitmentDate: "2026-10-16" });
    const saved = { ...baseline, ...toPutBody(state), version: "1" };
    expect(reconcileUncertainSave(state, saved)).toBe("saved");
    expect(reconcileUncertainSave(state, { ...saved, version: "0" })).toBe("saved");
    expect(reconcileUncertainSave(state, baseline)).toBe("not_saved");
    expect(reconcileUncertainSave(state, { ...baseline, version: "2" })).toBe("conflict");
    const adopted = adoptSaved(state, saved); expect(isDirty(adopted)).toBe(false); expect(adopted.targetText).toBe("5");
    expect(isDirty(setTargetText(original, ""))).toBe(false);
  });
});
