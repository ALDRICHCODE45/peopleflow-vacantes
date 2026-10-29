"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getAccountAssessments } from "../client";
import type { AccountAssessments, Result } from "../model";
// Session refresh writes cookies: invoke only from a mounted client, never RSC render.
export async function loadWorkspaceAssessmentsAction(): Promise<Result<AccountAssessments>> {
  try {
    const token = await getActionAccessToken();
    return token ? getAccountAssessments({ token }) : { ok: false, reason: "unauthenticated", reference: {} };
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
