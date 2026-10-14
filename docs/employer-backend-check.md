# Check the employer session against the Go API

`GET /api/auth/backend-check` performs one server-side `GET /me/company` using the signed-in employer's Cognito **access token**. It is a read-only diagnostic, not a company-data API or a draft-saving endpoint.

## Local and provisional scope

This diagnostic runs against the local Next.js frontend plus a local Go API and Postgres. No backend AWS infrastructure is deployed. A `backend_user_not_found` result means the Go API accepted the JWT but could not resolve a local user row; the local identity bootstrap that would create it is **proposed local-only, not production**, and is recorded in [`docs/temporary-decisions.md`](./temporary-decisions.md), with usage documented in [`docs/local-identity-bootstrap.md`](./local-identity-bootstrap.md). Regular local domain users are not that temporary mechanism, and no production data migration is promised. This diagnostic performs no automatic provisioning: no GET, login, or backend-check writes users or membership.

## Quick path

1. Run the frontend and Go API yourself. Keep private environment files and values out of chat. The bridge uses the existing server-only `PEOPLEFLOW_API_BASE_URL` (local Go origin: `http://localhost:8080`), `PEOPLEFLOW_SITE_URL`, and optional `PEOPLEFLOW_API_TIMEOUT_MS` (default: 8000 ms), plus the existing Cognito/NextAuth configuration.
2. Sign in through `/empresa/login`, then open `/api/auth/backend-check` on the same frontend origin.
3. Report only the HTTP status and the small JSON result below. Do not copy cookies, request headers, tokens, environment values or authentication callback URLs.

| HTTP status | JSON | Meaning |
| --- | --- | --- |
| 200 | `{"ok":true}` | Go accepted the access token and returned a company membership in the expected shape. |
| 401 | `{"ok":false,"code":"unauthenticated","diagnostic":"…"}` | A sanitized category identifies the stage where evidence is available; see below. |
| 404 | `{"ok":false,"code":"not_found"}` | Go could not find the membership or company. |
| 502 | `{"ok":false,"code":"backend_unavailable"}` | Network failure, rejected redirect or an unexpected upstream error. |
| 502 | `{"ok":false,"code":"invalid_backend_response"}` | Go did not return the expected 200 JSON company shape. |
| 504 | `{"ok":false,"code":"backend_timeout"}` | Go did not complete within the configured deadline. |
| 503 | `{"ok":false,"code":"authentication_unavailable"}` | Frontend configuration or session infrastructure is unavailable. |

### Authentication diagnostic categories

The HTTP status and `unauthenticated` code remain unchanged. Only 401 responses add `diagnostic`:

| Category | Evidence |
| --- | --- |
| `frontend_session_unavailable` | The bridge did not obtain usable, persisted access credentials; Go was not called. |
| `backend_token_rejected` | Go returned 401 with the exact allowlisted `{error:"unauthorized",code:"unauthenticated"}` envelope. This identifies rejection, not its cryptographic/configuration cause. |
| `backend_user_not_found` | Go returned 401 with the exact allowlisted `{error:"unauthenticated",code:"unauthenticated"}` envelope, corresponding to local user resolution after token verification. |
| `backend_auth_unknown` | Go returned 401 but its envelope was absent, malformed, unknown, contained extra fields, exceeded the 512-byte limit or could not be read within the deadline. |

The bridge does not infer cause from header presence/absence and never returns the raw error envelope. Oversized error bodies are cancelled; the shared transport's byte limit is opt-in (`maxErrorBodyBytes`) and existing callers retain their decoding behavior.

No result triggers user provisioning, membership creation, retries, draft writes or redirects. Client query parameters are ignored; the Go URL is fixed by validated server configuration.

## Session and transport boundaries

- The bridge clones NextAuth options for a private invocation of its cookie-writing session handler. The existing JWT callback performs renewal; only the private callback captures the resulting access token in server memory. Neither the public session callback nor `/api/auth/session` is modified.
- The private handler response contains only session expiry, never token or user fields. Its encrypted HttpOnly session cookies are preserved on the final diagnostic response, including Go failures. A captured token is not used unless NextAuth successfully returned the session body and effective populated session-cookie updates. CSRF cookies, deletion cookies and chunks subsequently cleared in the same response do not establish persistence. Missing, expired or failed-refresh credentials fail closed.
- NextAuth v4's single-argument `getServerSession` RSC mode is deliberately not used: its cookie setters are no-ops, so renewed credentials would not persist.
- The Go fetch and diagnostic response use `no-store`. The shared JSON transport gains an optional `redirect: "error"`; existing callers retain their previous redirect behavior.
- No company IDs, role, names, RFC, raw Go error bodies or upstream headers/cookies are returned. Session cookies are the normal encrypted browser-held NextAuth cookies, not exclusively server-side storage; they must never be shared.
- Existing concurrent-refresh and logout limitations remain unchanged. This diagnostic does not establish token revocation, production acceptance or authorization for draft saving.

## Verification

Deterministic tests use synthetic credentials and configuration only. They cover private capture, fail-closed behavior, cookie forwarding, fixed upstream URL, ignored query parameters, status sanitization, malformed JSON, network failures and the existing transport/source guards. Live Cognito/Go acceptance still requires the human-run quick path above; no private dotenv access or automatic service launch is required.
