/**
 * Synthetic fixtures for the temporary local identity bootstrap (TMP-IDENTITY-001).
 *
 * Fixture contract shared with the backend peer and the independent verifier:
 * - Every value here is fake and safe to print in tests; none is a real
 *   credential, PII, JWT or database identifier.
 * - `FIXTURE_ACCESS` is deliberately not a JWT: the frontend never decodes it,
 *   it only forwards it to the fixed loopback Go endpoint.
 * - `FIXTURE_KEY` satisfies the ">= 32 bytes, no whitespace/control" rule so the
 *   config validator accepts it; it is not an operator secret.
 * - `FIXTURE_OPERATION_CODE` is 26 uppercase RFC4648 base32 characters, the
 *   exact 16-byte/128-bit unpadded shape both sides must enforce.
 */
export const FIXTURE_ACCESS = "fixture-private-access-token";
export const FIXTURE_KEY = "fixture-local-bootstrap-key-32bytes-min";
export const FIXTURE_BASE_URL = "http://127.0.0.1:8081";
export const FIXTURE_SITE_URL = "http://localhost:3000";
export const FIXTURE_OPERATION_CODE = "ABCDEFGHIJKLMNOPQRSTUVWXYA";
export const FIXTURE_EXPIRES_IN = 60;
export const FIXTURE_NEXTAUTH_SECRET = "fixture-nextauth-secret-not-real";
