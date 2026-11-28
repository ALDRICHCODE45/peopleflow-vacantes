import { describe, expect, it } from "vitest";
import { COGNITO_AUTH_CHECKS, COGNITO_HTTP_TIMEOUT_MS, COGNITO_SCOPES, buildCognitoProvider } from "./provider";

const config = {
  clientId: "18a05uprp34uosfg1ov6lvvkbu",
  clientSecret: "cognito-client-secret-value",
  issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Dmb1XsIw9",
};

// NextAuth merges the provider defaults with the `options` we pass in, so the
// effective provider is the shallow merge of both shapes.
const effectiveProvider = () => {
  const provider = buildCognitoProvider(config);
  return { ...provider, ...(provider.options ?? {}) };
};

describe("buildCognitoProvider", () => {
  it("configures the stable Cognito provider with code flow and library-managed PKCE and state", () => {
    const provider = buildCognitoProvider(config);
    expect(provider.id).toBe("cognito");
    expect(provider.type).toBe("oauth");
    expect(effectiveProvider().clientId).toBe(config.clientId);
    expect(effectiveProvider().clientSecret).toBe(config.clientSecret);
    expect(effectiveProvider().issuer).toBe(config.issuer);
    expect(COGNITO_AUTH_CHECKS).toEqual(["pkce", "state"]);
    expect(effectiveProvider().checks).toEqual(["pkce", "state"]);
  });

  it("requests the OIDC scopes plus aws.cognito.signin.user.admin so the backend GetUser accepts social tokens (L8)", () => {
    expect(COGNITO_SCOPES).toBe("openid email profile aws.cognito.signin.user.admin");
    expect(effectiveProvider().authorization).toMatchObject({
      params: { scope: "openid email profile aws.cognito.signin.user.admin" },
    });
  });

  it("fixes no identity_provider itself: the social button supplies it per sign-in", () => {
    const params = (effectiveProvider().authorization as { params: Record<string, unknown> }).params;
    expect(params).not.toHaveProperty("identity_provider");
  });

  it("gives the code exchange with Cognito 10 seconds instead of the library's 3.5", () => {
    // The 3500 ms openid-client default timed out the token request in local runs,
    // sending a successful Cognito sign-in back to the login with error=OAuthCallback.
    expect(COGNITO_HTTP_TIMEOUT_MS).toBe(10_000);
    expect(effectiveProvider().httpOptions).toEqual({ timeout: 10_000 });
  });
});
