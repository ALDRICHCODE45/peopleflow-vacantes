"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadSavedJobIds, loadSavedJobs, removeClosedSavedJobs, removeSavedJob, saveJob } from "./client";
import type { SavedJobsResult } from "./model";
async function authenticated<T>(run: (token: string) => Promise<SavedJobsResult<T>>): Promise<SavedJobsResult<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token) return { ok: false, reason: "unauthenticated", reference: {} };
    return await run(token);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function loadSavedJobsAction() { return authenticated(token => loadSavedJobs({ token })); }
export async function loadSavedJobIdsAction() { return authenticated(token => loadSavedJobIds({ token })); }
export async function saveJobAction(id: unknown) { return authenticated(token => saveJob({ token, id })); }
export async function removeSavedJobAction(id: unknown) { return authenticated(token => removeSavedJob({ token, id })); }
export async function removeClosedSavedJobsAction() { return authenticated(token => removeClosedSavedJobs({ token })); }
