"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { loadMe } from "./me-client";
import { createCandidateAccount } from "./candidate-account-client";
import { identityFailure } from "./failure";
import type { IdentityResult } from "./model";

/** Invoked by client loaders, not RSC renders: refreshed cookies must persist. */
export async function loadMeAction(): Promise<IdentityResult> {
  try {
    const token = await getActionAccessToken();
    if (!token) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await loadMe({ token });
    return result.ok ? { ok: true, data: result.data } : identityFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}

export async function createCandidateAccountAction(body: unknown): Promise<IdentityResult> {
  try {
    const token = await getActionAccessToken();
    if (!token) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await createCandidateAccount({ token, body });
    return result.ok ? { ok: true, data: result.data } : identityFailure(result);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
