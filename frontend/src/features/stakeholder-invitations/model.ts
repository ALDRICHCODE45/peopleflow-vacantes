import { z } from "zod";

/**
 * Stakeholder invitations (contract stakeholder-metrics-v1 §1.3): a copyable, single-use link that lasts 7 days.
 * The API stores only a hash of `url_token`, so the link exists once, in the create response.
 */
export const MAX_PENDING_INVITATIONS = 20;
export const INVITATION_PATH = "/empresa/invitacion";
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const TOKEN = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 256;

export const createdInvitationSchema = z.object({ id: uuid, url_token: z.string().min(16).max(MAX_TOKEN_LENGTH).regex(TOKEN), expires_at: instant, created_at: instant }).strict();
// `created_by` is the owner's user id (backend 280d75bf); the name comes from the members list.
export const pendingInvitationSchema = z.object({ id: uuid, created_at: instant, created_by: uuid, expires_at: instant }).strict();
export const pendingListSchema = z.object({ items: z.array(pendingInvitationSchema) }).strict();
export const acceptedSchema = z.object({ company_id: uuid, member_id: uuid, role: z.literal("stakeholder") }).strict();
export const errorEnvelopeSchema = z.object({ error: z.string(), code: z.string() }).passthrough();

export type CreatedInvitation = z.infer<typeof createdInvitationSchema>;
export type PendingInvitation = z.infer<typeof pendingInvitationSchema>;
export type Accepted = z.infer<typeof acceptedSchema>;

type Reference = { status?: number; code?: string };
export type InvitationFailure = {
  ok: false;
  reason: "unauthenticated" | "forbidden" | "limit_reached" | "invalid_request" | "server_error" | "no_response" | "unrecognized_response";
  reference: Reference;
};
export type CreateInvitationResult = { ok: true; invitation: CreatedInvitation } | InvitationFailure;
export type ListInvitationsResult = { ok: true; items: PendingInvitation[] } | InvitationFailure;
export type RevokeInvitationResult = { ok: true } | InvitationFailure;
/** One code for unknown, expired, revoked or used-by-someone-else tokens: the page never tells them apart. */
export type AcceptFailureReason = "invitation_invalid" | "candidate_account" | "already_company_member" | "unauthenticated" | "server_error" | "no_response" | "unrecognized_response";
export type AcceptInvitationResult = { ok: true; companyId: string; memberId: string } | { ok: false; reason: AcceptFailureReason; reference: Reference };

/** Token-free outcomes the accept page redirects to (`/empresa/invitacion?estado=…`). */
export const ACCEPT_OUTCOMES = ["unido", "invalida", "cuenta-candidato", "ya-miembro", "cuenta-no-lista"] as const;
export type AcceptOutcome = (typeof ACCEPT_OUTCOMES)[number];
export const outcomeFor = (result: AcceptInvitationResult): AcceptOutcome | null => result.ok ? "unido"
  : result.reason === "invitation_invalid" ? "invalida" : result.reason === "candidate_account" ? "cuenta-candidato"
    : result.reason === "already_company_member" ? "ya-miembro"
      // The API answered 401 to a signed-in session: its user does not exist yet, so signing in again would loop.
      // Without a status the action found no session token, which the sign-in card handles.
      : result.reason === "unauthenticated" && result.reference.status === 401 ? "cuenta-no-lista" : null;
export const parseOutcome = (value: string | null | undefined): AcceptOutcome | null =>
  (ACCEPT_OUTCOMES as readonly string[]).includes(value ?? "") ? value as AcceptOutcome : null;

export function invitationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/u, "")}${INVITATION_PATH}/${token}`;
}

export function creatorName(userId: string, members: readonly { user: { id: string; full_name: string } | null }[]): string {
  return members.find(member => member.user?.id === userId)?.user?.full_name || "Ex miembro";
}

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
const calendarDay = (date: Date) => Date.parse(`${dayFormat.format(date)}T00:00:00Z`);
/** Calendar days between today and the expiry, both in America/Mexico_City (contract time zone). */
export function daysUntil(instantValue: string, now: Date = new Date()): number {
  return Math.round((calendarDay(new Date(instantValue)) - calendarDay(now)) / 86_400_000);
}
