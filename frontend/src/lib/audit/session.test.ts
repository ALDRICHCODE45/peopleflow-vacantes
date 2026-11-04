import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Account, NextAuthOptions } from "next-auth";
import { validateAuthEnv } from "@/lib/auth/env";
import { buildAuthOptions } from "@/lib/auth/callbacks";
import { recordSessionEvent } from "./session";
import { signOutWithAudit } from "./sign-out";

const API = "https://api.peopleflow.mx";
const AUTH_ENV = validateAuthEnv({
  NODE_ENV: "test", NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "fixture-secret-not-a-real-credential",
  COGNITO_CLIENT_ID: "fixture-client-id", COGNITO_CLIENT_SECRET: "fixture-client-secret",
  COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/fixture_pool",
  COGNITO_DOMAIN: "https://fixture.auth.example.com",
});
const NOW = 1_000_000;
const account = (fields: Partial<Account>): Account => ({ provider: "cognito", providerAccountId: "fixture-sub", type: "oauth", ...fields });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("recordSessionEvent", () => {
  it.each(["start", "end"] as const)("POSTs an empty authenticated request to /v2/me/session/%s", async (kind) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await recordSessionEvent(kind, " access-token ", { fetchImpl, apiBaseUrl: API, timeoutMs: 2000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/v2/me/session/${kind}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer access-token");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("never throws: a 404, a 500, a network error and a timeout all resolve", async () => {
    const outcomes = [
      async () => new Response("{}", { status: 404 }),
      async () => new Response("{}", { status: 500 }),
      async () => { throw new TypeError("fetch failed"); },
      async (_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted")))),
    ];
    for (const outcome of outcomes) {
      const fetchImpl = vi.fn(outcome);
      await expect(recordSessionEvent("end", "t", { fetchImpl: fetchImpl as never, apiBaseUrl: API, timeoutMs: 10 })).resolves.toBeUndefined();
    }
  });

  it("does nothing without a token", async () => {
    const fetchImpl = vi.fn();
    await recordSessionEvent("end", "  ", { fetchImpl, apiBaseUrl: API, timeoutMs: 2000 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("session start on sign-in", () => {
  function jwt(onSignIn: (token: string) => Promise<void>) {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const callbacks: NonNullable<NextAuthOptions["callbacks"]> = buildAuthOptions(AUTH_ENV, undefined, { onSignIn }).callbacks!;
    return (initialAccount: Account | null, token: Record<string, unknown> = { sub: "fixture-sub" }) =>
      callbacks.jwt!({ token, account: initialAccount, user: { id: "fixture-user" }, trigger: initialAccount ? "signIn" : "update" } as never);
  }

  it("records the start once, with the fresh access token, on the sign-in callback", async () => {
    const onSignIn = vi.fn(async () => {});
    const next = await jwt(onSignIn)(account({ access_token: "fresh-token", refresh_token: "r", expires_at: NOW / 1000 + 3600 }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onSignIn).toHaveBeenCalledWith("fresh-token");
    expect(next).toMatchObject({ accessToken: "fresh-token" });
  });

  it("does not record on later callbacks (refresh) nor with unusable sign-in credentials", async () => {
    const onSignIn = vi.fn(async () => {});
    const run = jwt(onSignIn);
    await run(null, { sub: "s", accessToken: "a", refreshToken: "r", expiresAt: NOW + 3_600_000 });
    await run(account({ access_token: "fresh-token", expires_at: NOW / 1000 - 10 }));
    expect(onSignIn).not.toHaveBeenCalled();
  });

  it("a failed start never blocks the sign-in", async () => {
    const next = await jwt(async () => { throw new Error("api down"); })(account({ access_token: "fresh-token", refresh_token: "r", expires_at: NOW / 1000 + 3600 }));
    expect(next).toMatchObject({ accessToken: "fresh-token" });
  });
});

describe("signOutWithAudit", () => {
  it("records the end before signing out, with the same callback URL", async () => {
    const order: string[] = [];
    const endSession = vi.fn(async () => { order.push("end"); });
    const signOut = vi.fn(async () => { order.push("signOut"); });
    await signOutWithAudit("/api/auth/cognito/logout?to=candidato", { endSession, signOut, timeoutMs: 3000 });
    expect(order).toEqual(["end", "signOut"]);
    expect(signOut).toHaveBeenCalledWith({ callbackUrl: "/api/auth/cognito/logout?to=candidato" });
  });

  it("signs out even when recording the end fails or hangs", async () => {
    const signOut = vi.fn(async () => {});
    await signOutWithAudit("/api/auth/cognito/logout", { endSession: async () => { throw new Error("x"); }, signOut, timeoutMs: 3000 });
    await signOutWithAudit("/api/auth/cognito/logout", { endSession: () => new Promise<void>(() => {}), signOut, timeoutMs: 10 });
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it("propagates a sign-out failure so the buttons keep their error state", async () => {
    await expect(signOutWithAudit("/x", { endSession: async () => {}, signOut: async () => { throw new Error("no"); }, timeoutMs: 10 })).rejects.toThrow("no");
  });
});

describe("every sign-out goes through signOutWithAudit", () => {
  it("no source file outside lib/audit calls NextAuth signOut directly", () => {
    const root = join(__dirname, "..", "..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || path.includes(join("lib", "audit"))) continue;
        if (/\bsignOut\s*\(/.test(readFileSync(path, "utf8"))) offenders.push(relative(root, path));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
