import { afterEach, describe, expect, it, vi } from "vitest";
const site = vi.hoisted(() => ({ url: "http://localhost:3000" }));
vi.mock("@/lib/auth/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/env")>();
  return { ...original, validateAuthEnv: () => ({ siteUrl: site.url, domain: "https://cognito.example.test", clientId: "synthetic-client", employerLoginUrl: `${site.url}/empresa/login` }) };
});
import { GET } from "./route";
import { AUTH_COOKIE_NAMES, LOGOUT_KIND_COOKIE, SECURE_LOGOUT_KIND_COOKIE } from "@/lib/auth/logout";
afterEach(() => { site.url = "http://localhost:3000"; });
describe("federated logout destination allowlist", () => {
  it.each([
    ["?to=candidato", "/candidato/login"], ["", "/empresa/login"], ["?to=empresa", "/empresa/login"],
    ["?to=https://evil.example", "/empresa/login"], ["?to=//evil.example", "/empresa/login"],
    ["?to=/candidato/login", "/empresa/login"], ["?to=candidato&to=https://evil.example", "/empresa/login"],
    ["?callbackUrl=https://evil.example", "/empresa/login"],
  ])("%s uses only configured destinations and clears local cookies", (query, path) => {
    const response = GET(new Request(`http://localhost:3000/api/auth/cognito/logout${query}`));
    expect(response.status).toBe(307);
    const destination = new URL(response.headers.get("location")!);
    expect(destination.origin).toBe("https://cognito.example.test");
    expect(destination.pathname).toBe("/logout");
    expect(destination.searchParams.get("logout_uri")).toBe(`http://localhost:3000${path}`);
    for (const cookie of AUTH_COOKIE_NAMES) expect(response.cookies.get(cookie)?.value).toBe("");
  });
});

describe("logout per session kind", () => {
  const withHint = (query: string, value: string) =>
    GET(new Request(`http://localhost:3000/api/auth/cognito/logout${query}`, { headers: { cookie: `${LOGOUT_KIND_COOKIE}=${value}` } }));

  it.each([
    ["?to=candidato", "http://localhost:3000/candidato/login"],
    ["", "http://localhost:3000/empresa/login"],
    ["?to=https://evil.example", "http://localhost:3000/empresa/login"],
  ])("a password session (%s) returns to the audience login page without the Cognito hop", (query, expected) => {
    const response = withHint(query, "password");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(expected);
    for (const cookie of AUTH_COOKIE_NAMES) expect(response.cookies.get(cookie)?.value).toBe("");
    expect(response.cookies.get(LOGOUT_KIND_COOKIE)?.value).toBe("");
  });

  it.each(["oauth", "PASSWORD", ""])("any other hint (%j) keeps the Cognito /logout hop and clears the hint", (value) => {
    const response = withHint("?to=candidato", value);
    expect(new URL(response.headers.get("location")!).origin).toBe("https://cognito.example.test");
    expect(response.cookies.get(LOGOUT_KIND_COOKIE)?.value).toBe("");
  });
});

describe("logout hint cookie name per scheme", () => {
  const logout = (cookie: string) =>
    GET(new Request(`${site.url}/api/auth/cognito/logout?to=candidato`, { headers: { cookie } }));

  it("on https accepts only the __Host- hint and clears it with valid __Host- attributes", () => {
    site.url = "https://peopleflow.example";
    const password = logout(`${SECURE_LOGOUT_KIND_COOKIE}=password`);
    expect(password.headers.get("location")).toBe("https://peopleflow.example/candidato/login");
    const cleared = password.headers.getSetCookie().find((c) => c.startsWith(`${SECURE_LOGOUT_KIND_COOKIE}=`));
    expect(cleared).toBe(`${SECURE_LOGOUT_KIND_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=lax`);

    const planted = logout(`${LOGOUT_KIND_COOKIE}=password`);
    expect(new URL(planted.headers.get("location")!).origin).toBe("https://cognito.example.test");
  });

  it("on http (local dev) accepts only the plain hint", () => {
    const password = logout(`${LOGOUT_KIND_COOKIE}=password`);
    expect(password.headers.get("location")).toBe("http://localhost:3000/candidato/login");
    expect(password.headers.getSetCookie()).toContain(`${LOGOUT_KIND_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=lax`);

    const prefixed = logout(`${SECURE_LOGOUT_KIND_COOKIE}=password`);
    expect(new URL(prefixed.headers.get("location")!).origin).toBe("https://cognito.example.test");
  });
});
