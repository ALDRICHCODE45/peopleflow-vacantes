"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getChecklist, saveChecklist, getChecklistMarks, setChecklistMark, clearChecklistMark, type SaveChecklistInput, type SetMarkInput, type MarkTarget } from "./client";
import type { Checklist, Marks, Mark, Result } from "./model";
async function authenticated<T>(call: (token: string) => Promise<Result<T>>): Promise<Result<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    return await call(token);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function loadChecklistAction(vacancyId: string): Promise<Result<Checklist>> {
  return authenticated(token => getChecklist({ token, vacancyId }));
}
/** Reconcile failed writes with a read before retrying; no automatic replay. */
export async function saveChecklistAction(input: Omit<SaveChecklistInput, "token">): Promise<Result<Checklist>> {
  return authenticated(token => saveChecklist({ ...input, token }));
}
export async function loadChecklistMarksAction(vacancyId: string): Promise<Result<Marks>> {
  return authenticated(token => getChecklistMarks({ token, vacancyId }));
}
export async function setChecklistMarkAction(input: Omit<SetMarkInput, "token">): Promise<Result<Mark>> {
  return authenticated(token => setChecklistMark({ ...input, token }));
}
export async function clearChecklistMarkAction(input: Omit<MarkTarget, "token">): Promise<Result<null>> {
  return authenticated(token => clearChecklistMark({ ...input, token }));
}
