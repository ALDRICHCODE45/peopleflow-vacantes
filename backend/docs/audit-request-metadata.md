# Audit request metadata (client IP and browser)

Contract: `docs/contracts/audit-log-v1.md` §1 and §4. Code:
`internal/runtime/requestmeta` (middleware), `internal/runtime/clientip`
(address resolution), `internal/features/audit_events/infrastructure/postgres`
(adapter).

## Configuration

| Variable | Meaning |
| --- | --- |
| `AUDIT_PROXY_SECRET` | Secret shared with the Next BFF (at least 32 random bytes, e.g. `openssl rand -hex 32`). Unset or blank: no forwarded header is ever trusted and every row is `ip_source = peer` (local dev). Never logged, echoed or stored. |
| `TRUSTED_PROXY_CIDRS` | Comma-separated CIDRs of reverse proxies whose `X-Forwarded-For` is read. Unset: the TCP peer is used. An invalid or `/0` value aborts startup. Shared with the assessment rate limiter. |

## Rule

The middleware runs on every route, right after `middleware.RequestID` and
before authentication, and stores `requestmeta.Meta` in the request context.

| Request | `ip` | `user_agent` | `ip_source` |
| --- | --- | --- | --- |
| `X-PF-Proxy-Secret` equals `AUDIT_PROXY_SECRET` (constant-time) | `X-PF-Client-IP`; invalid or missing: `NULL` | `X-PF-Client-User-Agent` | `bff` |
| Header absent, different, or no secret configured | trusted-proxy rule (`clientip.Resolve`) | request `User-Agent` | `peer` |

- `X-PF-Client-*` are ignored unless the secret matches, so a client cannot fake
  its address by sending them.
- `user_agent` is cut to 512 bytes at a UTF-8 boundary; invalid bytes become
  U+FFFD (PostgreSQL `text` refuses them) and an empty value is `NULL`.
- IPv4-mapped addresses are stored as IPv4 and IPv6 zones are dropped.
- `Append` writes `ip`, `user_agent` and `ip_source` from the request context;
  a context without metadata (system jobs) writes `NULL` for all three.
  Emitters do not pass them. `company_id` and `vacancy_id` come from the event.

Which events carry this metadata (sensitive reads, sessions, member changes) is
in [audit-capture.md](audit-capture.md).
