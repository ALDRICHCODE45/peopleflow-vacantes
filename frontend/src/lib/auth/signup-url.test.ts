import { expect, it } from "vitest";
import { toCognitoSignupUrl } from "./signup-url";

it("rewrites only the authorize path, preserving raw query bytes and fragment", () => {
  const origin = "https://pool.auth.us-east-1.amazoncognito.com";
  const suffix = "?state=a%2fb%2B&scope=openid+email&code_challenge=pkce&x=%7e&x=two#fragment";
  expect(toCognitoSignupUrl(`${origin}/oauth2/authorize${suffix}`)).toBe(`${origin}/signup${suffix}`);
});
it.each([
  "https://app.example/api/auth/error?error=OAuthSignin",
  "/api/auth/signin?error=OAuthSignin",
  "https://pool.example/oauth2/authorize/next?state=test",
  "https://pool.example/oauth2/authorize/?state=test",
  "https://pool.example/signup?state=test",
  "not a URL",
])("leaves unexpected URL unchanged: %s", url => {
  expect(toCognitoSignupUrl(url)).toBe(url);
});
