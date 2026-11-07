"use server";

import { z } from "zod";
import { getActionAccessToken } from "@/lib/auth/action-session";
import { acceptInvitation, createInvitation, listInvitations, revokeInvitation, type InvitationClientFailure } from "./client";
import {
  usableInvitationToken,
  type AcceptInvitationResult, type CreateInvitationResult, type InvitationFailure, type ListInvitationsResult, type RevokeInvitationResult,
} from "./model";

const unauthenticated = { ok: false as const, reason: "unauthenticated" as const, reference: {} };
const noResponse = { ok: false as const, reason: "no_response" as const, reference: {} };
const SAFE_CODES = new Set(["unauthenticated", "forbidden", "invitation_limit_reached", "invitation_invalid", "candidate_account", "already_company_member", "invalid_request", "internal_error"]);

function reference({ error, code }: InvitationClientFailure) {
  const status = "status" in error ? error.status : undefined;
  return { ...(status === undefined ? {} : { status }), ...(code && SAFE_CODES.has(code) ? { code } : {}) };
}
/** Generic transport outcome, shared by the owner screen and the accept page. */
function unavailable(result: InvitationClientFailure): { reason: "unauthenticated" | "server_error" | "no_response" | "unrecognized_response" } {
  const status = "status" in result.error ? result.error.status : undefined;
  if (status === 401) return { reason: "unauthenticated" };
  if (status !== undefined && status >= 500 && status < 600) return { reason: "server_error" };
  if (result.error.kind === "network" || result.error.kind === "timeout") return { reason: "no_response" };
  return { reason: "unrecognized_response" };
}
function ownerFailure(result: InvitationClientFailure): InvitationFailure {
  const status = "status" in result.error ? result.error.status : undefined;
  const reason = status === 403 ? "forbidden" : status === 422 && result.code === "invitation_limit_reached" ? "limit_reached" : unavailable(result).reason;
  return { ok: false, reason, reference: reference(result) };
}

/** Owner only (§1.3); the API answers 403 to anyone else. */
export async function createStakeholderInvitationAction(): Promise<CreateInvitationResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await createInvitation(token);
    return result.ok ? { ok: true, invitation: result.data } : ownerFailure(result);
  } catch { return noResponse; }
}

export async function listStakeholderInvitationsAction(): Promise<ListInvitationsResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    const result = await listInvitations(token);
    return result.ok ? { ok: true, items: result.data } : ownerFailure(result);
  } catch { return noResponse; }
}

export async function revokeStakeholderInvitationAction(id: string): Promise<RevokeInvitationResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    if (!z.string().uuid().safeParse(id).success) return { ok: false, reason: "invalid_request", reference: {} };
    const result = await revokeInvitation(token, id);
    return result.ok ? { ok: true } : ownerFailure(result);
  } catch { return noResponse; }
}

/**
 * Any signed-in user (§1.3). Runs on the server so the token goes to the API in a POST body; it is never logged and
 * never returned. A token outside the URL-safe alphabet cannot be one the API issued, so it is invalid without a call.
 */
export async function acceptStakeholderInvitationAction(invitationToken: string): Promise<AcceptInvitationResult> {
  try {
    const token = await getActionAccessToken();
    if (!token?.trim()) return unauthenticated;
    if (!usableInvitationToken(invitationToken)) return { ok: false, reason: "invitation_invalid", reference: {} };
    const result = await acceptInvitation(token, invitationToken);
    if (result.ok) return { ok: true, companyId: result.data.company_id, memberId: result.data.member_id };
    const status = "status" in result.error ? result.error.status : undefined;
    const reason = (status === 404 && result.code === "invitation_invalid") || (status === 400 && result.code === "invalid_request") ? "invitation_invalid"
      : status === 403 && result.code === "candidate_account" ? "candidate_account"
        : status === 409 && result.code === "already_company_member" ? "already_company_member" : unavailable(result).reason;
    return { ok: false, reason, reference: reference(result) };
  } catch { return noResponse; }
}
