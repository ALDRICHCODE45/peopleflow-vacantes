"use server";
import { getActionAccessToken } from "@/lib/auth/action-session";
import * as client from "./client";
import type { Result } from "./model";
async function authenticated<T>(call: (token: string) => Promise<Result<T>>): Promise<Result<T>> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return { ok: false, reason: "unauthenticated", reference: {} };
    return await call(token);
  } catch { return { ok: false, reason: "no_response", reference: {} }; }
}
export async function loadProfileAction(vacancyId: string) { return authenticated(token => client.getProfile({ token, vacancyId })); }
/** Failed writes must be reconciled with a read, never automatically replayed. */
export async function saveProfileAction(input: Omit<client.SaveProfileInput, "token">) { return authenticated(token => client.saveProfile({ ...input, token })); }
export async function loadInvitationsAction(vacancyId: string) { return authenticated(token => client.getInvitations({ token, vacancyId })); }
export async function createInvitationAction(input: Omit<client.ParticipationTarget, "token">) { return authenticated(token => client.createInvitation({ ...input, token })); }
/** Minting revokes the previous link; callers must not retry blindly. */
export async function mintLinkAction(input: Omit<client.InvitationTarget, "token">) { return authenticated(token => client.mintLink({ ...input, token })); }
export async function remindInvitationAction(input: Omit<client.InvitationTarget, "token">) { return authenticated(token => client.remindInvitation({ ...input, token })); }
export async function revokeInvitationAction(input: Omit<client.InvitationTarget, "token">) { return authenticated(token => client.revokeInvitation({ ...input, token })); }
export async function loadResultAction(input: Omit<client.InvitationTarget, "token">) { return authenticated(token => client.getResult({ ...input, token })); }
export async function createComparisonAction(input: Omit<client.InvitationTarget, "token">) { return authenticated(token => client.createComparison({ ...input, token })); }
