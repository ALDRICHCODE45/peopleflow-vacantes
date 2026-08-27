# Delta for Audit Events

This delta updates the `audit_events` specification to reflect that the companies owner-only write paths now co-write one audit event per successful write, expanding the closed event-type vocabulary from two to four. The Purpose paragraph (the summary prose at the top of the canonical spec) is updated to state the new four-event vocabulary and to drop "companies" from the list of write paths that emit nothing; that prose change is a downstream consequence of the two MODIFIED requirements below and is the summary the archive phase will paste into the canonical Purpose.

The actual emission contract for the companies write paths lives in the sibling `openspec/changes/companies-audit/specs/companies/spec.md` ADDED requirement — the emitting bounded context owns the emission behavior. The `audit_events` spec continues to own the declarative vocabulary, the metadata shape, and the closed-key PII-free invariant, extended here to cover the two new event types.

## MODIFIED Requirements

### Requirement: Event Type Vocabulary (Closed Set for This Cycle)

The `audit_events` domain in this slice MUST expose exactly four event-type constants: `ApplicationSubmitted` and `ApplicationTransitioned` from the `applications` write paths, plus `CompanyUpdated` and `CompanyDeleted` from the `companies` owner-only write paths. No other emit call MAY exist anywhere in the codebase this cycle (the jobs and identity write paths emit nothing). The closure is enforced at the application layer via the typed constants — `event_type` deliberately has no DB CHECK (§1.3 exception), so adding an event type in a future cycle is a code change, not a migration. The two new literals MUST live in the same domain package (`audit_events/domain/entities/auditEvent.go`) so the AST guard `TestEventVocabularyIsClosed` continues to enforce "no emit call site outside this package". The companion `entity_type` for the two new events MUST be the singular string `"company"` (sibling to the singular `"application"` already in use).
(Previously: exactly two event-type constants — `ApplicationSubmitted` and `ApplicationTransitioned`. No other emit call MAY exist anywhere in the codebase this cycle; the jobs, companies, and identity write paths emit nothing.)

#### Scenario: exactly four event-type constants exist this cycle

- GIVEN the `audit_events` domain in this slice
- WHEN its event-type surface is inspected
- THEN exactly `ApplicationSubmitted`, `ApplicationTransitioned`, `CompanyUpdated`, and `CompanyDeleted` exist, and no other event emission call exists in the codebase (the AST guard in `auditEvent_test.go::TestEventVocabularyIsClosed` enumerates the closed set; the emit-literal walk continues to pass because the two new literals stay in the entities package)

#### Scenario: the closed set omits jobs and identity event types

- GIVEN the four-event closed set for this cycle
- WHEN the codebase is scanned for any other `audit_events` emit call (insert into the table or call to `AuditEventRepository.Append`)
- THEN none exists outside the four constants above — the jobs write paths and the identity write paths still emit nothing, even after the vocabulary expansion

#### Scenario: the DB accepts a novel event_type string

- GIVEN the `audit_events` table
- WHEN an INSERT with `event_type='SomeFutureEventType'` (not emitted by this slice) is attempted directly
- THEN the DB accepts the row (no CHECK constraint — the closed set is a code-level invariant, not a DB-level one)

### Requirement: Metadata Shape (PII-Free)

The `metadata` JSONB MUST be built from a fixed, minimal field set and MUST NEVER carry `cover_letter`, candidate PII, or company profile PII. The shape per event type: `ApplicationSubmitted` → `{ "job_id", "source" }` (`job_id` always present; `source` present only when the application row's `source` is non-NULL); `ApplicationTransitioned` → `{ "job_id", "from_status", "to_status" }` (all three always present); `CompanyUpdated` → `{}` (an empty JSON object — the `200 OK` wire body already carries the post-write state, so a "what changed" diff would be redundant and would leak free-text profile values like `name`, `description`, or `website`); `CompanyDeleted` → `{ "jobs_closed" }` (the integer rowcount of the inline `CloseCompanyJobs` UPDATE stringified via `strconv.Itoa`; the `jobs_closed` key is ALWAYS present, even when the rowcount is `0`, so the metadata shape is stable and machine-parseable). The closed-key vocabulary for any application event is `{job_id, source, from_status, to_status}` only; the closed-key vocabulary for any company event is `{jobs_closed}` only; no event in any family MAY carry any other key. A unit test MUST pin the exact allowed per-family key set — including the empty-object invariant for `CompanyUpdated` — so a future edit cannot leak PII into the JSONB, cannot add a profile field to `CompanyUpdated`, and cannot drop the `jobs_closed` key from `CompanyDeleted`.
(Previously: two-event-type shape covering `ApplicationSubmitted` → `{ "job_id", "source" }` and `ApplicationTransitioned` → `{ "job_id", "from_status", "to_status" }`; the closed-key vocabulary across both events was `{job_id, source, from_status, to_status}`; no company event existed.)

#### Scenario: ApplicationSubmitted metadata carries job_id and source

- GIVEN an `ApplicationSubmitted` event for job J whose application row has `source='linkedin'`
- WHEN the event is persisted
- THEN `metadata` is exactly `{"job_id": J, "source": "linkedin"}`

#### Scenario: ApplicationTransitioned metadata carries the transition

- GIVEN an `ApplicationTransitioned` event for job J moving an application from `submitted` to `in_review`
- WHEN the event is persisted
- THEN `metadata` is exactly `{"job_id": J, "from_status": "submitted", "to_status": "in_review"}`

#### Scenario: CompanyUpdated metadata is the empty object

- GIVEN a successful `PATCH /me/company` that produced a `CompanyUpdated` event for company C
- WHEN the event is persisted
- THEN `metadata` is exactly `{}` (no diff, no field echoes, no profile PII — the `200 OK` body already carries the post-write state, and the closed-vocabulary unit test pins the empty object as the only allowed value)

#### Scenario: CompanyDeleted metadata carries jobs_closed as a string

- GIVEN a successful `DELETE /me/company` for company C whose inline `CloseCompanyJobs` UPDATE affected N rows (`N` ≥ `0`)
- WHEN the `CompanyDeleted` event is persisted
- THEN `metadata` is exactly `{"jobs_closed": "<N>"}` where `<N>` is the string form (`strconv.Itoa`) of the integer rowcount returned by the adapter

#### Scenario: CompanyDeleted metadata always carries jobs_closed, even when zero

- GIVEN a successful `DELETE /me/company` for company C whose inline `CloseCompanyJobs` UPDATE affected `0` rows (the legitimate "company had no non-closed jobs at delete time" success path — no `draft` or `published` jobs of `C` survived the `IN ('draft','published')` predicate)
- WHEN the `CompanyDeleted` event is persisted
- THEN `metadata` is exactly `{"jobs_closed": "0"}` (the key is present even when the rowcount is zero — stable shape so consumers can rely on a fixed schema rather than a present-or-absent branch)

#### Scenario: cover_letter, candidate PII, and company profile PII never enter metadata

- GIVEN any audit event emitted by the four write paths in scope, including applies that supplied a `cover_letter` and company PATCHes that supplied a new `name`, `description`, or `website`
- WHEN the persisted `metadata` is inspected
- THEN it contains no `cover_letter` key, no candidate PII, and no company profile field (`name`, `description`, `website`, `logo_url`, `size`, `founded_year`, `city`, `country`, `linkedin_url`, `instagram_url`, `facebook_url`, `twitter_url`, `cover_image_url`, `rfc`, `industry_id`) — a unit test pins the per-event-family allowed key set (`{job_id, source, from_status, to_status}` for applications; `{jobs_closed}` for companies; empty object for `CompanyUpdated`)
