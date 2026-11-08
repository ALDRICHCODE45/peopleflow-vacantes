import { isCivilDate } from "./delivery-model";

/** targetCloseDate: absent keeps the stored date, null clears it. */
export type ManagementPutBody = { requestDate: string | null; hiringHeadcount: number | null; targetCloseDate?: string | null };
/** GET omits targetCloseDate while it is unset. */
export type Management = { requestDate: string | null; hiringHeadcount: number | null; targetCloseDate?: string; version: string; limits: { maxHiringHeadcount: number }; today: string };
export type ManagementState = {
  requestDate: string | null; headcountText: string; targetCloseDate: string | null;
  limits: Management["limits"]; today: string; baseline: Management;
};
export type ManagementErrors = { requestDate?: "future"; headcountText?: "not_integer" | "out_of_range"; targetCloseDate?: "invalid" };

export function fromManagement(management: Management): ManagementState {
  const saved = { ...management, limits: { ...management.limits } };
  return { requestDate: saved.requestDate, targetCloseDate: saved.targetCloseDate ?? null, headcountText: saved.hiringHeadcount === null ? "" : String(saved.hiringHeadcount), limits: { ...saved.limits }, today: saved.today, baseline: saved };
}
export function setHeadcountText(state: ManagementState, headcountText: string): ManagementState { return { ...state, headcountText }; }
export function setRequestDate(state: ManagementState, requestDate: string | null): ManagementState { return { ...state, requestDate }; }
export function setTargetCloseDate(state: ManagementState, targetCloseDate: string | null): ManagementState { return { ...state, targetCloseDate }; }
function targetChanged(state: ManagementState): boolean { return state.targetCloseDate !== (state.baseline.targetCloseDate ?? null); }
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
  if (state.targetCloseDate !== null && targetChanged(state) && !isCivilDate(state.targetCloseDate)) errors.targetCloseDate = "invalid";
  return { ok: Object.keys(errors).length === 0, errors };
}
export function toPutBody(state: ManagementState): ManagementPutBody {
  const body = { requestDate: state.requestDate, hiringHeadcount: state.headcountText === "" ? null : Number(state.headcountText) };
  return targetChanged(state) ? { ...body, targetCloseDate: state.targetCloseDate } : body;
}
export function isDirty(state: ManagementState): boolean {
  // Keep invalid raw edits dirty; numeric serialization would hide them (NaN -> null).
  return state.requestDate !== state.baseline.requestDate || targetChanged(state) || state.headcountText !== (state.baseline.hiringHeadcount === null ? "" : String(state.baseline.hiringHeadcount));
}
export function adoptSaved(_state: ManagementState, saved: Management): ManagementState { return fromManagement(saved); }
export function reconcileUncertainSave(state: ManagementState, fetched: Management): "saved" | "not_saved" | "conflict" {
  const body = toPutBody(state);
  const target = body.targetCloseDate === undefined || body.targetCloseDate === (fetched.targetCloseDate ?? null);
  if (body.requestDate === fetched.requestDate && body.hiringHeadcount === fetched.hiringHeadcount && target) return "saved";
  return fetched.version === state.baseline.version ? "not_saved" : "conflict";
}
