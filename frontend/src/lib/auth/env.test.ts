import { describe, expect, it } from "vitest";
import { validateAuthEnv } from "./env";

const LOCAL_URL = "http://localhost:3000";
const PROD_URL = "https://peopleflow.mx";
const ISSUER =
  "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Dmb1XsIw9";
const DOMAIN =
  "https://us-east-1dmb1xsiw9.auth.us-east-1.amazoncognito.com";

const base = (overrides: Record<string, unknown> = {}) => ({
  NODE_ENV: "development",
  NEXTAUTH_URL: LOCAL_URL,
  NEXTAUTH_SECRET: "server-only-secret-value",
  COGNITO_CLIENT_ID: "18a05uprp34uosfg1ov6lvvkbu",
  COGNITO_CLIENT_SECRET: "cognito-client-secret-value",
  COGNITO_ISSUER: ISSUER,
  COGNITO_DOMAIN: DOMAIN,
  ...overrides,
});

const throws = (overrides: Record<string, unknown>, key: string) =>
  expect(() => validateAuthEnv(base(overrides))).toThrow(key);

describe("auth environment validation", () => {
  it("normalizes the employer login URL and derives the token endpoint from the configured hosted domain", () => {
    expect(validateAuthEnv(base())).toEqual({
      siteUrl: LOCAL_URL,
      secret: "server-only-secret-value",
      clientId: "18a05uprp34uosfg1ov6lvvkbu",
      clientSecret: "cognito-client-secret-value",
      issuer: ISSUER,
      domain: DOMAIN,
      tokenEndpoint: `${DOMAIN}/oauth2/token`,
      employerLoginUrl: `${LOCAL_URL}/empresa/login`,
    });
  });

  it("accepts local loopback HTTP only outside production and requires HTTPS for remote origins", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(validateAuthEnv(base({ NEXTAUTH_URL: `http://${host}:3000` })).siteUrl)
        .toBe(`http://${host}:3000`);
    }
    throws({ NEXTAUTH_URL: "http://example.com" }, "NEXTAUTH_URL");
    throws({ NODE_ENV: "production", NEXTAUTH_URL: LOCAL_URL }, "NEXTAUTH_URL");
    expect(
      validateAuthEnv(base({ NODE_ENV: "production", NEXTAUTH_URL: PROD_URL })).siteUrl,
    ).toBe(PROD_URL);
  });

  it("allows loopback HTTP in a production build only under PEOPLEFLOW_LOCAL_PREVIEW=true", () => {
    const preview = { NODE_ENV: "production", PEOPLEFLOW_LOCAL_PREVIEW: "true" };
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(validateAuthEnv(base({ ...preview, NEXTAUTH_URL: `http://${host}:3100` })).siteUrl)
        .toBe(`http://${host}:3100`);
    }
    // The preview never reaches a public host, not even over https.
    throws({ ...preview, NEXTAUTH_URL: "http://example.com" }, "NEXTAUTH_URL");
    throws({ ...preview, NEXTAUTH_URL: PROD_URL }, "NEXTAUTH_URL");
    // The Cognito hosted domain stays https-only.
    throws({ ...preview, COGNITO_DOMAIN: "http://localhost:9229" }, "COGNITO_DOMAIN");
    // Without the flag (or with false) production keeps requiring https.
    throws({ NODE_ENV: "production", PEOPLEFLOW_LOCAL_PREVIEW: "false", NEXTAUTH_URL: LOCAL_URL }, "NEXTAUTH_URL");
    throws({ NODE_ENV: "production", PEOPLEFLOW_LOCAL_PREVIEW: "yes", NEXTAUTH_URL: LOCAL_URL }, "PEOPLEFLOW_LOCAL_PREVIEW");
  });

  it("rejects NEXTAUTH_URL values that are not an exact credential-free origin", () => {
    for (const value of [
      undefined,
      "not-a-url",
      "/relative",
      "http://user:pass@localhost:3000",
      "http://localhost:3000/empresa",
      "http://localhost:3000/?x=1",
      "http://localhost:3000/#fragment",
      "ftp://localhost:3000",
    ]) {
      throws({ NEXTAUTH_URL: value }, "NEXTAUTH_URL");
    }
  });

  it("requires every server secret and identifier, never falling back to a default", () => {
    for (const key of [
      "NEXTAUTH_SECRET",
      "COGNITO_CLIENT_ID",
      "COGNITO_CLIENT_SECRET",
      "COGNITO_ISSUER",
      "COGNITO_DOMAIN",
    ]) {
      throws({ [key]: undefined }, key);
      throws({ [key]: "" }, key);
      throws({ [key]: "   " }, key);
    }
  });

  it("requires an HTTPS pool issuer and an HTTPS hosted domain without path or query", () => {
    throws({ COGNITO_ISSUER: "http://cognito-idp.us-east-1.amazonaws.com/pool" }, "COGNITO_ISSUER");
    throws({ COGNITO_ISSUER: `${ISSUER}/extra` }, "COGNITO_ISSUER");
    throws({ COGNITO_ISSUER: `${ISSUER}?x=1` }, "COGNITO_ISSUER");
    throws({ COGNITO_DOMAIN: "http://localhost:3000" }, "COGNITO_DOMAIN");
    throws({ COGNITO_DOMAIN: `${DOMAIN}/oauth2` }, "COGNITO_DOMAIN");
    throws({ COGNITO_DOMAIN: `${DOMAIN}/?x=1` }, "COGNITO_DOMAIN");
  });
});
