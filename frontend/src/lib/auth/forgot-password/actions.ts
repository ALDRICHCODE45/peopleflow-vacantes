"use server";

import { headers } from "next/headers";
import { sharedCognitoClient } from "../cognito-shared";
import { clientIpFrom, createAuthAttemptLimiter } from "../rate-limit";
import type { ConfirmForgotPasswordActionResult, ForgotPasswordActionResult } from "./contract";
import { createForgotPasswordOperations } from "./operations";

/*
 * Server Actions for «¿Olvidaste tu contraseña?» (A4.6): request a code, then
 * the code and the new password.
 *
 * CSRF: Next (15.x) accepts a Server Action POST only when its Origin header
 * matches the Host / X-Forwarded-Host; next.config sets no
 * `serverActions.allowedOrigins`, so only same-origin pages can call these.
 * The limiter is in-memory per instance, like the sign-up actions' and the
 * password callback's (rate-limit.ts: shared store / WAF in the AWS phase). The
 * client address is derived exactly as the route guard does (`clientIpFrom`);
 * without one, only the per-email budget applies.
 */

const operations = createForgotPasswordOperations({ cognito: sharedCognitoClient, limiter: createAuthAttemptLimiter() });
const UNAVAILABLE = { ok: false, reason: "unavailable" } as const;

async function clientIp(): Promise<string | null> {
  return clientIpFrom(await headers());
}

export async function forgotPasswordAction(input: unknown): Promise<ForgotPasswordActionResult> {
  try {
    return await operations.forgotPassword(input, await clientIp());
  } catch {
    return UNAVAILABLE;
  }
}

export async function confirmForgotPasswordAction(input: unknown): Promise<ConfirmForgotPasswordActionResult> {
  try {
    return await operations.confirmForgotPassword(input, await clientIp());
  } catch {
    return UNAVAILABLE;
  }
}
