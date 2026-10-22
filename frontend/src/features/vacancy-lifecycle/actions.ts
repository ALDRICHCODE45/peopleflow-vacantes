"use server";

import { getActionAccessToken } from "@/lib/auth/action-session";
import { getLifecycle, transitionLifecycle, type LifecycleResult, type TransitionInput } from "./client";
import type { CloseBody } from "./model";
import { mapLifecycleFailure, type LifecycleActionFailure } from "./failure";

export type LifecycleActionResult = Extract<LifecycleResult, { ok: true }> | LifecycleActionFailure;
export type LifecycleTransitionActionInput = Omit<TransitionInput, "token" | "action" | "body"> & (
  | { action: "close"; body: CloseBody }
  | { action: "pause" | "resume" | "finish_process" | "reopen"; body: Record<string, never> }
);
async function withSession(run: (token: string) => Promise<LifecycleResult>): Promise<LifecycleActionResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return mapLifecycleFailure({ ok: false, error: { kind: "missing_token", retryable: false } });
    const result = await run(token);
    return result.ok ? result : mapLifecycleFailure(result);
  } catch {
    return mapLifecycleFailure({ ok: false, error: { kind: "network", retryable: false } });
  }
}
export async function getLifecycleAction(draftId: string): Promise<LifecycleActionResult> {
  return withSession(token => getLifecycle({ token, draftId }));
}
/** One explicit intent. A stale result requests a view reload, never a repeated write. */
export async function transitionLifecycleAction(input: LifecycleTransitionActionInput): Promise<LifecycleActionResult> {
  return withSession(token => transitionLifecycle({ ...input, token }));
}
