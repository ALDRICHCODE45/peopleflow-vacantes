import { describe, expect, it } from "vitest";
import type { AuthEnv } from "./env";
import {
  buildCognitoLogoutUrl,
  buildEmployerLoginUrl,
  cookieClearOptions,
} from "./logout";

const config: AuthEnv = {
  siteUrl: "http://localhost:3000",
  secret: "server-only-secret-value",
  clientId: "18a05uprp34uosfg1ov6lvvkbu",
  clientSecret: "cognito-client-secret-value",
  issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Dmb1XsIw9",
  domain: "https://us-east-1dmb1xsiw9.auth.us-east-1.amazoncognito.com",
  tokenEndpoint:
    "https://us-east-1dmb1xsiw9.auth.us-east-1.amazoncognito.com/oauth2/token",
  employerLoginUrl: "http://localhost:3000/empresa/login",
};

describe("employer logout destination", () => {
  it("builds the Cognito managed-logout URL from validated configuration only", () => {
    const url = new URL(buildCognitoLogoutUrl(config));
    expect(url.origin).toBe(config.domain);
    expect(url.pathname).toBe("/logout");
    expect(url.searchParams.get("client_id")).toBe(config.clientId);
    expect(url.searchParams.get("logout_uri")).toBe(
      "http://localhost:3000/empresa/login",
    );
  });

  it("derives the employer return URL from the validated site origin, not from request input", () => {
    expect(buildEmployerLoginUrl(config)).toBe(
      "http://localhost:3000/empresa/login",
    );
    expect(buildCognitoLogoutUrl(config)).not.toContain("//evil.example.com");
  });

  it.each(["candidato", undefined, "https://evil.example", "//evil.example", "/candidato/login", "/empresa/dashboard", "CANDIDATO", "candidato?next=https://evil.example"])("strictly allowlists logout destination %s", (to) => {
    const url = new URL(buildCognitoLogoutUrl(config, to));
    expect(url.searchParams.get("logout_uri")).toBe(`http://localhost:3000/${to === "candidato" ? "candidato" : "empresa"}/login`);
    expect(url.origin).toBe(config.domain);
  });

  it("clears prefixed cookies with secure attributes and plain cookies without them", () => {
    expect(cookieClearOptions("next-auth.session-token")).toEqual({
      maxAge: 0,
      path: "/",
    });
    expect(cookieClearOptions("__Secure-next-auth.session-token")).toEqual({
      maxAge: 0,
      path: "/",
      secure: true,
    });
    expect(cookieClearOptions("__Host-next-auth.csrf-token")).toEqual({
      maxAge: 0,
      path: "/",
      secure: true,
    });
  });
});
