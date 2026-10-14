import CognitoProvider from "next-auth/providers/cognito";
import type { CognitoProfile } from "next-auth/providers/cognito";
import type { OAuthConfig } from "next-auth/providers/oauth";
import type { AuthEnv } from "./env";

export const COGNITO_AUTH_CHECKS = ["pkce", "state"] as const;
export const COGNITO_SCOPES = "openid email";

export type CognitoProviderConfig = Pick<
  AuthEnv,
  "clientId" | "clientSecret" | "issuer"
>;

/**
 * Configures the stable NextAuth v4 Cognito provider. Authorization code flow
 * with PKCE and state is delegated to the library; both checks are validated
 * against the signed cookies NextAuth issues during the sign-in request.
 */
export function buildCognitoProvider(
  config: CognitoProviderConfig,
): OAuthConfig<CognitoProfile> {
  return CognitoProvider({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    issuer: config.issuer,
    checks: [...COGNITO_AUTH_CHECKS],
    authorization: { params: { scope: COGNITO_SCOPES } },
  });
}
