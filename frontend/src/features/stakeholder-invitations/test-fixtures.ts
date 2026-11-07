import type { CreatedInvitation, PendingInvitation } from "./model";

export const ownerUserId = "10000000-0000-4000-8000-000000000001";
export const invitationId = "80000000-0000-4000-8000-000000000001";
export const secondInvitationId = "80000000-0000-4000-8000-000000000002";
export const companyId = "30000000-0000-4000-8000-000000000001";
export const memberId = "20000000-0000-4000-8000-000000000009";
/** 32 random bytes in base64url, no padding: the shape the contract (§1.3) promises for `url_token`. */
export const urlToken = "q3Jv8tR0wXbN5eLk2sYp9uHf7aCd1gMz4iOq6TnVrWo";

/** 201 of `POST /v2/me/company/stakeholder-invitations` (the only response that carries the token). */
export function createdInvitation(overrides: Partial<CreatedInvitation> = {}): CreatedInvitation {
  return { id: invitationId, url_token: urlToken, expires_at: "2026-11-14T16:42:00Z", created_at: "2026-11-07T16:42:00Z", ...overrides };
}

/** Item of `GET /v2/me/company/stakeholder-invitations`: no token, `created_by` is the owner's user id (280d75bf). */
export function pendingInvitation(overrides: Partial<PendingInvitation> = {}): PendingInvitation {
  return { id: invitationId, created_at: "2026-11-05T15:14:00Z", created_by: ownerUserId, expires_at: "2026-11-12T15:14:00Z", ...overrides };
}

/** 200 of `POST /v2/me/stakeholder-invitations/accept`, for the first accept and the same-user replay alike. */
export const acceptBody = { company_id: companyId, member_id: memberId, role: "stakeholder" as const };
