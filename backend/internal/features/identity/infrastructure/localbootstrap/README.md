# localbootstrap — temporary TMP-IDENTITY-001 backend

Narrow infrastructure package for the temporary local, users-only identity
bootstrap. It is **not** a general-purpose API surface. Real execution against
the human's database is **not authorized** by this change.

## Scope

- `LoadConfig` validates every option before any dependency (verifier, listener,
  database connection) is constructed. Disabled by default; only `APP_ENV=local`
  with explicit opt-in. No dotenv loading.
- `ParseDatabaseTarget` validates a local database target before connection:
  Postgres scheme, single explicit loopback/localhost host, named database, and
  no `host`/`hostaddr`/`service`/`servicefile`/`passfile`/`target_session_attrs`
  indirection that could resolve a different server or credential file.
- `HTTPUserInfoClient` calls the fixed HTTPS `/oauth2/userInfo` endpoint with a
  per-request deadline, a 16 KiB response cap, no redirects, and strict typed
  attributes (`sub`, `email`, `name` strings; `email_verified` is the boolean
  `true` or the exact string `"true"`). A required claim declared more than once
  (including an escaped alias of the same decoded key) is rejected instead of
  being silently resolved by map last-wins; unknown claims are ignored. Upstream
  bodies, headers and tokens never reach the caller or a log.
- `Coordinator` owns one immutable candidate: staging is rejected while a live
  candidate exists, approval is an operator decision, and the grant is consumed
  exactly once. Expiry is total-TTL from the start of the request.
- `CompatibleUserStore` wraps the existing identity repository by composition. A
  compatible existing same-subject row reports `ErrAlreadyExists` with no write;
  an incompatible row (different email, name or user type) reports
  `ErrIdentityConflict` and stops. It never updates, merges, relinks or retries.
- `UserServiceCreator` reuses `UserService.CreateUser` validation and maps
  outcomes to `created` / `already_exists`.

## HTTP contract

All requests require a loopback remote source, the exact listener `Host`, the
`X-Local-Bootstrap-Key` header and `Authorization: Bearer <access>`. There are no
CORS headers, no GET mutation, and no identity/profile is ever returned.

| Route | Body | Success |
| --- | --- | --- |
| `POST /stage` | `{}` | `202 {"ok":true,"operation_code":"<uppercase unpadded base32, 26 chars>","expires_in":60}` |
| `POST /apply` | `{"operation_code":"..."}` | `200 {"ok":true,"code":"created"\|"already_exists"}` |

Failures are the fixed `{"ok":false,"code":"<closed code>"}` shape with no error
or data fields. Closed codes: `invalid_request`, `unauthenticated`,
`bootstrap_forbidden`, `stage_pending`, `approval_required`, `identity_conflict`,
`operation_expired`, `identity_provider_unavailable`, `bootstrap_failed`.

Notes: a non-POST method returns `405` with the `invalid_request` code and an
`Allow: POST` header; an unknown path returns `404` with `invalid_request`.

## Privacy

The verified email is displayed **only** in the private `/dev/tty` prompt. The
subject, full name, access token and bridge key are never displayed, returned or
logged. The operation code is generated with `crypto/rand` and compared in
constant time.
