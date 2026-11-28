import "server-only";
import { createHmac } from "node:crypto";

/**
 * Cognito SECRET_HASH for a confidential app client:
 * Base64(HMAC_SHA256(clientSecret, username + clientId)).
 *
 * The username is the one the operation names: the email for sign-in, sign-up,
 * codes and password reset; the user's `sub` for REFRESH_TOKEN_AUTH (L9).
 */
export function computeSecretHash(username: string, clientId: string, clientSecret: string): string {
  return createHmac("sha256", clientSecret).update(username + clientId, "utf8").digest("base64");
}
