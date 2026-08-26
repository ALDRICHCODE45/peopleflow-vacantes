# Delta for Applications

This delta **LIFTS** the `audit_events` deferral the canonical spec left open. The canonical "Out of scope (deferred)" clause — *"`audit_events` integration for `ApplicationSubmitted` or `ApplicationTransitioned` (the `audit_events` table has no migration in the repo yet)"* — is removed at merge, and the canonical Purpose sentence *"there is ... no `audit_events` row"* is corrected to state that the two application write paths now co-write audit events. The delta adds exactly four behaviors to the `applications` write paths: an `ApplicationSubmitted` event on a successful apply, an `ApplicationTransitioned` event on a successful transition, the acting recruiter's identity on the transition path (additive `UserID` on `CompanyContext`), and a fail-closed same-transaction co-write (an application write can never commit without its audit event). No existing requirement is MODIFIED and none is REMOVED: the `201 Created` / `200 OK` responses, the atomic apply eligibility gate, the no-double-apply `409`, the status transition matrix, the CAS-free transition guard, and the same-company invariants are all unchanged — the audit event is additive. The applications adapter owns the shared transaction (the decided bounded-context seam; no new unit-of-work abstraction). The new `audit_events` bounded-context spec (see `openspec/changes/audit_events/specs/audit_events/spec.md`) defines the table, the append-only port, and the co-write contract from the audit side.

## Out of scope (deferred)

This delta does NOT cover: any `audit_events` read endpoint or query surface (write-only in this cycle — a read surface is deferred to a later cycle); UPDATE / DELETE / backfill / replay of `audit_events`; outbox / SNS / SQS / EventBridge fan-out of `ApplicationSubmitted` or `ApplicationTransitioned`; event emission from the jobs, companies, or identity write paths (they emit nothing this cycle); retention / TTL / DynamoDB archival of `audit_events`; a catalog of event types beyond the two application events (`UserRegistered`, `CompanyCreated`, `JobPublished`, …); and a new unit-of-work abstraction (the applications adapter owns the transaction).

## ADDED Requirements

### Requirement: ApplicationSubmitted Audit Emission

`applyToJob` (`POST /jobs/{jobId}/applications`) MUST, on a `201 Created`, append exactly one `ApplicationSubmitted` audit event in the same database transaction as the application INSERT. The event MUST carry: `event_type='ApplicationSubmitted'`, `entity_type='application'`, `entity_id` = the new application row's `id`, `actor_type='user'`, `actor_id` = the candidate's `users.id` (the same JWT-resolved identity used for `candidate_id`), and `metadata` per the `audit_events` metadata contract (`job_id` always; `source` only when the application row's `source` is non-NULL; never `cover_letter` or candidate PII). `occurred_at` is server time (`now()`). A `400` / `401` / `403` / `404` / `409` outcome MUST append no event — the application write never happened, so there is nothing to audit.

#### Scenario: successful apply appends exactly one ApplicationSubmitted event

- GIVEN a valid JWT candidate, a published job from an active company, and a request body with optional `source` and `cover_letter`
- WHEN `POST /jobs/{jobId}/applications` succeeds with `201 Created`
- THEN exactly one `audit_events` row exists with `event_type='ApplicationSubmitted'`, `entity_type='application'`, `entity_id=<new application.id>`, `actor_type='user'`, `actor_id=<candidate users.id>`, and `occurred_at` within the request window

#### Scenario: metadata carries job_id and source when source was supplied

- GIVEN a successful apply with `"source":"linkedin"`
- WHEN the `201 Created` response is returned
- THEN the appended event's `metadata` is exactly `{"job_id": <jobId>, "source": "linkedin"}`

#### Scenario: metadata carries job_id only when source is NULL

- GIVEN a successful apply with no `source` key in the body
- WHEN the `201 Created` response is returned
- THEN the appended event's `metadata` is exactly `{"job_id": <jobId>}` (no `source` key — the minimal PII-free shape)

#### Scenario: cover_letter never enters the event metadata

- GIVEN a successful apply that supplied a `cover_letter`
- WHEN the `201 Created` response is returned
- THEN the appended event's `metadata` contains no `cover_letter` key and no candidate PII (the event builder never receives `cover_letter`)

### Requirement: ApplicationTransitioned Audit Emission

`transitionApplication` (`PATCH /jobs/{jobId}/applications/{id}/transition`) MUST, on a `200 OK`, append exactly one `ApplicationTransitioned` audit event in the same database transaction as the application UPDATE. The event MUST carry: `event_type='ApplicationTransitioned'`, `entity_type='application'`, `entity_id` = the transitioned application row's `id`, `actor_type='user'`, `actor_id` = the acting recruiter's `users.id` (from `CompanyContext.UserID` — see `Transition Actor Identity`), and `metadata` exactly `{"job_id": <jobId>, "from_status": <pre-transition status>, "to_status": <new status>}`. The event MUST be appended for every legal transition (`submitted → in_review`, `in_review → rejected`, `in_review → hired` — including terminal ones). A `400` (illegal transition / validation), `401`, `403`, or `404` (cross-company, non-existent, or lost race) outcome MUST append no event.

#### Scenario: successful transition appends exactly one ApplicationTransitioned event

- GIVEN a recruiter of company A and an `in_review` application A1 on a job J owned by A
- WHEN `PATCH /jobs/J/applications/A1/transition` with `{"status":"rejected"}` returns `200`
- THEN exactly one `audit_events` row exists with `event_type='ApplicationTransitioned'`, `entity_type='application'`, `entity_id=A1`, `actor_type='user'`, `actor_id=<recruiter users.id>`, and `metadata={"job_id": J, "from_status": "in_review", "to_status": "rejected"}`

#### Scenario: every legal transition appends exactly one event

- GIVEN the three legal transitions applied across applications (`submitted → in_review`, `in_review → rejected`, `in_review → hired`)
- WHEN each `PATCH .../transition` returns `200`
- THEN each application has exactly one `ApplicationTransitioned` row and each row's `from_status` is the pre-transition status and `to_status` is the new status (terminal transitions are audited too)

#### Scenario: a lost-race 404 appends no event

- GIVEN two recruiters of company A transition the same `submitted` application concurrently
- WHEN one response is `200` and the other is `404 application not found`
- THEN exactly one `ApplicationTransitioned` row exists (the winner's) and the loser's attempted transition left no audit row

### Requirement: Transition Actor Identity (CompanyContext UserID)

The `security.CompanyContext` on the transition path MUST carry the acting user's `users.id` as `UserID` in addition to the existing `company_id` and `role` — an additive identity change; no existing field is removed, re-typed, or re-sourced. The `ApplicationTransitioned` event's `actor_id` MUST be that `CompanyContext.UserID` with `actor_type='user'`. The handler MUST NOT accept an `actor_id` from the request body or path (the actor comes exclusively from the authenticated session). A request that reaches the transition use case without a resolvable `CompanyContext.UserID` MUST fail closed: `500 internal server error`, no status change, no audit event.

#### Scenario: the acting recruiter's users.id is recorded

- GIVEN recruiter R (`users.id=R`) of company A transitions an application owned by A with `200`
- WHEN the appended event is inspected
- THEN `actor_id=R` and `actor_type='user'` (the actor comes from `CompanyContext.UserID`, not from any request-supplied value)

#### Scenario: actor_id in the request body is ignored

- GIVEN a transition request body carrying an `"actor_id"` field
- WHEN the transition succeeds with `200`
- THEN the appended event's `actor_id` is the authenticated recruiter's `users.id`, not the body value

#### Scenario: missing CompanyContext.UserID fails closed

- GIVEN a transition request that reaches the use case without a resolvable `CompanyContext.UserID`
- WHEN the handler runs
- THEN the response is `500 internal server error`, the application row's `status` is unchanged, and no audit event exists

### Requirement: Fail-Closed Application + Audit Co-Write

The application write (the INSERT on apply, the UPDATE on transition) and its audit event MUST commit atomically in the same database transaction, and the applications adapter MUST own that transaction. If the audit INSERT fails for any reason, the whole transaction MUST roll back: no application row (apply) or no status change (transition) AND no audit event, and the HTTP response MUST be `500 internal server error` with the real error logged at `slog.Error`. The system MUST NOT commit an application write without its audit trail (fail-closed — the audit event is not best-effort). Conversely, a committed application write MUST have exactly one audit event (no duplication, no silent gap). No event is appended for any non-write outcome: `400` (validation / illegal transition), `401`, `403`, `404` (gate miss / cross-company / lost race), or `409` (already applied) — the application write never happened, so no audit row exists.

#### Scenario: an audit INSERT failure rolls back the application write

- GIVEN the `audit_events` INSERT fails (DB constraint, unavailable table, or unexpected pg error)
- WHEN `POST /jobs/{jobId}/applications` or `PATCH .../transition` reaches the co-write
- THEN the response is `500 internal server error`, no application row exists (apply) or the `status` is unchanged (transition), and no `audit_events` row exists (atomic rollback — the write and the event stand or fall together)

#### Scenario: a committed write implies exactly one event

- GIVEN a successful apply or transition (the co-write transaction committed)
- WHEN the `audit_events` table is queried for that application
- THEN exactly one audit row exists for that write (one event per committed write; a rollback leaves zero — no duplication, no silent gap)

#### Scenario: non-write outcomes append no event

- GIVEN each of: an illegal transition (`400`), a non-applicable job (`404 job not applicable`), a duplicate apply (`409 already applied`), an unauthenticated request (`401`), and a non-member request (`403`)
- WHEN the request reaches its route
- THEN the response is the pinned status AND no `audit_events` row is inserted (the application write never happened, so there is nothing to audit)
