"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadApplications, loadScreening, submitApplication, type ClientResult } from "./client";
import { applicationFailure } from "./failure";
import type { ApplicationsPage, ApplicationsQuery, Result, Screening, Submitted } from "./model";
async function authenticated<T>(run: (token: string) => Promise<ClientResult<T>>): Promise<Result<T>> {
  try { const token = await getActionAccessToken(); if (!token) return { ok: false, reason: "unauthenticated", reference: {} }; const result = await run(token); return result.ok ? { ok: true, data: result.data } : applicationFailure(result); }
  catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function loadScreeningAction(id: unknown): Promise<Result<Screening>> {
  try { const result = await loadScreening(id); return result.ok ? { ok: true, data: result.data } : applicationFailure(result); }
  catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function submitApplicationAction(id: unknown, key: unknown, body: unknown): Promise<Result<Submitted>> { return authenticated(token => submitApplication({ token, id, key, body })); }
export async function loadApplicationsAction(query: ApplicationsQuery = {}): Promise<Result<ApplicationsPage>> { return authenticated(token => loadApplications({ token, query })); }
