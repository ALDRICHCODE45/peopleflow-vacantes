// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_PROVIDER_PARAM, SOCIAL_ENV_KEYS, getSocialProviders, socialProvidersFromEnv } from "./social";

describe("social provider flags", () => {
  it("names the per-provider flags and configurable Cognito IdP names", () => {
    expect(SOCIAL_ENV_KEYS).toEqual({
      google: { flag: "AUTH_SOCIAL_GOOGLE", identityProvider: "AUTH_SOCIAL_GOOGLE_IDP" },
      microsoft: { flag: "AUTH_SOCIAL_MICROSOFT", identityProvider: "AUTH_SOCIAL_MICROSOFT_IDP" },
      linkedin: { flag: "AUTH_SOCIAL_LINKEDIN", identityProvider: "AUTH_SOCIAL_LINKEDIN_IDP" },
    });
    expect(IDENTITY_PROVIDER_PARAM).toBe("identity_provider");
  });

  it("hides every provider when no flag is set", () => {
    expect(socialProvidersFromEnv({})).toEqual([]);
  });

  it.each(["off", "", "  "])("hides a provider whose flag is %j", (value) => {
    expect(socialProvidersFromEnv({ AUTH_SOCIAL_GOOGLE: value })).toEqual([]);
  });

  it("exposes only the enabled providers, in a fixed order, with the default IdP names", () => {
    expect(socialProvidersFromEnv({ AUTH_SOCIAL_LINKEDIN: "on", AUTH_SOCIAL_GOOGLE: "on", AUTH_SOCIAL_MICROSOFT: "off" })).toEqual([
      { id: "google", identityProvider: "Google" },
      { id: "linkedin", identityProvider: "LinkedIn" },
    ]);
    expect(socialProvidersFromEnv({ AUTH_SOCIAL_MICROSOFT: " on " })).toEqual([{ id: "microsoft", identityProvider: "Microsoft" }]);
  });

  it("uses the configured Cognito IdP name and carries no secret", () => {
    const providers = socialProvidersFromEnv({
      AUTH_SOCIAL_MICROSOFT: "on",
      AUTH_SOCIAL_MICROSOFT_IDP: "AzureAD-PeopleFlow",
      COGNITO_CLIENT_SECRET: "never-exposed",
      NEXTAUTH_SECRET: "never-exposed-either",
    });
    expect(providers).toEqual([{ id: "microsoft", identityProvider: "AzureAD-PeopleFlow" }]);
    expect(JSON.stringify(providers)).not.toContain("never-exposed");
  });

  it.each(["true", "1", "ON", "yes"])("refuses an ambiguous flag value %j, naming the key only", (value) => {
    expect(() => socialProvidersFromEnv({ AUTH_SOCIAL_GOOGLE: value })).toThrow(/^AUTH_SOCIAL_GOOGLE: must be on or off$/);
  });

  it.each(["Goo gle", "a".repeat(33), "Google?x=1", "<script>", "Google&prompt=none"])(
    "refuses an invalid IdP name %j, naming the key only",
    (value) => {
      expect(() => socialProvidersFromEnv({ AUTH_SOCIAL_GOOGLE: "on", AUTH_SOCIAL_GOOGLE_IDP: value })).toThrow(
        /^AUTH_SOCIAL_GOOGLE_IDP: must be a Cognito identity provider name/,
      );
    },
  );

  it("refuses two providers mapped to the same IdP name", () => {
    expect(() =>
      socialProvidersFromEnv({ AUTH_SOCIAL_GOOGLE: "on", AUTH_SOCIAL_LINKEDIN: "on", AUTH_SOCIAL_LINKEDIN_IDP: "Google" }),
    ).toThrow(/^AUTH_SOCIAL_LINKEDIN_IDP: duplicates another provider$/);
  });
});

describe("getSocialProviders (server helper for the screens)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the server environment", () => {
    vi.stubEnv("AUTH_SOCIAL_GOOGLE", "on");
    vi.stubEnv("AUTH_SOCIAL_MICROSOFT", "off");
    vi.stubEnv("AUTH_SOCIAL_LINKEDIN", "");
    expect(getSocialProviders()).toEqual([{ id: "google", identityProvider: "Google" }]);
  });
});
