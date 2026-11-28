import { describe, expect, it } from "vitest";
import { computeSecretHash } from "./secret-hash";

// Vectors computed independently with OpenSSL:
//   printf '%s' "<username><clientId>" | openssl dgst -sha256 -hmac "<secret>" -binary | base64
const CLIENT_ID = "1example23456789app";
const CLIENT_SECRET = "example-client-secret-value";

describe("computeSecretHash", () => {
  it("is Base64(HMAC_SHA256(clientSecret, username + clientId)) for an email username", () => {
    expect(computeSecretHash("laura@empresa.mx", CLIENT_ID, CLIENT_SECRET)).toBe(
      "74Y+wLHuY7u1sW/DAyfGTsSNtU7XDqA1gKnpr82ZkT8=",
    );
  });

  it("uses whatever username it is given, e.g. the sub for REFRESH_TOKEN_AUTH", () => {
    expect(
      computeSecretHash("a1b2c3d4-5678-90ab-cdef-EXAMPLE11111", CLIENT_ID, CLIENT_SECRET),
    ).toBe("m/jBkwSiT6gYPQF7gKlPzhZ79NQBZLaTbSFgj03Uzbo=");
  });

  it("changes when the username, client id or secret changes", () => {
    const base = computeSecretHash("laura@empresa.mx", CLIENT_ID, CLIENT_SECRET);
    expect(computeSecretHash("Laura@empresa.mx", CLIENT_ID, CLIENT_SECRET)).not.toBe(base);
    expect(computeSecretHash("laura@empresa.mx", `${CLIENT_ID}x`, CLIENT_SECRET)).not.toBe(base);
    expect(computeSecretHash("laura@empresa.mx", CLIENT_ID, `${CLIENT_SECRET}x`)).not.toBe(base);
  });
});
