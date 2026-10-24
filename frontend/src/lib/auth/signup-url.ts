/** The URL comes from NextAuth's Cognito transaction, not user input. */
export function toCognitoSignupUrl(url: string): string {
  try {
    const authorize = new URL(url);
    if (authorize.protocol !== "https:" || authorize.pathname !== "/oauth2/authorize") return url;
    // Keep the returned origin and raw query untouched (including encoding/order).
    // Avoid serializing URLSearchParams, which would normalize OAuth parameters.
    return url.replace(/^(https:\/\/[^/?#]+)\/oauth2\/authorize(?=[?#]|$)/i, "$1/signup");
  } catch {
    return url;
  }
}
