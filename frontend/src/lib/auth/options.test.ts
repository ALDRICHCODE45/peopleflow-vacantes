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

describe("redirect allowlist for NextAuth sign-in and sign-out callbacks", () => {
  const redirect = callbacks.redirect!;
  const baseUrl = "http://localhost:3000";
  it.each([
    "/vacantes/A12B3456-1234-4234-8234-123456789ABC/postular", "/empresa/login", "/candidato/ingresar", "/vacantes/a12b3456-1234-4234-8234-123456789abc/postular", "/api/auth/cognito/logout", "/api/auth/cognito/logout?to=candidato",
    "http://localhost:3000/empresa/vacantes",
  ])("keeps the allowlisted same-origin destination %s", async url => {
    expect(await redirect({ url, baseUrl })).toBe(new URL(url, baseUrl).toString());
  });
  it.each([
    "/VACANTES/a12b3456-1234-4234-8234-123456789abc/POSTULAR", "/Vacantes/a12b3456-1234-4234-8234-123456789abc/postular", "/vacantes/a12b3456-1234-4234-8234-123456789abc/Postular", "/vacantes/a12b3456-1234-4234-8234-123456789abc/postular/", "/vacantes", "/vacantes/bad/postular", "/vacantes/a12b3456-1234-4234-8234-123456789abc", "/vacantes/a12b3456-1234-4234-8234-123456789abc/postular/extra", "https://evil.example/vacantes/a12b3456-1234-4234-8234-123456789abc/postular", "https://evil.example/empresa", "//evil.example/empresa", "/\\evil.example", "/not-allowlisted",
    "http://localhost:3000/not-allowlisted", "/empresa-fake", "/api/auth/other", "javascript:alert(1)",
  ])("falls back to the site root for %s", async url => {
    expect(await redirect({ url, baseUrl })).toBe(`${baseUrl}/`);
  });
});

describe("password (credentials) sessions in the production callbacks", () => {
  const env = validateAuthEnv({
    NODE_ENV: "test", NEXTAUTH_URL: "http://localhost:3000",
    NEXTAUTH_SECRET: "fixture-secret-not-a-real-credential",
    COGNITO_CLIENT_ID: "fixture-client-id", COGNITO_CLIENT_SECRET: "fixture-client-secret",
    COGNITO_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/fixture_pool",
    COGNITO_DOMAIN: "https://fixture.auth.example.com",
  });
  const SUB = "a1b2c3d4-5678-40ab-8def-0123456789ab";
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const ACCESS = `${b64({ alg: "RS256", kid: "k" })}.${b64({ sub: SUB, token_use: "access", client_id: "fixture-client-id" })}.c2ln`;
  const ID = `${b64({ alg: "RS256", kid: "k" })}.${b64({ sub: SUB, token_use: "id", name: "Laura Gómez" })}.c2ln`;

  function fakeCognito(refreshResult: unknown = { ok: false, reason: "invalid_credentials" }) {
    const signIn = vi.fn().mockResolvedValue({
      ok: true, kind: "tokens", tokens: { accessToken: ACCESS, idToken: ID, refreshToken: "fixture-private-refresh", expiresAt: NOW + 3_600_000 },
    });
    const refresh = vi.fn().mockResolvedValue(refreshResult);
    return { signIn, refresh, client: { signIn, refresh } as never };
  }

  function passwordProvider(options: NextAuthOptions) {
    const provider = options.providers.find((p) => p.id === "password") as unknown as {
      options: { authorize: (c: Record<string, string>, r: unknown) => Promise<unknown> };
    };
    return provider.options;
  }

  async function signInWithPassword(options: NextAuthOptions) {
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const user = await passwordProvider(options).authorize({ email: "laura@empresa.mx", password: "Sup3r-secret-pass!" }, {}) as { id: string; name: string; email: string; image: null };
    return options.callbacks!.jwt!({
      token: { name: user.name, email: user.email, picture: user.image, sub: user.id },
      user: user as never,
      account: { provider: "password", type: "credentials", providerAccountId: user.id },
    });
  }

  it("registers the password provider next to the Cognito OAuth provider only when a Cognito client is supplied", () => {
    expect(buildAuthOptions(env).providers.map((p) => p.id)).toEqual(["cognito"]);
    const { client } = fakeCognito();
    expect(buildAuthOptions(env, undefined, {}, { cognito: () => client }).providers.map((p) => p.id)).toEqual(["cognito", "password"]);
  });

  it("stores the Cognito tokens in the same JWT cookie shape the OAuth path uses, marked as a password session", async () => {
    const { client } = fakeCognito();
    const options = buildAuthOptions(env, undefined, {}, { cognito: () => client });
    const passwordToken = await signInWithPassword(options);
    const oauthToken = await options.callbacks!.jwt!({
      token: { name: "Laura Gómez", email: "laura@empresa.mx", picture: null, sub: SUB },
      account: account({ access_token: "fixture-access", refresh_token: "fixture-refresh", expires_at: (NOW + 3_600_000) / 1000 }),
      user: { id: SUB },
    });
    expect(Object.keys(passwordToken).sort()).toEqual(Object.keys(oauthToken).sort());
    expect(passwordToken).toEqual({
      sub: SUB, name: "Laura Gómez", email: "laura@empresa.mx", picture: null,
      accessToken: ACCESS, refreshToken: "fixture-private-refresh", expiresAt: NOW + 3_600_000, authKind: "password",
    });
    expect(oauthToken.authKind).toBe("oauth");
  });

  it("runs the sign-in hook once with the password session's access token", async () => {
    const { client } = fakeCognito();
    const onSignIn = vi.fn().mockResolvedValue(undefined);
    await signInWithPassword(buildAuthOptions(env, undefined, { onSignIn }, { cognito: () => client }));
    expect(onSignIn).toHaveBeenCalledExactlyOnceWith(ACCESS);
  });

  it("fails closed when a credentials account arrives without the hidden tokens", async () => {
    const { client } = fakeCognito();
    const options = buildAuthOptions(env, undefined, {}, { cognito: () => client });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const token = await options.callbacks!.jwt!({
      token: { sub: SUB, name: "x" },
      user: { id: SUB, accessToken: "forged" } as never,
      account: { provider: "password", type: "credentials", providerAccountId: SUB },
    });
    expect(token.accessToken).toBeUndefined();
    expect(token.error).toBe("RefreshAccessTokenError");
  });

  it("refreshes an expired password session through Cognito with the sub and keeps it a password session", async () => {
    const { client, refresh } = fakeCognito({ ok: true, tokens: { accessToken: "fixture-new-access", refreshToken: "fixture-private-refresh", expiresAt: NOW + 7_200_000 } });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const options = buildAuthOptions(env, undefined, {}, { cognito: () => client });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const token = await options.callbacks!.jwt!({
      token: { sub: SUB, name: "Laura", authKind: "password", accessToken: "fixture-old", refreshToken: "fixture-private-refresh", expiresAt: NOW + 10_000 } as JWT,
      account: null, user: { id: SUB },
    });
    expect(refresh).toHaveBeenCalledExactlyOnceWith("fixture-private-refresh", SUB);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(token).toMatchObject({ authKind: "password", accessToken: "fixture-new-access", expiresAt: NOW + 7_200_000 });
  });

  it("expires a password session whose Cognito refresh fails and projects the generic error", async () => {
    const { client } = fakeCognito({ ok: false, reason: "invalid_credentials" });
    const options = buildAuthOptions(env, undefined, {}, { cognito: () => client });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const token = await options.callbacks!.jwt!({
      token: { sub: SUB, name: "Laura", authKind: "password", accessToken: "fixture-old", refreshToken: "fixture-private-refresh", expiresAt: 1 } as JWT,
      account: null, user: { id: SUB },
    });
    const session = await options.callbacks!.session!({
      session: publicSession, token, newSession: undefined, trigger: "update",
      user: { id: SUB, email: "x", emailVerified: null },
    });
    expect(token).toEqual({ sub: SUB, name: "Laura", authKind: "password", error: "RefreshAccessTokenError" });
    expect(session).toEqual({ expires: publicSession.expires, error: "RefreshAccessTokenError" });
  });

  it("wires the throttled-refresh operator signal into the production callbacks", async () => {
    const { client } = fakeCognito({ ok: false, reason: "too_many_attempts" });
    const onServiceError = vi.fn();
    const options = buildAuthOptions(env, undefined, {}, { cognito: () => client, onServiceError });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const token = await options.callbacks!.jwt!({
      token: { sub: SUB, name: "Laura", authKind: "password", accessToken: "fixture-old", refreshToken: "fixture-private-refresh", expiresAt: 1 } as JWT,
      account: null, user: { id: SUB },
    });
    expect(token.error).toBe("RefreshAccessTokenError");
    expect(onServiceError).toHaveBeenCalledExactlyOnceWith("refresh", "RefreshThrottled");
  });

  it("keeps OAuth sessions on the token endpoint even when a Cognito client exists", async () => {
    const { client, refresh } = fakeCognito();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: "fixture-new-access", expires_in: 3600 }) }));
    const options = buildAuthOptions(env, undefined, {}, { cognito: () => client });
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    const token = await options.callbacks!.jwt!({
      token: { sub: SUB, authKind: "oauth", accessToken: "a", refreshToken: "r", expiresAt: 1 } as JWT, account: null, user: { id: SUB },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(token).toMatchObject({ authKind: "oauth", accessToken: "fixture-new-access" });
  });
});
