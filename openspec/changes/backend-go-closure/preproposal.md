# Pre-Proposal Gate: Backend Go Closure Before AWS

Status: `confirmed`
Change: `backend-go-closure`
Artifact store: `openspec`
Research lane: `unselected` (repository evidence is sufficient; no external evidence grant is available)

## Confirmed outcome

The Go backend must be objectively complete before AWS implementation starts. Completion means canonical requirement traceability, closed Go/SQL test debt, deployable pre-AWS Go runtime boundaries, production authentication behavior, HTTP/observability minimums, and an explicit AWS go/no-go result.

## Locked non-goals

Unless the user explicitly promotes them later, this change MUST NOT implement event/outbox or async workers, CV/S3 lifecycle or anonymization, recruiter candidate search, invitations, restore/undelete, salary FX conversion, or an audit read API. Docker, Terraform, ECS/RDS/Cognito resources, workers, and deployment workflows remain AWS-phase work.

## Decisions resolved without prompting

These follow directly from the approved objective or conservative runtime defaults:

- Health: split process liveness (`/healthz`) from DB readiness (`/readyz`).
- PostConfirmation: required in production; explicit disable is local/test-only and MUST NOT silently disable production sync.
- JWT: Cognito JWKS in production plus an explicit static-PEM local/test mode; no implicit permissive fallback.
- Verification: zero unexpected skips before AWS GO; the known rollback placeholder must be replaced.
- Cross-feature architecture: document and enforce narrow domain-port/co-write exceptions; infrastructure imports across features remain forbidden. No broad refactor unless evidence proves it necessary.
- Future material in explanatory docs: retain only when clearly labeled future/non-MVP; remove statements that read as delivered/current.
- Delivery mechanics remain session preflight choices: `auto`, `openspec`, `ask-on-risk`, 400 authored-line review budget.

## Pending decision 1 — Candidate CV key wire contract

Current fact: `candidate_profiles.cv_s3_key` exists, while CV/S3 lifecycle is a locked non-goal. Allowing clients to write an unverifiable storage key violates that boundary.

Allowed tokens:

- `reserve` (recommended): keep the nullable DB column for the future CV slice, but reject/ignore client writes and omit it from ordinary wire responses until storage ownership exists.
- `remove-wire`: remove the request/response field now while retaining the DB column.
- `opaque-write`: preserve current client-write behavior, accepting an unverifiable storage reference.

Consequence: API compatibility versus enforcing the current non-goal boundary.

## Pending decision 2 — Industry validation

Current fact: company creation relies on the FK; ROADMAP explicitly leaves application-level active-catalog validation open.

Allowed tokens:

- `fk-only`: any existing industry row is valid; DB FK is authoritative.
- `active-catalog-in-app`: application checks active catalog before insert; clearer error but has a TOCTOU window.
- `atomic-active-sql-gate` (recommended): company creation succeeds only when the industry exists and is active in the same SQL statement/transaction.

Consequence: whether inactive catalog entries may be selected and how strongly that invariant is enforced.

## Pending decision 3 — Public API error contract

Current fact: companies currently mixes Spanish and English human messages; callers need stable behavior before cleanup.

Allowed tokens:

- `stable-codes-plus-english` (recommended): stable machine-readable error codes plus English default messages; UI localizes independently.
- `english-only`: normalize messages to English without introducing stable error codes.
- `spanish-only`: normalize messages to Spanish without introducing stable error codes.

Consequence: compatibility, localization responsibility, and size of the API contract change.

## Pending decision 4 — Minimum observability before AWS GO

Current fact: JSON slog, RequestID, Recoverer, and DB health exist; metrics/tracing do not.

Allowed tokens:

- `logs+metrics` (recommended): structured request/error logs with request correlation plus application/runtime/DB metrics; exporter destination remains AWS-phase design.
- `logs-only`: normalize structured logs and readiness but defer metrics/tracing.
- `otel-full`: logs, metrics, and distributed tracing before AWS scaffolding.

Consequence: operational confidence versus scope and cloud coupling.

## Confirmed selections

- Candidate CV key: `reserve` — retain the nullable DB column, prohibit/ignore client writes, and do not expose it as a valid storage reference until the future CV slice owns it.
- Industry validation: `atomic-active-sql-gate` — company creation requires an existing active industry inside the same SQL statement/transaction.
- Public API errors: `stable-codes-plus-english` — stable machine-readable codes with English default messages; frontend localization remains separate.
- Minimum observability: `logs+metrics` — correlated structured logs plus application/runtime/DB metrics; exporter destination remains an AWS-phase decision.

## Proposal readiness

All product decisions are confirmed. Research remains unselected. `sdd-proposal` is READY and must consume this handoff without re-interviewing the user or inferring different choices.
