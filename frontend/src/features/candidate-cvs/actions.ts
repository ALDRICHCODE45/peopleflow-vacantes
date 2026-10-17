"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadCvs, renameCv, deleteCv, type ClientResult } from "./client";
import { cvFailure } from "./failure";
import type { Cv, CvLibrary, CvResult } from "./model";
async function authenticated<T>(run: (token: string) => Promise<ClientResult<T>>): Promise<CvResult<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await run(token);
    return result.ok ? { ok: true, data: result.data } : cvFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function loadCvsAction(): Promise<CvResult<CvLibrary>> { return authenticated(token => loadCvs({ token })); }
export async function renameCvAction(id: unknown, body: unknown): Promise<CvResult<Cv>> { return authenticated(token => renameCv({ token, id, body })); }
export async function deleteCvAction(id: unknown): Promise<CvResult<null>> { return authenticated(token => deleteCv({ token, id })); }
