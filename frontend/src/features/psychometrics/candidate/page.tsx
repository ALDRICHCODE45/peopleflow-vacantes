import "server-only";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import * as client from "../client";
import type { CandidateBase, CandidateItems, Result } from "../model";
import { AssessmentFlow } from "./assessment-flow";

export const metadata: Metadata = {
  title: "Evaluación",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export type AssessmentData = { base: CandidateBase; items: CandidateItems | null };

/** No React/Next cache: every access rechecks expiry and consent on the public prefix. */
async function load(token: string): Promise<Result<AssessmentData>> {
  if (!token) return { ok: false, reason: "assessment_unavailable", reference: {} };
  const access = { access: "public" as const, assessmentToken: token };
  const base = await client.getAssessment(access);
  if (!base.ok) return base;
  if (base.data.consent || ["finished", "expired", "revoked"].includes(base.data.status)) {
    return { ok: true, data: { base: base.data, items: null } };
  }
  const items = await client.getItems(access);
  return items.ok ? { ok: true, data: { base: base.data, items: items.data } } : items;
}

/** The raw token remains server-side. Inline Server Action closures are encrypted by
 * Next; do not replace these with .bind(token) or pass the token as a client prop.
 * Only the assessment cookie is read; no account session, logging or error reflection.
 * Call this server function directly, never pass a bearer through React props. */
export async function AssessmentPage() {
  const token = (await cookies()).get("pf_assessment")?.value ?? "";
  async function reloadAction() {
    "use server";
    return load(token);
  }
  async function consentAction(body: unknown) {
    "use server";
    return client.giveConsent({ access: "public", assessmentToken: token, body });
  }
  async function answerAction(position: number, body: unknown) {
    "use server";
    return client.putAnswer({ access: "public", assessmentToken: token, position, body });
  }
  async function clearAction(position: number, body: unknown) {
    "use server";
    return client.deleteAnswer({ access: "public", assessmentToken: token, position, body });
  }
  async function finishAction() {
    "use server";
    return client.finishAssessment({ access: "public", assessmentToken: token });
  }
  return <AssessmentFlow initial={await load(token)} actions={{ reloadAction, consentAction, answerAction, clearAction, finishAction }} />;
}
