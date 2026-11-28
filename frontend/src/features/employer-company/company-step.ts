import type { Industry } from "./api/company-client";
import type { CompanyFieldErrors } from "./validation";

/**
 * «Tu empresa» (A4.5, company sign-up step 3): input and closed results of its
 * two Server Actions. Client-safe (types only plus copy shared with the form).
 */
export type CompanyStepInput = {
  /** The name given at «Tu cuenta» (session name, L20) for POST /v2/me/employer-account. */
  fullName: string;
  name: string;
  rfc: string;
  industryId: string;
  website?: string;
};

export type CompanyStepFieldErrors = CompanyFieldErrors & { fullName?: string };

export type CompanyStepLoad =
  | { kind: "ready"; industries: Industry[] }
  /** A recruiter who already belongs to a company (own or invited): nothing to create. */
  | { kind: "done" }
  | { kind: "candidate_account" | "unauthenticated" | "unavailable" };

export type CompanyStepResult =
  | { kind: "created" }
  | { kind: "invalid"; fields: CompanyStepFieldErrors; message?: string }
  | { kind: "unauthenticated" | "candidate_account" | "email_in_use" | "email_not_verified" | "industry_unavailable" | "forbidden" | "unavailable" };

/** Same rule and copy as the account name everywhere else (features/identity/onboarding.tsx). */
export const FULL_NAME_ERROR = "Escribe un nombre de 2 a 120 caracteres.";
/** Invented (A4.5): POST /companies 409 already_exists when this account has no company → the RFC is taken. */
export const RFC_TAKEN_ERROR = "Ese RFC ya está registrado.";
