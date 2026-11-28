// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_PROVIDER_PARAM, SOCIAL_CONFIG_ERROR_PREFIX, SOCIAL_ENV_KEYS, getSocialProviders, resolveSocialProviders, socialProvidersFromEnv } from "./social";

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

describe("resolveSocialProviders (lazy, never throws)", () => {
  it("returns the enabled providers when the config is valid, without logging", () => {
    const log = vi.fn();
    expect(resolveSocialProviders({ AUTH_SOCIAL_LINKEDIN: "on" }, log, new Set())).toEqual([{ id: "linkedin", identityProvider: "LinkedIn" }]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    [{ AUTH_SOCIAL_GOOGLE: "yes" }, "AUTH_SOCIAL_GOOGLE"],
    [{ AUTH_SOCIAL_MICROSOFT: "on", AUTH_SOCIAL_MICROSOFT_IDP: "bad name<x>" }, "AUTH_SOCIAL_MICROSOFT_IDP"],
    [{ AUTH_SOCIAL_GOOGLE: "on", AUTH_SOCIAL_LINKEDIN: "on", AUTH_SOCIAL_LINKEDIN_IDP: "Google" }, "AUTH_SOCIAL_LINKEDIN_IDP"],
  ])("disables every social provider on an invalid value and leaves one operator line naming only the key: %j", (env, key) => {
    const log = vi.fn();
    expect(resolveSocialProviders(env, log, new Set())).toEqual([]);
    expect(log).toHaveBeenCalledExactlyOnceWith(`${SOCIAL_CONFIG_ERROR_PREFIX} key=${key}`);
    const line = String(log.mock.calls[0]?.[0]);
    for (const value of Object.values(env)) if (value !== "on") expect(line).not.toContain(value);
  });

  it("never lets a throwing log sink escape", () => {
    expect(resolveSocialProviders({ AUTH_SOCIAL_GOOGLE: "1" }, () => { throw new Error("sink down"); }, new Set())).toEqual([]);
  });

  it("logs an invalid key once per process, not once per request, and each distinct key once", () => {
    const log = vi.fn();
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) expect(resolveSocialProviders({ AUTH_SOCIAL_GOOGLE: "yes" }, log, seen)).toEqual([]);
    expect(log).toHaveBeenCalledExactlyOnceWith(`${SOCIAL_CONFIG_ERROR_PREFIX} key=AUTH_SOCIAL_GOOGLE`);
    resolveSocialProviders({ AUTH_SOCIAL_MICROSOFT: "1" }, log, seen);
    resolveSocialProviders({ AUTH_SOCIAL_MICROSOFT: "1" }, log, seen);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("dedupes through a process-wide set by default", () => {
    const log = vi.fn();
    resolveSocialProviders({ AUTH_SOCIAL_LINKEDIN_IDP: "x", AUTH_SOCIAL_LINKEDIN: "maybe" }, log);
    resolveSocialProviders({ AUTH_SOCIAL_LINKEDIN: "maybe" }, log);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
