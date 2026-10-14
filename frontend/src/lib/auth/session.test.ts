import { describe, expect, it } from "vitest";
import { REFRESH_ERROR } from "./refresh";
import { toPublicSession } from "./session";

const baseSession = {
  user: { name: "Session Name", email: "session@example.com", image: "session-image" },
  expires: "2099-01-01T00:00:00.000Z",
};

describe("toPublicSession", () => {
  it("returns only the standard public user fields and strips every token field from the payload", () => {
    const secret = {
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      idToken: "secret-id-token",
      expiresAt: 100_000,
    };
    const publicSession = toPublicSession(baseSession, {
      ...secret,
      name: "Ada Lovelace",
      email: "ada@example.com",
      picture: "https://images.example.com/ada.png",
    }, 1_000);

    expect(publicSession).toEqual({
      expires: baseSession.expires,
      user: {
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: "https://images.example.com/ada.png",
      },
    });

    const serialized = JSON.stringify(publicSession);
    for (const value of [
      "secret-access-token",
      "secret-refresh-token",
      "secret-id-token",
      "accessToken",
      "refreshToken",
      "idToken",
      "expiresAt",
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("keeps the session shape free of the error flag when the token is usable", () => {
    const publicSession = toPublicSession(baseSession, {
      name: "Ada", accessToken: "fixture-access", expiresAt: 100_000,
    }, 1_000);
    expect(publicSession.error).toBeUndefined();
    expect("error" in publicSession).toBe(false);
  });

  it("exposes only the generic refresh error and no user or tokens when the session is unusable", () => {
    const publicSession = toPublicSession(baseSession, {
      name: "Ada",
      email: "ada@example.com",
      accessToken: "secret-access-token",
      error: REFRESH_ERROR,
    });

    expect(publicSession).toEqual({ expires: baseSession.expires, error: REFRESH_ERROR });
    expect(publicSession.user).toBeUndefined();
    expect(JSON.stringify(publicSession)).not.toContain("secret-access-token");
  });
});
