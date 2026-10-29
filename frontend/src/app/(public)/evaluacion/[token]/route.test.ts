import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const token = "aB_9-".repeat(8) + "abc"; // 43 base64url characters (256-bit link).
const request = () => new Request(`https://peopleflow.test/evaluacion/${token}`, { headers: { Cookie: "pf_assessment=existing-valid-assessment" } });
afterEach(() => vi.unstubAllEnvs());
it.each(["production", "development"])("exchanges a link for a private session cookie in %s without calling the backend", async environment => {
  vi.stubEnv("NODE_ENV", environment);
  const fetch = vi.spyOn(globalThis, "fetch");
  const response = await GET(request(), { params: Promise.resolve({ token }) });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://peopleflow.test/evaluacion");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain(`pf_assessment=${token};`);
  expect(cookie).toContain("Path=/evaluacion");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  expect(cookie.includes("Secure")).toBe(environment === "production");
  expect(cookie).not.toMatch(/Max-Age|Expires/i);
  expect(await response.text()).toBe("");
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});
it.each(["", "a".repeat(31), "a".repeat(129), "a".repeat(42) + "+", "a".repeat(42) + "=", "../bad", "a\nb"])("rejects malformed links without clearing an existing session: %j", async token => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const response = await GET(request(), { params: Promise.resolve({ token }) });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("https://peopleflow.test/evaluacion");
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await response.text()).toBe("");
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});
it.each([32, 128])("accepts the safe base64url length boundary %s", async length => {
  const response = await GET(request(), { params: Promise.resolve({ token: "a".repeat(length) }) });
  expect(response.status).toBe(303);
  expect(response.headers.get("set-cookie")).toContain(`pf_assessment=${"a".repeat(length)};`);
});
