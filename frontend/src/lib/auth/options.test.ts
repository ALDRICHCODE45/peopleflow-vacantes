import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAuthEnv } from "./env";
import { buildAuthOptions } from "./callbacks";
import type { Account, NextAuthOptions, Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { RefreshSignal } from "./refresh-observer";

const callbacks: NonNullable<NextAuthOptions["callbacks"]> = buildAuthOptions(validateAuthEnv({
  NODE_ENV: "test", NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "fixture-secret-not-a-real-credential",
  COGNITO_CLIENT_ID: "fixture-client-id", COGNITO_CLIENT_SECRET: "fixture-client-secret",
  COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/fixture_pool",
  COGNITO_DOMAIN: "https://fixture.auth.example.com",
})).callbacks!;
const NOW = 1_000_000;
const publicSession: Session = {
  user: { name: "Fixture Recruiter", email: "fixture@example.com" },
  expires: "2099-01-01T00:00:00.000Z",
};
const account = (fields: Partial<Account>): Account => ({
  provider: "cognito", providerAccountId: "fixture-sub", type: "oauth", ...fields,
});

// Synthetic config exercises the production callbacks without ambient env reads.
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function readSession(token: JWT, initialAccount: Account | null = null) {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  const nextToken = await callbacks.jwt!({
    token, account: initialAccount, user: { id: "fixture-user" },
  });
  const session = await callbacks.session!({
    session: publicSession, token: nextToken, newSession: undefined, trigger: "update",
    user: { id: "fixture-user", email: "fixture@example.com", emailVerified: null },
  });
  return { token: nextToken, session };
}

function expectExpired(result: Awaited<ReturnType<typeof readSession>>) {
  expect(result.session.user).toBeUndefined();
  expect(result.session).toHaveProperty("error", "RefreshAccessTokenError");
  expect(result.token.accessToken).toBeUndefined();
  expect(result.token.refreshToken).toBeUndefined();
  expect(result.token.expiresAt).toBeUndefined();
}

describe("actual JWT to public-session boundaries", () => {
  it.each([undefined, "", "   "])("rejects future expiry without usable access credentials (%s)", async (accessToken) => {
    expectExpired(await readSession({ name: "Fixture Recruiter", expiresAt: NOW + 3_600_000, accessToken }));
  });

  it.each([
    { expires_at: (NOW + 3_600_000) / 1000 },
    { access_token: "", expires_at: (NOW + 3_600_000) / 1000 },
    { access_token: "fixture-expired-access", expires_at: 1 },
    { access_token: "fixture-access" },
  ])("fails closed on invalid initial account credentials %j", async (fields) => {
    expectExpired(await readSession({ name: "Fixture Recruiter" }, account(fields)));
  });

  it.each([0, -1, Number.MAX_VALUE])("fails closed on invalid refresh lifetime %s", async (expires_in) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: "fixture-invalid-access", expires_in }),
    }));
    expectExpired(await readSession({
      name: "Fixture Recruiter", accessToken: "fixture-expired-access",
      expiresAt: 1, refreshToken: "fixture-refresh",
    }));
  });

  it("projects valid login identity without exposing provider credentials", async () => {
    const result = await readSession({ name: "Fixture Recruiter" }, account({
      access_token: "fixture-private-access", refresh_token: "fixture-private-refresh",
      id_token: "fixture-private-id", expires_at: (NOW + 3_600_000) / 1000,
    }));
    expect(result.session.user?.name).toBe("Fixture Recruiter");
    expect(result.session).not.toHaveProperty("error");
    expect(JSON.stringify(result.session)).not.toMatch(/fixture-private|accessToken|refreshToken|idToken/);
  });

  it("projects a valid refreshed session without exposing any provider credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({
        access_token: "fixture-new-access", refresh_token: "fixture-new-refresh",
        id_token: "fixture-new-id", expires_in: 3600,
      }),
    }));
    const result = await readSession({
      name: "Fixture Recruiter", accessToken: "fixture-expired-access",
      expiresAt: 1, refreshToken: "fixture-refresh",
    });
    expect(result.session.user?.name).toBe("Fixture Recruiter");
    expect(result.session).not.toHaveProperty("error");
    expect(result.token.expiresAt).toBe(NOW + 3_600_000);
    expect(JSON.stringify(result.session)).not.toMatch(/fixture-new|accessToken|refreshToken|idToken/);
  });
});

describe("development refresh signal in the production callbacks", () => {
  const env = validateAuthEnv({
    NODE_ENV: "test", NEXTAUTH_URL: "http://localhost:3000",
    NEXTAUTH_SECRET: "fixture-secret-not-a-real-credential",
    COGNITO_CLIENT_ID: "fixture-client-id", COGNITO_CLIENT_SECRET: "fixture-client-secret",
    COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/fixture_pool",
    COGNITO_DOMAIN: "https://fixture.auth.example.com",
  });

  function optionsWithObserver() {
    const signals: RefreshSignal[] = [];
    const observer = {
      onAttempt: (signal: RefreshSignal) => signals.push(signal),
      onOutcome: (signal: RefreshSignal) => signals.push(signal),
    };
    return { signals, options: buildAuthOptions(env, observer) };
  }

  it("emits a correlated START/SUCCESS pair only when the callback actually refreshes", async () => {
    const { signals, options } = optionsWithObserver();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ access_token: "fixture-new-access", expires_in: 3600 }),
    }));

    await options.callbacks!.jwt!({
      token: {
        name: "Fixture Recruiter", accessToken: "fixture-expired-access",
        expiresAt: 1, refreshToken: "fixture-refresh",
      } as JWT,
      account: null,
      user: { id: "fixture-user" },
    });

    expect(signals.map((signal) => signal.label)).toEqual(["START", "SUCCESS"]);
    expect(signals[0].category).toBe("expired");
    expect(signals[0].id).toBe(signals[1].id);
  });

  it("does not emit any signal for an initial account sign-in", async () => {
    const { signals, options } = optionsWithObserver();
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    await options.callbacks!.jwt!({
      token: { name: "Fixture Recruiter" } as JWT,
      account: account({
        access_token: "fixture-access", refresh_token: "fixture-refresh",
        expires_at: (NOW + 3_600_000) / 1000,
      }),
      user: { id: "fixture-user" },
    });

    expect(signals).toEqual([]);
  });
});
