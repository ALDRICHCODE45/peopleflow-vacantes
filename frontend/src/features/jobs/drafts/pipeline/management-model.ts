import { isCivilDate } from "./delivery-model";

export type ManagementPutBody = { requestDate: string | null; hiringHeadcount: number | null };
export type Management = ManagementPutBody & { version: string; limits: { maxHiringHeadcount: number }; today: string };
export type ManagementState = {
  requestDate: string | null; headcountText: string;
  limits: Management["limits"]; today: string; baseline: Management;
};
export type ManagementErrors = { requestDate?: "future"; headcountText?: "not_integer" | "out_of_range" };

export function fromManagement(management: Management): ManagementState {
  const saved = { ...management, limits: { ...management.limits } };
  return { requestDate: saved.requestDate, headcountText: saved.hiringHeadcount === null ? "" : String(saved.hiringHeadcount), limits: { ...saved.limits }, today: saved.today, baseline: saved };
}
export function setHeadcountText(state: ManagementState, headcountText: string): ManagementState { return { ...state, headcountText }; }
export function setRequestDate(state: ManagementState, requestDate: string | null): ManagementState { return { ...state, requestDate }; }
/** Civil dates use the server's today, never the viewer's clock or timezone. */
export function isSelectableRequestDate(state: ManagementState, date: string): boolean {
  return isCivilDate(date) && date <= state.today;
}
export function validate(state: ManagementState): { ok: boolean; errors: ManagementErrors } {
  const errors: ManagementErrors = {};
  if (state.headcountText !== "") {
    if (!/^-?\d+$(?![\s\S])/.test(state.headcountText)) errors.headcountText = "not_integer";
    else if (!Number.isSafeInteger(Number(state.headcountText)) || Number(state.headcountText) < 1 || Number(state.headcountText) > state.limits.maxHiringHeadcount) errors.headcountText = "out_of_range";
  }
  if (state.requestDate !== null && state.requestDate !== state.baseline.requestDate && !isSelectableRequestDate(state, state.requestDate)) errors.requestDate = "future";
  return { ok: Object.keys(errors).length === 0, errors };
}
export function toPutBody(state: ManagementState): ManagementPutBody {
  return { requestDate: state.requestDate, hiringHeadcount: state.headcountText === "" ? null : Number(state.headcountText) };
}
export function isDirty(state: ManagementState): boolean {
  // Keep invalid raw edits dirty; numeric serialization would hide them (NaN -> null).
  return state.requestDate !== state.baseline.requestDate || state.headcountText !== (state.baseline.hiringHeadcount === null ? "" : String(state.baseline.hiringHeadcount));
}
export function adoptSaved(_state: ManagementState, saved: Management): ManagementState { return fromManagement(saved); }
export function reconcileUncertainSave(state: ManagementState, fetched: Management): "saved" | "not_saved" | "conflict" {
  const body = toPutBody(state);
  if (body.requestDate === fetched.requestDate && body.hiringHeadcount === fetched.hiringHeadcount) return "saved";
  return fetched.version === state.baseline.version ? "not_saved" : "conflict";
}
