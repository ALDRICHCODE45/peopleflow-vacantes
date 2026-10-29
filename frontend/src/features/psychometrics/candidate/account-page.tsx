import "server-only";
import { getActionAccessToken } from "@/lib/auth/action-session";
import * as client from "../client";
import type { Result } from "../model";
import type { AssessmentData } from "./page";
import { AssessmentFlow } from "./assessment-flow";

/** Resolve the current session on every invocation, never capture a session bearer. */
async function authenticated<T>(invitationId: string, call: (input: client.CandidateInput) => Promise<Result<T>>): Promise<Result<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token) return { ok: false, reason: "unauthenticated", reference: {} };
    const result = await call({ access: "account", token, invitationId });
    return !result.ok && result.reason === "not_found" ? { ...result, reason: "assessment_unavailable" } : result;
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
async function load(invitationId: string): Promise<Result<AssessmentData>> {
  return authenticated<AssessmentData>(invitationId, async input => {
    const base = await client.getAssessment(input);
    if (!base.ok) return base;
    if (base.data.consent || ["finished", "expired", "revoked"].includes(base.data.status)) return { ok: true, data: { base: base.data, items: null } };
    const items = await client.getItems(input);
    return items.ok ? { ok: true, data: { base: base.data, items: items.data } } : items;
  });
}
export async function AccountAssessmentPage({ invitationId }: { invitationId: string }) {
  async function reloadAction() { "use server"; return load(invitationId); }
  async function consentAction(body: unknown) { "use server"; return authenticated(invitationId, input => client.giveConsent({ ...input, body })); }
  async function answerAction(position: number, body: unknown) { "use server"; return authenticated(invitationId, input => client.putAnswer({ ...input, position, body })); }
  async function clearAction(position: number, body: unknown) { "use server"; return authenticated(invitationId, input => client.deleteAnswer({ ...input, position, body })); }
  async function finishAction() { "use server"; return authenticated(invitationId, client.finishAssessment); }
  return <AssessmentFlow account initial={await load(invitationId)} actions={{ reloadAction, consentAction, answerAction, clearAction, finishAction }} />;
}
