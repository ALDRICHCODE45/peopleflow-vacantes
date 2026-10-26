import { describe, expect, it } from "vitest";

import { candidateAuthHref, safeReturnTo } from "./return-to";

describe("safeReturnTo", () => {
  it.each([
    "/vacantes",
    "/vacantes?q=software%20engineer",
    "/vacantes?q=dise%C3%B1o&page=2",
    // A literal % in a search is %25: once decoded it is a stray %, not an escape.
    "/vacantes?q=50%25",
    "/vacantes?q=100%25%20remoto&page=2",
    "/vacantes/abc/postular",
    "/candidato/postulaciones",
  ])("keeps the internal destination %s", value => {
    expect(safeReturnTo(value)).toBe(value);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "/%2F%2Fevil.com",
    "/%252F%252Fevil.com",
    // A stray % must not stop the nested decoding that exposes an authority.
    "/%252F%252Fevil.com?q=50%25",
    // An undecodable escape run must not shield the valid separators beside it.
    "/%252F%252F%25FF@evil.com",
    "/%255C%25FF@evil.com",
    "/%252F%252F%25C0%25AF@evil.com",
    "/%zz",
    "%2F%2Fevil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\t/evil.com",
    "/%09/evil.com",
    "/%5Cevil.com",
    "/..//evil.com",
    "/./%2e%2e//evil.com",
    "/api/auth/session",
    "/candidato/login?next=/x",
    "/CANDIDATO/INGRESAR",
    `/${"a".repeat(5000)}`,
  ])("rejects %s", value => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it("falls back to the bare route when next is missing or unsafe", () => {
    expect(candidateAuthHref("login", null)).toBe("/candidato/login");
    expect(candidateAuthHref("login", "//evil.com")).toBe("/candidato/login");
    expect(candidateAuthHref("login", "/vacantes?q=software%20engineer")).toBe(
      `/candidato/login?next=${encodeURIComponent("/vacantes?q=software%20engineer")}`,
    );
  });
});
