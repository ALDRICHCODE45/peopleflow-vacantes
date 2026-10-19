export type DeliveryPutBody = { cutoffStageId: string | null; targetQuantity: number | null; commitmentDate: string | null; confirm_fulfillment?: boolean };
export type Delivery = DeliveryPutBody & {
  version: string;
  fulfilled: boolean;
  limits: { maxTargetQuantity: number };
  calendar: { timeZone: string; today: string; minDate: string; maxDate: string; nonBusinessDates: string[] };
};
export type DeliveryState = {
  cutoffStageId: string | null; targetText: string; commitmentDate: string | null;
  limits: Delivery["limits"]; calendar: Delivery["calendar"]; baseline: Delivery;
};
export type DeliveryErrors = { cutoffStageId?: "unknown_stage"; targetText?: "not_integer" | "out_of_range"; commitmentDate?: "outside_window" | "non_business_day" };

/** Civil dates are compared as strings, never as instants in the viewer's timezone. */
export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$(?![\s\S])/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return year > 0 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function copy(delivery: Delivery): Delivery {
  return { ...delivery, limits: { ...delivery.limits }, calendar: { ...delivery.calendar, nonBusinessDates: [...delivery.calendar.nonBusinessDates] } };
}
export function fromDelivery(delivery: Delivery): DeliveryState {
  const saved = copy(delivery);
  return { cutoffStageId: saved.cutoffStageId, targetText: saved.targetQuantity === null ? "" : String(saved.targetQuantity), commitmentDate: saved.commitmentDate, limits: { ...saved.limits }, calendar: { ...saved.calendar, nonBusinessDates: [...saved.calendar.nonBusinessDates] }, baseline: saved };
}
export function setCutoffStageId(state: DeliveryState, cutoffStageId: string | null): DeliveryState { return { ...state, cutoffStageId }; }
export function setTargetText(state: DeliveryState, targetText: string): DeliveryState { return { ...state, targetText }; }
export function setCommitmentDate(state: DeliveryState, commitmentDate: string | null): DeliveryState { return { ...state, commitmentDate }; }
export function isSelectableDate(state: DeliveryState, date: string): boolean {
  return isCivilDate(date) && date >= state.calendar.minDate && date <= state.calendar.maxDate && !state.calendar.nonBusinessDates.includes(date);
}
export function validate(state: DeliveryState, progressionStageIds: readonly string[]): { ok: boolean; errors: DeliveryErrors } {
  const errors: DeliveryErrors = {};
  if (state.cutoffStageId !== null && !progressionStageIds.includes(state.cutoffStageId)) errors.cutoffStageId = "unknown_stage";
  if (state.targetText !== "") {
    if (!/^-?\d+$(?![\s\S])/.test(state.targetText)) errors.targetText = "not_integer";
    else if (!Number.isSafeInteger(Number(state.targetText)) || Number(state.targetText) < 1 || Number(state.targetText) > state.limits.maxTargetQuantity) errors.targetText = "out_of_range";
  }
  const date = state.commitmentDate;
  if (date !== null && date !== state.baseline.commitmentDate) {
    if (!isCivilDate(date) || date < state.calendar.minDate || date > state.calendar.maxDate) errors.commitmentDate = "outside_window";
    else if (state.calendar.nonBusinessDates.includes(date)) errors.commitmentDate = "non_business_day";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
export function isDateStale(state: DeliveryState): boolean {
  const date = state.commitmentDate;
  return date !== null && date === state.baseline.commitmentDate && (date < state.calendar.today || date < state.calendar.minDate || date > state.calendar.maxDate);
}
export function toPutBody(state: DeliveryState): DeliveryPutBody {
  return { cutoffStageId: state.cutoffStageId, targetQuantity: state.targetText === "" ? null : Number(state.targetText), commitmentDate: state.commitmentDate };
}
export function isDirty(state: DeliveryState): boolean {
  // Invalid raw input must never disappear through numeric serialization (NaN -> null).
  return state.cutoffStageId !== state.baseline.cutoffStageId || state.commitmentDate !== state.baseline.commitmentDate || state.targetText !== (state.baseline.targetQuantity === null ? "" : String(state.baseline.targetQuantity));
}
export function adoptSaved(_state: DeliveryState, saved: Delivery): DeliveryState { return fromDelivery(saved); }
export function reconcileUncertainSave(state: DeliveryState, fetched: Delivery): "saved" | "not_saved" | "conflict" {
  const body = toPutBody(state);
  if (body.cutoffStageId === fetched.cutoffStageId && body.targetQuantity === fetched.targetQuantity && body.commitmentDate === fetched.commitmentDate) return "saved";
  return fetched.version === state.baseline.version ? "not_saved" : "conflict";
}
