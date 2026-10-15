import CognitoProvider from "next-auth/providers/cognito";
import type { CognitoProfile } from "next-auth/providers/cognito";
import type { OAuthConfig } from "next-auth/providers/oauth";
import type { AuthEnv } from "./env";

export const COGNITO_AUTH_CHECKS = ["pkce", "state"] as const;
export const COGNITO_SCOPES = "openid email profile";

export type CognitoProviderConfig = Pick<
  AuthEnv,
  "clientId" | "clientSecret" | "issuer"
>;

/**
 * Configures the stable NextAuth v4 Cognito provider. Authorization code flow
 * with PKCE and state is delegated to the library; both checks are validated
 * against the signed cookies NextAuth issues during the sign-in request.
 *
 * `profile` is requested so the provider may expose readable profile attributes
 * once the App Client scopes allow them. Requesting the scope does not create or
 * change AWS configuration, and it is not a claim that name/profile attributes
 * are actually readable from this client.
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
