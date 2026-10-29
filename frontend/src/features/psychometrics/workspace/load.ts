import "server-only";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { getAccountAssessments } from "../client";
import type { AccountAssessments, Result } from "../model";
export async function loadWorkspaceAssessments(): Promise<Result<AccountAssessments>> {
  try {
    const token = await getActionAccessToken();
    return token ? getAccountAssessments({ token }) : { ok: false, reason: "unauthenticated", reference: {} };
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
