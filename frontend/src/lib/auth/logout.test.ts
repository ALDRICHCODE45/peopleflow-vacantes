import { describe, expect, it } from "vitest";
import type { AuthEnv } from "./env";
import {
  LOGOUT_KIND_COOKIE,
  SECURE_LOGOUT_KIND_COOKIE,
  buildCognitoLogoutUrl,
  buildEmployerLoginUrl,
  buildLogoutDestination,
  cookieClearOptions,
  logoutKindCookie,
  logoutKindCookieName,
  readLogoutKind,
  serializeLogoutKindCookie,
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

describe("logout per session kind", () => {
  it.each([
    ["candidato", "http://localhost:3000/candidato/login"],
    [undefined, "http://localhost:3000/empresa/login"],
    ["https://evil.example", "http://localhost:3000/empresa/login"],
    ["//evil.example", "http://localhost:3000/empresa/login"],
  ])("sends a password session (to=%s) straight to the audience login page, without the Cognito /logout hop", (to, expected) => {
    expect(buildLogoutDestination(config, to, "password")).toBe(expected);
  });

  it("keeps the Cognito /logout hop for OAuth/social sessions", () => {
    expect(buildLogoutDestination(config, "candidato", "oauth")).toBe(buildCognitoLogoutUrl(config, "candidato"));
    expect(new URL(buildLogoutDestination(config, undefined, "oauth")).origin).toBe(config.domain);
  });

  it("names the hint `__Host-` on https and keeps the plain name only for http (local dev)", () => {
    expect(LOGOUT_KIND_COOKIE).toBe("peopleflow.logout-kind");
    expect(SECURE_LOGOUT_KIND_COOKIE).toBe("__Host-peopleflow.logout-kind");
    expect(logoutKindCookieName(true)).toBe(SECURE_LOGOUT_KIND_COOKIE);
    expect(logoutKindCookieName(false)).toBe(LOGOUT_KIND_COOKIE);
  });

  it("reads the kind hint only from an exact `password` value under the plain name on http", () => {
    expect(readLogoutKind("a=1; peopleflow.logout-kind=password; b=2", false)).toBe("password");
    for (const header of [null, "", "peopleflow.logout-kind=oauth", "peopleflow.logout-kind=PASSWORD", "x-peopleflow.logout-kind=password", "peopleflow.logout-kind=password2", "__Host-peopleflow.logout-kind=password"])
      expect(readLogoutKind(header, false)).toBe("oauth");
  });

  it("accepts only the `__Host-` name on https, so a sibling subdomain cannot plant the plain one", () => {
    expect(readLogoutKind("__Host-peopleflow.logout-kind=password", true)).toBe("password");
    for (const header of ["peopleflow.logout-kind=password", "__host-peopleflow.logout-kind=password", "__Host-peopleflow.logout-kind=oauth"])
      expect(readLogoutKind(header, true)).toBe("oauth");
  });

  it("issues the https hint as a valid `__Host-` cookie (Secure, Path=/, no Domain), HttpOnly and short-lived", () => {
    expect(logoutKindCookie("password", true)).toEqual({
      name: SECURE_LOGOUT_KIND_COOKIE, value: "password",
      options: { httpOnly: true, sameSite: "lax", path: "/", maxAge: 120, secure: true },
    });
    expect(logoutKindCookie("oauth", true)).toEqual({
      name: SECURE_LOGOUT_KIND_COOKIE, value: "",
      options: { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0, secure: true },
    });
    expect(serializeLogoutKindCookie("password", true)).toBe("__Host-peopleflow.logout-kind=password; Path=/; Max-Age=120; Secure; HttpOnly; SameSite=lax");
    expect(serializeLogoutKindCookie("password", true)).not.toMatch(/Domain=/i);
  });

  it("issues the http (local dev) hint under the plain name without Secure", () => {
    expect(logoutKindCookie("password", false)).toEqual({
      name: LOGOUT_KIND_COOKIE, value: "password",
      options: { httpOnly: true, sameSite: "lax", path: "/", maxAge: 120, secure: false },
    });
    expect(serializeLogoutKindCookie("oauth", false)).toBe("peopleflow.logout-kind=; Path=/; Max-Age=0; HttpOnly; SameSite=lax");
  });
});
