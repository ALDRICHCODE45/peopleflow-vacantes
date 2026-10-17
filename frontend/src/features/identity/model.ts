export type IdentityUser = { id: string; email: string; full_name: string };
export type Identity = { role: "candidate" | "recruiter"; user: IdentityUser } | { role: null; user: null };
export type IdentityReason = "unauthenticated" | "account_exists" | "email_in_use" | "email_not_verified" | "validation_error" | "identity_unavailable" | "no_response" | "server_error" | "unrecognized_response";
export type IdentityFailure = { ok: false; reason: IdentityReason; reference: { status?: number; code?: string } };
export type IdentityResult = { ok: true; data: Identity } | IdentityFailure;

export function normalizedName(value: string): string {
  return value.normalize("NFC").trim().replace(/\p{White_Space}+/gu, " ");
}
export function validName(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 2 && length <= 120 && !/\p{Cc}/u.test(value);
}
