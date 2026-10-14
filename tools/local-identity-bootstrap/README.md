# Private local identity launcher

TMP-IDENTITY-001 supervisor for a **future human-operated** local recruiter bootstrap. It loads authorized configuration in RAM, shares one fresh bridge key through child environments, and preserves Go's private controlling terminal. Construction and synthetic proof do **not** authorize real execution or prove account creation.

## Safe checks now

```bash
python3 tools/local-identity-bootstrap/launcher.py --help
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s tools/local-identity-bootstrap -p 'test_launcher.py' -v
```

Help/default performs no dotenv reads or child launches. The tests create isolated synthetic dotenv, fake Next dependencies and fake children; they never execute Go/Next, connect to PostgreSQL/Cognito, approve a human account, or consume real dotenv. The dependency fixture proves wiring, **not installed Next parsing or live runtime readiness**.

## Future launch: explicit human permission first

Do not run `--launch` from agent tools. Before a human launches it, obtain scoped permission for:

- `<backend project>/backend/.env` private read.
- `<frontend directory>/.env.development.local`, `.env.local`, `.env.development`, `.env`, including reads after changes during the development server's lifetime. The previous two-file checker grant is insufficient.
- Installed, trusted frontend dependencies/source execution; a trusted prebuilt Go `localidentitybootstrap` executable. Build that executable separately; the launcher does not build/install anything.
- Local Next development writes (`.next` and possible framework/tooling initialization), Go listener/database connection, Cognito/JWKS/UserInfo network access and the explicitly approved users-only flow.

Next watches/reloads development dotenv; checking initial absence is **not** confinement. This launcher is not a filesystem/network sandbox. Keep the four authorized paths free of symlinks; initial reads reject symlinks, but subsequent Next reloads remain subject to the separately granted lifetime scope. Do not record the private terminal or run it in a shared session.

Only after these permissions and a trusted binary are ready, the human uses a foreground Linux/POSIX terminal:

```text
python3 tools/local-identity-bootstrap/launcher.py --launch \
  --frontend-root <absolute frontend directory> \
  --backend-binary <absolute prebuilt localidentitybootstrap executable>
```

Arguments contain paths only, never credentials or the bridge key. Parent root is inferred from this launcher's location. Go must be the actual trusted executable, not `go run` or a shell wrapper; it owns `/dev/tty` account/role/target approval. This launcher neither reads nor supplies an approval answer. The browser Prepare/Apply steps and verified account approval remain human actions under the existing feature instructions.

## Configuration and privacy

| Child | Explicit temporary settings |
| --- | --- |
| Go | `APP_ENV=local`, `IDENTITY_JWT_MODE=jwks`, `IDENTITY_JWT_TOKEN_USE=access`, `IDENTITY_LOCAL_BOOTSTRAP_ENABLED=true`, address `127.0.0.1:8081`, type `recruiter`, key and mapped Cognito domain |
| Next | `NODE_ENV=development`, telemetry disabled, `PEOPLEFLOW_LOCAL_BOOTSTRAP_ENABLED=true`, base URL `http://127.0.0.1:8081`, same key |

Backend keeps only DATABASE_URL and its issuer/client/audience/cache/fetch fields from its dotenv. Frontend keeps only NEXTAUTH_URL/NEXTAUTH_SECRET and COGNITO_CLIENT_ID/CLIENT_SECRET/ISSUER/DOMAIN from its four files. Backend and frontend are parsed in separate fresh Node processes using Next-relative `@next/env.processEnv`, explicit file precedence and no inherited credentials. Missing cache/fetch durations get `5m`/`5s` defaults. Existing values remain application-validated.

Before launching children, static checks accept the same local database shapes as the Go bootstrap: the case-insensitive `localhost` alias and any literal loopback IP (IPv4, IPv6 and IPv4-mapped IPv6). They reject a non-loopback or missing host and a missing database name, plus the six libpq indirection query parameters `host`, `hostaddr`, `service`, `servicefile`, `passfile` and `target_session_attrs`. They also reject `dbname`, `database` and `port` query keys, which pgx can use to override the target displayed for approval. All nine keys are rejected even with blank values or no `=`; rejection occurs before a connection or application child launch. The raw `DATABASE_URL` is passed to Go unchanged. Static checks also reject a nonlocal HTTP frontend origin, missing frontend auth fields and mismatched issuer/client ID. These checks do not prove Cognito pool/client permissions, token usability or database schema; applications still own final validation. A new 32-random-byte hex key is generated in RAM only after the controlling-terminal gate and static checks; it is never printed, persisted or passed in argv. Dotenv files are never modified.

Child stdout/stderr are discarded; Go's private `/dev/tty` prompt remains visible only to the human. The `load-env.cjs` helper has an **internal private-pipe protocol** whose output contains configuration: never invoke it manually, through agent tools or a log collector. The parent captures it in RAM and outputs only fixed status codes. Python/Node memory is not cryptographically erased; environment and memory remain observable to same-user/privileged processes. Disable recordings/core dumps and use a trusted private workstation.

## Lifecycle and limits

- One Next child and one prebuilt Go child; no retries or auto-approval.
- Stop both on Go exit, Next exit, Ctrl-C/SIGTERM or the ten-minute limit, with bounded TERM/KILL escalation. Next uses its own process group; Go stays in the human foreground group.
- SIGKILL, workstation/process crashes and untrusted executables are outside graceful cleanup guarantees. The operator must inspect/stop leftover processes privately in those cases.
- Exit `0`/`PRIVATE_LAUNCH_ENDED` means the supervisor ended, **not** that a user was created. Go rejection/expiry can also exit cleanly.
- Fixed `PRIVATE_*` failures suppress parser/child errors. Stop and obtain a human decision; do not automatically retry an unavailable or ambiguous real attempt.

Current task authority and evidence: [disposable PostgreSQL bootstrap](../../odd/tasks/disposable-postgres-bootstrap.md), T5. Actual services, browser/Cognito and recruiter creation remain T3 and pending separate approval.
