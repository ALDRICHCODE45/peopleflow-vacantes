import CognitoProvider from "next-auth/providers/cognito";
import type { CognitoProfile } from "next-auth/providers/cognito";
import type { OAuthConfig } from "next-auth/providers/oauth";
import type { AuthEnv } from "./env";

export const COGNITO_AUTH_CHECKS = ["pkce", "state"] as const;
/**
 * `aws.cognito.signin.user.admin` lets the backend's GetUser identity provider
 * accept social tokens as well as password ones (L8); it must be an allowed
 * scope on the app client.
 */
export const COGNITO_SCOPES = "openid email profile aws.cognito.signin.user.admin";
/**
 * Timeout for the server-side requests to Cognito (token exchange, JWKS). The
 * openid-client default of 3500 ms timed out locally and sent a successful
 * sign-in back to the login page with `error=OAuthCallback`.
 */
export const COGNITO_HTTP_TIMEOUT_MS = 10_000;

export type CognitoProviderConfig = Pick<
  AuthEnv,
  "clientId" | "clientSecret" | "issuer"
>;

/**
 * Configures the stable NextAuth v4 Cognito provider. Authorization code flow
 * with PKCE and state is delegated to the library; both checks are validated
 * against the signed cookies NextAuth issues during the sign-in request.
 *
 * Social sign-in (S3) uses this same provider: the button passes
 * `identity_provider` as a sign-in authorization param, so Cognito forwards the
 * browser straight to that provider's consent screen without showing a hosted
 * page; the route guard admits only enabled provider names (social.ts).
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
    httpOptions: { timeout: COGNITO_HTTP_TIMEOUT_MS },
  });
}
