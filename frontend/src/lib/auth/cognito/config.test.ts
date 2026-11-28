import { describe, expect, it } from "vitest";
import { COGNITO_IDP_ENDPOINT_KEY, cognitoConfigFromEnv, resolveCognitoEndpoint } from "./config";

const ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE";

const AUTH_ENV = {
  NEXTAUTH_URL: "https://vacantes.example.com",
  NEXTAUTH_SECRET: "test-nextauth-secret",
  COGNITO_CLIENT_ID: "1example23456789app",
  COGNITO_CLIENT_SECRET: "example-client-secret-value",
  COGNITO_ISSUER: ISSUER,
  COGNITO_DOMAIN: "https://auth.example.com",
};

describe("resolveCognitoEndpoint (regional endpoint from the issuer)", () => {
  it("derives https://cognito-idp.<region>.amazonaws.com/ from the user pool issuer", () => {
    expect(resolveCognitoEndpoint(ISSUER, {})).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    expect(
      resolveCognitoEndpoint("https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_Ab12", {}),
    ).toBe("https://cognito-idp.ap-southeast-2.amazonaws.com/");
  });

  it.each([
    ["a non-Cognito host", "https://login.example.com/us-east-1_EXAMPLE"],
    ["a look-alike host", "https://cognito-idp.us-east-1.amazonaws.com.evil.test/us-east-1_EXAMPLE"],
    ["a malformed region", "https://cognito-idp.useast1.amazonaws.com/useast1_EXAMPLE"],
    ["a pool from another region", "https://cognito-idp.us-east-1.amazonaws.com/eu-west-1_EXAMPLE"],
    ["plain http", "http://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE"],
  ])("rejects %s with a static message naming only the key", (_label, issuer) => {
    expect(() => resolveCognitoEndpoint(issuer, {})).toThrowError(/^COGNITO_ISSUER: /);
    try {
      resolveCognitoEndpoint(issuer, {});
    } catch (error) {
      expect(String(error)).not.toContain(issuer);
    }
  });
});

describe(`resolveCognitoEndpoint (${COGNITO_IDP_ENDPOINT_KEY} override)`, () => {
  it.each([
    ["NODE_ENV=test", { NODE_ENV: "test" }],
    ["PEOPLEFLOW_LOCAL_PREVIEW=true", { NODE_ENV: "production", PEOPLEFLOW_LOCAL_PREVIEW: "true" }],
  ])("accepts a loopback endpoint with %s", (_label, mode) => {
    for (const [raw, expected] of [
      ["http://127.0.0.1:4599", "http://127.0.0.1:4599/"],
      ["http://127.0.0.1:4599/", "http://127.0.0.1:4599/"],
      ["http://127.8.9.10:4599", "http://127.8.9.10:4599/"],
      ["http://localhost:4599", "http://localhost:4599/"],
      ["https://[::1]:4599", "https://[::1]:4599/"],
    ]) {
      expect(resolveCognitoEndpoint(ISSUER, { ...mode, [COGNITO_IDP_ENDPOINT_KEY]: raw })).toBe(expected);
    }
  });

  it("does not need a Cognito issuer when the override is accepted (e2e issuer)", () => {
    expect(
      resolveCognitoEndpoint("https://e2e.peopleflow.test/identity", {
        NODE_ENV: "test",
        [COGNITO_IDP_ENDPOINT_KEY]: "http://127.0.0.1:4599",
      }),
    ).toBe("http://127.0.0.1:4599/");
  });

  it.each([
    ["production without local preview", { NODE_ENV: "production" }],
    ["development", { NODE_ENV: "development" }],
    ["unset NODE_ENV", {}],
    ["production with local preview false", { NODE_ENV: "production", PEOPLEFLOW_LOCAL_PREVIEW: "false" }],
  ])("refuses the override in %s", (_label, mode) => {
    const env = { ...mode, [COGNITO_IDP_ENDPOINT_KEY]: "http://127.0.0.1:4599" };
    expect(() => resolveCognitoEndpoint(ISSUER, env)).toThrowError(new RegExp(`^${COGNITO_IDP_ENDPOINT_KEY}: `));
  });

  it.each([
    "http://cognito.example.com:4599",
    "http://10.0.0.5:4599",
    "http://127.0.0.1.nip.io:4599",
    "http://user:pass@127.0.0.1:4599",
    "http://127.0.0.1:4599/path",
    "http://127.0.0.1:4599/?x=1",
    "http://127.0.0.1:4599/#frag",
    "ftp://127.0.0.1:4599",
    "not a url",
  ])("refuses the non-loopback or non-bare endpoint %s without echoing it", (raw) => {
    const env = { NODE_ENV: "test", [COGNITO_IDP_ENDPOINT_KEY]: raw };
    expect(() => resolveCognitoEndpoint(ISSUER, env)).toThrowError(new RegExp(`^${COGNITO_IDP_ENDPOINT_KEY}: `));
    try {
      resolveCognitoEndpoint(ISSUER, env);
    } catch (error) {
      expect(String(error)).not.toContain(raw);
    }
  });

  it("treats an empty override as unset", () => {
    expect(resolveCognitoEndpoint(ISSUER, { NODE_ENV: "production", [COGNITO_IDP_ENDPOINT_KEY]: "" })).toBe(
      "https://cognito-idp.us-east-1.amazonaws.com/",
    );
  });

  it("rejects an invalid PEOPLEFLOW_LOCAL_PREVIEW value", () => {
    expect(() =>
      resolveCognitoEndpoint(ISSUER, {
        PEOPLEFLOW_LOCAL_PREVIEW: "yes",
        [COGNITO_IDP_ENDPOINT_KEY]: "http://127.0.0.1:4599",
      }),
    ).toThrowError(/^PEOPLEFLOW_LOCAL_PREVIEW: /);
  });
});

describe("cognitoConfigFromEnv", () => {
  it("reads client id and secret from the validated auth env and derives the endpoint", () => {
    expect(cognitoConfigFromEnv(AUTH_ENV)).toEqual({
      endpoint: "https://cognito-idp.us-east-1.amazonaws.com/",
      clientId: "1example23456789app",
      clientSecret: "example-client-secret-value",
    });
  });

  it("fails on a missing client secret, naming only the key", () => {
    const env = { ...AUTH_ENV, COGNITO_CLIENT_SECRET: "" };
    expect(() => cognitoConfigFromEnv(env)).toThrowError(/^COGNITO_CLIENT_SECRET: /);
  });
});
