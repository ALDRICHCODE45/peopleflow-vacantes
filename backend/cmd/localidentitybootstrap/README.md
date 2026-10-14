# localidentitybootstrap

One-shot, local-only, users-only identity bootstrap for the temporary
TMP-IDENTITY-001 flow. It creates at most **one** `recruiter` user through the
existing identity use case, after an explicit private-terminal approval.

> **Real execution against the human database is not authorized.** This command
> exists as a reviewed tool; running it against a real database requires a
> separate, explicit human approval. Do not run it against any non-local target.

## Safety properties

- Disabled by default (`IDENTITY_LOCAL_BOOTSTRAP_ENABLED` absent or `false` is a
  no-op). Only `APP_ENV=local` with explicit opt-in runs.
- Never loads `.env` files and never inspects credentials.
- Binds a literal loopback listener (`127.0.0.1:8081` by default) and rejects any
  request whose source is not loopback or whose `Host` is not the exact listener
  address.
- Requires a private controlling terminal (`/dev/tty`). Piped or `/dev/null`
  stdin cannot approve an operation.
- The bridge key and tokens are operator-managed secrets, never printed, echoed
  or logged.
- Exactly one creation attempt per process. No retry after an ambiguous database
  error. The process exits after the apply attempt, a reject, or expiry.
- Terminal EOF or read failure cancels the wait even before a candidate is
  staged, clears pending approval, and exits with a fixed sanitized error; no
  approval is inferred from terminal closure.
- Shutdown joins the single terminal reader deterministically: the terminal is
  closed exactly once to unblock a pending read, and no reader goroutine is left
  blocked on a channel send.

## Environment (names only)

| Variable | Meaning |
| --- | --- |
| `APP_ENV` | Must be exactly `local`. |
| `IDENTITY_LOCAL_BOOTSTRAP_ENABLED` | `true` to enable; absent/`false` is a no-op. |
| `IDENTITY_LOCAL_BOOTSTRAP_ADDR` | Literal loopback IP and port (default `127.0.0.1:8081`). |
| `IDENTITY_LOCAL_BOOTSTRAP_KEY` | Bridge key, at least 32 bytes, no whitespace/control. |
| `IDENTITY_LOCAL_BOOTSTRAP_USER_TYPE` | Must be exactly `recruiter`. |
| `IDENTITY_LOCAL_BOOTSTRAP_COGNITO_DOMAIN` | Bare HTTPS origin (no path/query/fragment/credentials). |
| `IDENTITY_JWT_MODE` / `IDENTITY_JWT_ISSUER` / `IDENTITY_JWT_CLIENT_ID` / `IDENTITY_JWT_TOKEN_USE` | Existing JWKS configuration; mode `jwks`, purpose `access`, client id required. |
| `DATABASE_URL` | Explicit loopback Postgres target. |

Run `localidentitybootstrap -h` for the same names, defaults and limitations. The
help output never prints values. Any other argument, including an extra argument
after `-h`, exits with status 2.

## Manual execution (later, explicitly approved)

1. Set the variables above in the operator's shell (never paste secrets into
   chat, tickets or screenshots).
2. Start the process in a real terminal and keep it running.
3. From the temporary local frontend page, start a stage; the terminal shows the
   verified email, issuer, recruiter role, the local database host/name, the
   users-only scope and the operation code.
4. Type `approve <operation code>` or `reject`.
5. The frontend performs the apply; the process exits after that single attempt.

## Limitations

- Local Linux/macOS terminal only (`/dev/tty`).
- Same-subject re-login cannot be distinguished without an additional session
  instance marker; the process accepts only an explicit terminal approval.
- A `200` result with `already_exists` means a compatible same-subject recruiter
  row was already present and was left unchanged.
