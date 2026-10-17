import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/env", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/auth/env")>();
  return { ...original, validateAuthEnv: () => ({ siteUrl: "http://localhost:3000", domain: "https://cognito.example.test", clientId: "synthetic-client", employerLoginUrl: "http://localhost:3000/empresa/login" }) };
});
import { GET } from "./route";
import { AUTH_COOKIE_NAMES } from "@/lib/auth/logout";
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
