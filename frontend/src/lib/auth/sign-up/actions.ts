"use server";

import { headers } from "next/headers";
import { sharedCognitoClient } from "../cognito-shared";
import { clientIpFrom, createAuthAttemptLimiter } from "../rate-limit";
import type { ConfirmSignUpActionResult, ResendCodeActionResult, SignUpActionResult } from "./contract";
import { createSignUpOperations } from "./operations";

/*
 * Server Actions for «Crea tu perfil» and «Verifica tu correo» (A4.4).
 *
 * CSRF: Next (15.x) accepts a Server Action POST only when its Origin header
 * matches the Host / X-Forwarded-Host; next.config sets no
 * `serverActions.allowedOrigins`, so only same-origin pages can call these.
 * The limiter is in-memory per instance, like the password callback's
 * (rate-limit.ts: shared store / WAF in the AWS phase). The client address is
 * derived exactly as the route guard does (`clientIpFrom`); without one, only
 * the per-email budget applies.
 */

const operations = createSignUpOperations({ cognito: sharedCognitoClient, limiter: createAuthAttemptLimiter() });
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

async function clientIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}

export async function signUpAction(input: unknown): Promise<SignUpActionResult> {
  try {
    return await operations.signUp(input, await clientIp());
  } catch {
    return UNAVAILABLE;
  }
}

export async function confirmSignUpAction(input: unknown): Promise<ConfirmSignUpActionResult> {
  try {
    return await operations.confirmSignUp(input, await clientIp());
  } catch {
    return UNAVAILABLE;
  }
}

export async function resendCodeAction(input: unknown): Promise<ResendCodeActionResult> {
  try {
    return await operations.resendCode(input, await clientIp());
  } catch {
    return UNAVAILABLE;
  }
}
