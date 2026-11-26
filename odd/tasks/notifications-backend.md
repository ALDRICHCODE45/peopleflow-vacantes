# Notifications stage 1 (backend)

Backend half of the notifications system (in-app, stage 1), user-approved and relayed by the frontend session
2026-11-26. Branch `feat/notifications-backend` (worktree `../peopleflow-vacantes-notif`). Frontend proposal (source of
the requested shape): `peopleflow-vacantes-frontend/odd/tasks/notifications-system-contract.md`; decisions
`.../odd/tasks/notifications-system.md` L1–L7. Contract to write: `docs/contracts/notifications-v1.md`.

## Specs

- **S1** Requested (L1, verbatim): «events emitted in the same transaction as the domain change (outbox) → per-recipient
  fan-out with group_key/urgency/link; fixed recipients in stage 1 (vacancy team + responsible; the affected person for
  assignments; the candidate for their events; stakeholders nothing by default and never on teams); types
  application_received, delivery_due_soon (T-24h), delivery_overdue (mandatory), vacancy_assigned/reassigned/team_added
  (mandatory), psychometric_completed/pending, candidate_status_changed, candidate_message_received,
  candidate_test_pending; API GET /v2/me/notifications (grouped, attention pinned, filters by types/job_ids, cursor),
  unread-count (polling ~30 s), read / read-all / unread (undo), facets.»
- **S2** Backend design (counter-proposal, L3):
  - **Capture in the same transaction, one place:** the audit append already runs inside every domain transaction
    for all immediate types. The audit repository's append also inserts a `notification_events` row (same tx) when
    the event type is in the notifiable set — no per-call-site changes. Mapping: VacancyApplicationSubmitted →
    application_received; VacancyTeamCreated → vacancy_assigned (responsible); VacancyResponsibleReassigned →
    vacancy_reassigned; VacancyTeamMemberAdded → team_added; PsychometricAssessmentFinished → psychometric_completed;
    PsychometricInvitationCreated → psychometric_pending (team) + candidate_test_pending (candidate);
    ParticipationMoved / ParticipationDiscarded / ParticipationRecovered → candidate_status_changed (candidate);
    ParticipationDiscarded with a candidate message → candidate_message_received (candidate). Manual candidate adds,
    substate changes and legacy job events do not notify in stage 1.
  - **Fan-out:** an in-process dispatcher (package `notifications/fanout`; the archguard forbids `outbox`/`worker`
    path segments) claims `notification_events` with `FOR UPDATE SKIP LOCKED` in small batches every few seconds,
    resolves recipients from current data (active vacancy_assignments; responsible from vacancy_assignment_functions;
    candidate = participation.candidate_id, manual candidates have no account → skipped; stakeholders never), inserts
    `notifications` rows `ON CONFLICT DO NOTHING`, and marks the event processed. The actor never notifies themselves.
  - **Scheduler:** delivery_due_soon (commitment date tomorrow in America/Mexico_City) and delivery_overdue (date
    passed) for published processes without a `process_delivery_fulfillments` row, every 15 min under a dedicated
    session advisory lock (same pattern as the documents ReconcileScheduler).
  - **Dedupe:** immediate `UNIQUE (recipient_user_id, source_event_id, type)`; scheduled `UNIQUE (recipient_user_id,
    type, draft_id, commitment_date)` (a renegotiated date fires again, the same date never twice).
  - **Data:** migration 00068: `notification_events` (id, company_id, audit_event_id, event_type, payload ids,
    created_at, processed_at) and `notifications` (id, recipient_user_id, company_id null for candidates, type,
    urgency normal|attention, group_key, job_id, participation_id, actor_user_id, link, payload jsonb with ids/enums
    only, created_at, read_at). Retention: 180 days (follow-up purge command like audit-purge).
  - **API (stage 1):** `GET /v2/me/notifications` (cursor, filters `types`, `job_ids`, `unread`; attention-pinned
    section first), `GET /v2/me/notifications/unread-count`, `POST /v2/me/notifications/{id}/read`,
    `POST /v2/me/notifications/{id}/unread`, `POST /v2/me/notifications/read-all` (optional same filters),
    `GET /v2/me/notifications/facets`. Recipient-scoped only: a user never reads another user's rows; company
    members see notifications only while still members of that company.
  - Titles/body text are composed by the frontend from type + ids + names returned by the API (names resolved at read
    time, so renames and corrections show current values).

## Tasks

- T1 — contract `docs/contracts/notifications-v1.md` agreed with the frontend — drafted 7cd5df18, Q1–Q8 decided (L6), frontend approved (L7)
- T2 — N1: migration 00068, notifications domain type table, capture decorator + notifiable map wired in `cmd/api/main.go` (contract §Data model, §Capture, D1–D3, D12) — done: 0f133e1a 6810c32a d12d2139 1f5ed631 c8080b10 b52fbca6 + review correction 07f53042
- T3 — N2: fan-out loop + recipient resolver + group keys (D4–D11) — done: 31d04365 0d8168e8 76b60256 fc9270a4; review advisories fixed 7fe1e88f a7209e44 706387df; verified (L12)
- T4 — N3: scheduler for commitment dates and recruiter deadlines + resolution (D20, D21, Q1, Q7) — done: bdd85ef9 f2473e79 235982da 9e446230 e3339a54; reviewed and verified (L14)
- T5 — N4: member read API + unread-count (D13, D14, D19, D27) — done: a9e48d8a and the 4 commits before it; reviewed and verified (L16)
- T6 — N5: read/unread/read-all + facets (D15–D17, D26) — implemented, uncommitted (L17); pending review
- T7 — N6: candidate route tree (D18) — pending
- T8 — N7: `cmd/notifications-purge` (D22) — pending
- Slice boundary: T1 (contract docs, ~720 lines, 5 commits) is its own review slice.

## Log

- **L1** 2026-11-26, frontend session: request quoted in S1; questions «(1) can you take it after the current one?
  (2) where are those events emitted today, and does an outbox + worker fit; (3) a scheduler for due-soon/overdue (is
  there a runner or Inngest?); (4) dedupe/idempotency.»
- **L2** 2026-11-26, exploration: every immediate type already appends an audit event inside the domain transaction
  (`audit_events/.../catalog.go`; Apply `applications/infrastructure/postgres/v2/store.go:44`, team `draftstore/
  team_write.go:104`, board Move/Discard `board/store.go:301`, `board/discard.go`, psychometrics `finish.go`,
  `invitations.go`, `stage_entry.go`); audit table is append-only (no processed flag possible). No Inngest/queue; one
  in-process scheduler (documents ReconcileScheduler + session advisory lock). Delivery dates:
  `job_draft_delivery_configs.commitment_date` (DATE), fulfilled = `process_delivery_fulfillments` row; API timezone
  America/Mexico_City. Manual candidates have no user. Next migration 00068; no notifications table exists.
  candidate_message_received exists only as the discard message.
- **L3** 2026-11-26, backend counter-proposal (S2) sent to the frontend.
- **L4** 2026-11-26, frontend agreed with S2 plus (verbatim): «1. Server-side grouping: each item in GET
  /v2/me/notifications is a GROUP (`group_key`, `count`, `latest_at`, `sample` with up to 3 subjects (e.g. candidate
  ids/names) and the ids of its notifications or a group token). That way cursor pagination and counts are right.
  Initial keys: application_received → `applications:<job_id>:<local date MX>`; psychometric_completed →
  `psychometrics:<job_id>:<local date>`; the rest without grouping (group = 1 notification). 2. `unread_count` counts
  unread GROUPS (that's what the bell shows, «9+»); also return `unread_notifications` if it's cheap. 3. Group
  read/unread: `POST …/read` and `…/unread` with `{group_keys:[...]}` or `{ids:[...]}` (the «Deshacer» undoes exactly
  what was marked). Keep `read-all` with filters. 4. Each item with `urgency` (normal|due_soon|overdue) and `kind`
  (mandatory|operational|informative); the `attention` section = unread due_soon/overdue, outside the paginated list.
  5. Stakeholders: OK, they receive nothing in stage 1. In stage 3 the owner will be able to enable events for the
  Stakeholder role (all vacancies, in-app only, never by name): leave the recipient resolver ready for a per-role
  rule. 6. facets: counts per type and per job (with title) over the current state (unread/all), for the 07 filter.
  7. Candidate side: same endpoints under the candidate's session (its own scope), only for candidates with an
  account, as you said.» These override S2 where they differ (urgency enum replaces normal|attention).
- **L5** 2026-11-26, contract drafted: `docs/contracts/notifications-v1.md` (Draft — pending frontend review,
  uncommitted). Decisions: D1 capture = audit-port decorator wired in `main.go` (same tx, fail-closed); D2 closed
  notifiable map; D3 events hold ids only (+ discard `has_message` read in tx); D4 in-process fan-out SKIP LOCKED
  2 s/100; D5 rule-based resolver with stage-3 `role:` seam; D6 actor excluded, no stakeholders, candidates with
  account, membership at fan-out and read; D7 candidate_status_changed only on visible status change; D8 discard with
  message → only candidate_message_received; D9 `vacancy_team_added`; D10 reassigned → new responsible only; D11
  server-side groups (`applications:`/`psychometrics:<job>:<MX date>`, else `n:<id>`); D12 kind/urgency derived from
  type; D13 attention outside pagination, filters apply, cap 20; D14 unread_count = groups + unread_notifications;
  D15 read/unread by group_keys|ids, undo by `marked_at`; D16 read-all with types/job_ids/before; D17 facets = group
  counts per type/job; D18 routes `/v2/me/company/notifications…` (members, owner/recruiter/stakeholder gate) and
  `/v2/me/notifications…` (candidates); D19 names/titles at read time, candidate names only with current access;
  D20 scheduler 15 min, lock `notif_sc`, resolves stale delivery items (`resolved_at`); D21 dedupe uniques; D22
  retention 180 d + purge command; D23 reads not audited; D24 texts by frontend; D25 no backfill; D26 foreign ids
  ignored, no 404; D27 keyset cursor over groups bound to filters. Open: Q1 paused/closed-continue in scheduler
  (rec paused yes, closed no); Q2 notify previous responsible (rec stage 3); Q3 group psychometric_pending (rec
  yes, `psychometrics_pending:<job>:<date>`); Q4 message notification vs message-read (rec independent); Q5 late team
  members get past delivery items (rec no); Q6 limits 20/50/20/3/50 (rec ok); Q7 recruiter deadlines (rec stage 3);
  Q8 overdue flood on first run (rec accept). Slices N1–N7. Next: frontend review.
- **L6** 2026-11-26, user answers to Q1–Q8: Q1 paused yes, closed no; **Q2 notify the previous responsible from
  stage 1** («Sí, desde etapa 1»); Q3 group psychometric_pending by job and day; Q4 independent; Q5 no; Q6 limits as
  drafted; **Q7 recruiter deadlines in stage 1** («Etapa 1»); Q8 accept. Contract updated: new types
  `vacancy_unassigned` (relation `previous_assignee`) and `assignment_deadline_due_soon` / `_overdue` (scheduler over
  active assignments' `recruiter_deadline`, assignee only, in attention); D10/D11/D13/D20, data model, recipients,
  kinds, scheduler, payload/link and N3 adjusted. Next: frontend review of the contract.
- **L7** 2026-11-26, frontend review of 73355dc3: OK to the shapes with fixes — 14 types in filters/limits; attention
  in §GET lists the four deadline types; attention overflow: only the ≤ 20 returned are excluded from `items`, the
  rest appear in normal order; `from_user` / `to_user {user_id, name}` resolved at read time on `vacancy_reassigned` /
  `vacancy_unassigned`; `participation_id` = `/v2/me/applications` item id (no extra field); reassignment `reason`
  enum listed. Link routes and the three new texts confirmed by the frontend. Contract approved; next N1.
- **L8** 2026-11-26, N1 (T2) by worker: migration `00068_notifications.sql` (contract §Data model verbatim, Down drops
  both tables) 0f133e1a; `notifications/domain` type table (14 types: kind, urgency, recipient kind, relation, group
  rule, scheduled) 6810c32a; closed notifiable map with §Capture id sources + `BuildEvent` (missing ids →
  `ErrMissingID`, fail-closed) and catalog-closure test (keys in the audit catalog, company-scoped, every read
  metadata key in the type's closed set) d12d2139; `notifications/capture.Decorator` (inner Append, then one
  `notification_events` row in the same tx; `has_message` read for ParticipationDiscarded; errors wrapped
  `capture notification event …`) wired around both production audit adapters in `cmd/api/main.go` (helpers now take
  the audit port interface), sqlc `db/queries/notifications.sql` 1f5ed631; integration tests (disposable
  `draft_test_mig_*` DB: migration CHECKs/dedupe/down-up, one row per notifiable type incl. system actor and discard
  with/without message, nothing for non-notifiable types, unique and FK capture failures roll back audit row + domain
  write) c8080b10. RED observed: domain and capture unit tests failed to build before the code (undefined symbols /
  no package). Evidence: `make test PKG='./cmd/api/ ./internal/tools/archguard/ ./internal/features/notifications/...
  ./internal/db/...'` ok (4 packages); `make test PKG=./db/migrations/` ok; `go vet -tags=integration` clean.
  **Not run:** `make test-integration PKG=./internal/features/notifications/...` — the worktree has no `backend/.env`
  (Makefile sources it), so the migration/capture/rollback integration tests are unverified. Deviation: none from the
  contract; payload fields absent from metadata are omitted rather than stored empty. Next: run the integration
  target with an env, then N2.
- **L9** 2026-11-26, N1 closed. Integration on an isolated container (`peopleflow-notif-test`, tmpfs, 127.0.0.1): notifications
  capture 7 + domain 8 tests pass, none skipped. Native review `review-c525703930525820` (risk, resilience, reliability):
  correction R3/R4 — absent optional ids (participation/subject) are captured as NULL instead of failing the domain
  write; present-but-malformed ids still fail (07f53042, RED observed); targeted validator approved; acknowledged.
  Independent verify: items 1–4 pass (migration, map/type table, decorator, wiring + all 9 emitters supply ids); unit
  suite 124 packages ok; cmd/api integration 666 pass / 6 fail, all outside N1 by their errors (geo_countries not
  seeded → test-order-dependent FK/400; `TestRun_StartsOnlyWithValidExplicitMode` fails from the sourced dev .env
  IDENTITY_* vars) — not re-run on base. Follow-ups for N2: copy actor_user_id only for ActorType user (FK risk);
  count/log capture failures distinctly; test the StructuredMetadata branch; cmd/api harness uses the wrapped audit
  repo; seed geo_countries in the harness; deploy N1 together with N2 (events accumulate otherwise).
- **L10** 2026-11-26, N2 (T3) by worker, uncommitted in the worktree (the worker policy forbids staging/committing; the parent
  commits). `notifications/fanout`: `Planner` (ordered `(type → relation)` rules = `Stage1Rules()` from the type table;
  relations team / assignee / previous_assignee / candidate; reserved `RelationRole` seam returns
  `ErrRelationNotEnabled`; actor excluded; de-duplicated per type, first rule gives the reason; NULL subject /
  participation → nobody; malformed `from_user_id` → nobody), visible-status rule through an injected `VisibleStatus`
  (D7: Moved notifies only when the status changes, payload `status` = new; Recovered always; Discarded → `closed`, with
  `has_message` only `candidate_message_received`, D8), contract payloads per type (ids/enums only), `group_key` per D11
  with the America/Mexico_City date of `occurred_at` (tzdata embedded), `n:<uuid v7 id>` otherwise. `Processor.Tick`:
  up to 100 events per tick, each claimed `ORDER BY occurred_at, id LIMIT 1 FOR UPDATE SKIP LOCKED` in its own tx
  (resolve + `INSERT … ON CONFLICT (recipient_user_id, source_event_id, type) DO NOTHING` + `processed_at`), events
  already tried in the tick are skipped (a failing event is retried on the next tick and never blocks later ones); on
  error rollback, then `attempts+1` in a separate statement, at 10 `failed=true, processed_at=now()`; logs carry
  event type + id only. Directory SQL (`db/queries/notifications.sql`, sqlc regenerated, `sqlc diff` clean): team =
  active assignments of non-stakeholder members of the event company with `companies.deleted_at IS NULL`; assignee =
  same for the subject; previous assignee = non-stakeholder member; candidate = `process_participations.candidate_id`
  of the participation on that job. `Loop` (2 s, once at start, panic/err logged without content) started/stopped in
  `cmd/api/main.go` via `cmd/api/notifications_fanout.go` (stop waits, runs before `pool.Close`); `candidateVisibleStatus`
  composes `CandidateStatus` with `participationRules.InitialStage` there so notifications import no sibling feature
  (archguard). N1 follow-ups: `actor_user_id` copied only for `ActorType user`; capture failures counted
  (`Decorator.Failures()`) and logged `notification capture failed` with audit type + audit event id only; test for
  the StructuredMetadata branch. RED observed: actor test failed (`actor type "system": actor_user_id=…`), capture
  test and planner tests failed to build (undefined `WithLogger` / `Rule`), cmd/api tests undefined
  `candidateVisibleStatus` / `startNotificationFanOut`. Not RED-first: `process.go` / `loop.go` were written before
  their tests; the integration tests were instead checked by mutation of the generated SQL (each restored, file
  compared): removing the in-tick skip → `claimed=11` fail; dropping the stakeholder filter → resolver cases fail;
  removing `ON CONFLICT` → re-processing records an attempt instead of being idempotent. Evidence: `make test
  PKG='./internal/features/notifications/... ./cmd/api/'` ok (4 packages); `make test PKG=./internal/tools/archguard/`
  ok; `go vet -tags=integration ./internal/features/notifications/...` clean; `DRAFT_TEST_DATABASE_URL=… make
  test-integration PKG=./internal/features/notifications/...` all pass, none skipped (capture 8, domain 10, fanout 11:
  recipients from current data incl. stakeholder / ex-member / ended assignment / actor / foreign participation,
  SKIP LOCKED with three concurrent txs + two racing processors over 62 events claimed exactly once, retry → failed
  after 10 with log redaction, idempotent re-processing). Deviation: claim is one event per tx (≤ 100 per tick) rather
  than one 100-row locking batch, to honour «per event one tx» with row locks held. Not covered against Postgres: a
  real manual participation (fixture needs geo seeds); covered by the resolver unit test and the no-row path. Open from
  L9 (not N2 scope): cmd/api harness on the wrapped audit repo, geo_countries harness seed; deploy N1 with N2.
- **L11** 2026-11-26, N2 native review approved with advisories; fixed by worker (uncommitted; parent commits). (1) Poison
  event: `processNext` recovers a panic per event (deferred rollback still runs), records it as a failed attempt with
  step `panic`, value dropped; later events in the tick still process. (2) Retry budget: `notification_events.next_attempt_at
  timestamptz NULL` added in place to unreleased 00068 (pending index `INCLUDE (next_attempt_at)`); claim requires
  `next_attempt_at IS NULL OR <= now()`; a failure sets `now() + min(30 s · 2^(n−1), 30 min)` from the stored count
  (30 s … 30 min, ~2 h over 10 attempts; base 30 s rather than the review's example 2 s, which would span ~34 min),
  NULL when given up. (3) Loop test deterministic and race-free (atomics, per-tick completion channel, no cancel
  race). (4) Candidate rows store `actor_user_id = NULL`. (5) The «participation of another job» case uses a real
  organic participation on a second job. (6) Value-free classifier: tick and attempt logs carry `step`
  (begin/claim/decode/plan/insert/mark/commit/panic) and `sqlstate` (pgconn code), never the message. Contract D4,
  §Data model and §Scheduler fan-out paragraph updated. RED observed per item: (1) `panic: poison …` escaped `Tick`;
  (2) `column "next_attempt_at" does not exist (SQLSTATE 42703)` in the retry and not-yet-due tests; (3) the committed
  loop test under `-race` → `WARNING: DATA RACE`; (4) `row ids: … RecipientKind:candidate … ActorUserID:<actor>`;
  (5) mutation `process_id = $2 OR true` in the generated query → only «participation of another job» fails
  (restored, `cmp` identical); (6) build failure, undefined `classify` / `stepErr`. GREEN: see the return evidence.
- **L12** 2026-11-26, N2 closed. Native review `review-f86e275fc0c9abf1` approved (advisories fixed in a7209e44/7fe1e88f).
  Independent verify: claim/process, recipients (11 immediate types), visible status/payloads, group keys all pass;
  integration 33 pass/0 skip, unit 125 packages ok, fanout -race ok, sqlc diff clean. Follow-ups: double-attempt race
  between rollback and recordFailure across instances (earlier give-up only); deleted company and manual participation
  not covered against Postgres; integration tests not run under -race.
- **L13** 2026-11-26, N3 (T4) by worker, uncommitted (parent commits). `notifications/schedule`: `Today` (calendar date in
  America/Mexico_City, tzdata embedded) + `Classify` (deadline < today → overdue; today / today+1 → due soon; later →
  nothing); `Runner.RunOnce` (injected clock) = one tx: list delivery recipients (process `process_status='active' AND
  status IN ('published','paused')`, `job_draft_delivery_configs.commitment_date ≤ today+1`, no
  `process_delivery_fulfillments` row; team = active assignment of a non-stakeholder member of the process company,
  company not deleted) and active assignments with `recruiter_deadline ≤ today+1` (same process filter, assignee
  still a non-stakeholder member, open function via LEFT JOIN), insert each row (uuid v7, `group_key n:<id>`, actor
  and source NULL, reason team / assignee, payload `{commitment_date}` / `{assignment_id, function, commitment_date}`)
  `ON CONFLICT … notifications_dedupe_scheduled DO NOTHING`, then one `UPDATE … resolved_at = now()` on open deadline
  items when the process is no longer active published/paused (closed with any process value, finished or gone), has a
  fulfillment row, the delivery date differs / is cleared, the assignment (matched by `payload.assignment_id`, same job
  and user) ended or its deadline differs / is cleared, or — for due soon — an overdue row exists for the same recipient,
  job and date (inserted earlier in the same run, so supersession is immediate). `AdvisoryLock` (key
  `0x6e6f7469665f7363`, dedicated pooled connection, release on a non-cancelled context, connection closed when the
  release is unconfirmed; copied from the documents pattern, no sibling import) and `Scheduler` (once at start, then
  every 15 min, panic/err recovered; logs `notification schedule finished|skipped|failed` with counts, `step`
  (lock/begin/list_delivery/list_assignment/insert/resolve/commit) and SQLSTATE only). Composition
  `cmd/api/notifications_schedule.go`, started in `main.go` right after the fan-out and stopped (waited) by defer before
  `pool.Close`. sqlc: `ListScheduledDeliveryRecipients`, `ListScheduledAssignmentDeadlines`,
  `InsertScheduledNotification`, `ResolveStaleScheduledNotifications`. RED observed: schedule unit + integration tests
  and the cmd/api test failed to build (undefined `Today`, `Window`, `Classify`, `Result`, `startNotificationSchedule`,
  `newNotificationScheduler`). Behavioural evidence for the integration tests by mutation (each restored, checksum
  identical): UTC instead of MX date → MX-boundary test fails; stakeholder filter dropped → boundary test fails;
  `paused` dropped → process-filter test fails; supersede clause inverted → overdue-supersedes test fails;
  `ended_at IS NULL` dropped from resolution → stale-items test fails; delivery-date comparison dropped → renegotiation
  test fails; `ON CONFLICT DO UPDATE` → dedupe test fails; lock ignores `acquired=false` → lock-held test fails.
  Evidence: `DRAFT_TEST_DATABASE_URL=… make test-integration PKG=./internal/features/notifications/...` 46 pass / 0 fail /
  0 skip (capture 8, domain 10, fanout 15, schedule 13); `make test PKG='./internal/features/notifications/... ./cmd/api/
  ./internal/tools/archguard/'` ok (6 packages); `go tool sqlc diff` clean. Interpretations for review: Q5 is enforced by
  dedupe + run-time recipients only — a member who joins while a deadline is open gets the current window's item on the
  next run (e.g. overdue), never items for dates or windows already fired; a recipient who leaves the team keeps their
  open delivery item (not listed as a resolution cause); a resolved item never re-fires for the same (recipient, type,
  job, date) — e.g. a date renegotiated back, or a closed process reopened with the same date; `function` is omitted
  from the payload when the assignment has no open function. Not run: `-race` on the schedule package, cmd/api
  integration suite.
- **L14** 2026-11-26, N3 closed. Native review `review-cef39c3ad277c5fa` approved; advisory R3-pg-locks-cluster-wide fixed
  (e3339a54, filter by database and key, checked against a held bigint lock). Independent verify: lock/lifecycle, MX date
  rule, recipients, resolution and commands pass (integration 46/0/0, unit 126 ok, schedule -race ok, sqlc clean).
  Accepted behaviours: a leaver keeps an open delivery item — N4/N5 must gate reads by current membership and vacancy
  access (D6/D19); deleted company / role change to stakeholder do not resolve items (same read gate); a resolved item
  does not re-fire for the same (recipient, type, job, date); late joiners get the current window's item (Q5).
  Follow-ups: lock failure paths untested against Postgres; deleted-company filter untested; integration not under -race.
- **L15** 2026-11-26, N4 (T5) by worker, uncommitted (parent commits). `notifications/inbox`: `ParseQuery` (state all|unread;
  `types` comma list of the 14 domain types, ≤ 14; `job_ids` comma list of UUIDs, ≤ 20, normalised lowercase; `limit` 1–50,
  default 20; a repeated parameter → `duplicate`; unknown parameters ignored; every failure → `invalid_filter` with
  `fields[{field, code: invalid|too_many|duplicate}]`, sorted; the cursor is checked only after the filters) and the
  opaque cursor (base64url `{v, at (µs), gk, f}` with `f` = hash of state/types/job_ids, exact re-encoding; other filters or
  undecodable → `invalid_cursor`; limit may change). `Store.List` = one REPEATABLE READ read-only tx: attention (first page
  only: unread unresolved deadline items of the member scope, honouring types/job_ids, `created_at DESC, id DESC`, ≤ 20,
  `attention_total` via `count(*) OVER ()`; `null`/`null` with a cursor), groups (same scope and filters minus the same top-20
  attention ids recomputed on every page, so only those are excluded — overflow appears in normal order; `GROUP BY group_key,
  type, job_id`; count / unread (`read_at IS NULL AND resolved_at IS NULL`) / latest_at / first_at / resolved = all rows
  resolved; latest row by LATERAL; `state=unread` → groups with an unread member; keyset `(latest_at, group_key) <` cursor,
  `limit + 1`), samples (≤ 3 newest distinct participations per group), read-time resolution and the unfiltered counters.
  Resolution (D19, L14): job title = current draft title (`null` when the job is gone or untitled); `can_open` = owner (live
  gate role) or an active assignment of the caller on the job; sample names (company correction, else manual / account name)
  only with `can_open`; `latest.actor` and `from_user` / `to_user` `{user_id, name}` from current users (deleted → name
  null); `vacancy_unassigned` link null without `can_open`; items stay. kind/urgency from the domain table; links per
  §Endpoints. `Store.UnreadCount` = unread groups + rows of the member scope. `Handler` (scope only from the gate's
  CompanyContext; catalog writers only) composed in `cmd/api/notifications_read.go`, wired in `main.go`
  (`notificationsHandler`) and routed in `router.go` behind `NoStore, requireAuth, requireDocumentReader`: `Get
  /v2/me/company/notifications`, `Get /v2/me/company/notifications/unread-count`. Reads write nothing and are not audited
  (D23, asserted). sqlc (`go tool sqlc generate`): `ListMemberNotificationAttention`, `ListMemberNotificationGroups`,
  `ListMemberNotificationSamples`, `ListNotificationJobs`, `ListNotificationCandidateNames`, `ListNotificationUserNames`,
  `CountMemberUnreadNotifications`. RED observed: inbox unit tests failed to build (undefined `Query`, `Link`, …); the cmd/api
  HTTP tests failed to build (unknown field `notificationsHandler`, undefined `newNotificationsHandler`). Tests:
  inbox unit (defaults, normalisation, ignored params, 18 invalid cases, cursor bound to filters, link per type) and
  `cmd/api/notifications_read_integration_test.go` (disposable `draft_test_mig_*` DB from DRAFT_TEST_DATABASE_URL only, real
  router + auth + documents read gate): exact response shape + unread-count, filters/validation/cursor errors, pagination
  with 22 deadline items (attention 20/22 first page only, 2 overflow in items, a seen group bumped mid-walk never repeats),
  scope isolation (other user, same user in another company, candidate rows, outsider, stakeholder empty, 401, candidate
  403 `forbidden`, deleted company 403 `company_inactive`), names gated after leaving the team (renames / corrections /
  title current; owner sees names). Mutations (generated SQL / store, each restored, sha256 identical): no attention
  exclusion → shape, filters and overflow tests fail; member/company scope dropped in groups + latest → scope test fails;
  counter unscoped by company → scope test fails; access gate forced open → names test fails (dropping scope only in the
  grouped CTE survives: the LATERAL latest re-applies the scope). Evidence: `DRAFT_TEST_DATABASE_URL=… make
  test-integration PKG='./internal/features/notifications/...'` 52 pass / 0 fail / 0 skip (inbox 6 new); `… make
  test-integration PKG=./cmd/api/ RUN='^TestNotificationsRead_'` 5 pass; `make test PKG='./internal/features/notifications/...
  ./cmd/api/ ./internal/tools/archguard/'` all ok except the expected `TestRouteTopology_ExactRegistrations` (exactly the two
  new routes missing from its `want`; `main_test.go` is outside the worker surface, the parent adds them); `go tool sqlc diff`
  clean. Interpretations for review: a candidate *actor* (application_received / psychometric_completed are acted by the
  candidate) is gated like a sample name; `psychometric_pending` groups (Q3) link like the other grouped types
  (`vacancy_candidates`, single member → `participation`); a stakeholder (or a member demoted to stakeholder) passes the gate
  and sees any member rows of the company with candidate names hidden (no assignment, not owner); colleagues' names are not
  gated by membership. Not done: contract status line (docs/contracts outside the surface); `-race`; cmd/api full suite.
- **L16** 2026-11-26, N4 closed. Native review `review-484f9ddb299603a6` approved (advisories: unused SampleLimit, attention
  selection duplicated in two queries, attention recomputed per page, positional helpers, untested 500 paths). Independent
  verify: scope, name/access gating, shapes vs §Endpoints, no audit/PII all pass; notifications integration 52/0/0,
  TestNotificationsRead_ 5/5, unit 127 ok, sqlc clean. Accepted: a member demoted to stakeholder keeps seeing their old
  member rows with candidate names hidden; from_user/to_user names come from users.full_name; missing ids omit the field;
  empty `types=` → invalid_filter. Routes added to TestRouteTopology_ExactRegistrations by the parent.
- **L17** 2026-11-26, N5 (T6) by worker, uncommitted (parent commits). `notifications/inbox`: `ParseMark` (strict body: one JSON
  object, unknown member / wrong JSON type / trailing data → `invalid_request`; exactly one of `group_keys` | `ids` | (unread only)
  `marked_at`, `null` = absent; `validation_error` fields: zero → `body: required`, several → `body: invalid`, `marked_at` on read →
  `marked_at: not_allowed`, `[]` → `empty`, > 100 keys / > 200 ids → `too_many`, malformed → `invalid`; group keys accepted only in
  the D11 shapes of the type table (`n:<uuid>`, `<grouped prefix>:<uuid>:<YYYY-MM-DD>`), UUIDs lowercased, lists sorted and
  de-duplicated), `ParseReadAll` (all optional, empty body = `{}`; `types` 14 domain types ≤ 14, `job_ids` ≤ 20, `before` RFC 3339;
  failures reported together), `ParseFacetsQuery` (`state` all|unread, default unread, other params ignored; `invalid_filter`), body
  cap 64 KiB (`payload_too_large`). `Store.Read` / `Unread` / `ReadAll`: one UPDATE each (`statement_timestamp()` in a CTE, written
  to `read_at` by read / read-all and returned as `marked_at` with affected rows and distinct groups) plus the scope counters in the
  same tx. read and read-all touch only unread rows (`read_at IS NULL AND resolved_at IS NULL`), unread only read unresolved rows
  (a resolved row stays read), `marked_at` reverts exactly `read_at = marked_at` in the caller's scope; foreign ids / keys never
  match the scope (D26, 200 with 0). read-all: types / job_ids, `created_at <= COALESCE(before, stamp)`, attention included.
  `Store.Facets` (read-only RR snapshot): groups (attention included) per type (count DESC, type) and per job (count DESC, current
  draft title, untitled last, job id; ≤ 50; `jobs_total`), unread = groups with an unread member. Handler `Read`, `Unread`,
  `ReadAll`, `Facets` routed under the N4 member group (`NoStore, requireAuth, requireDocumentReader`); not audited (D23, asserted).
  N4 review cleanup: samples use `sqlc.arg('sample_limit')` = `SampleLimit`; the attention selection exists only in
  `ListMemberNotificationAttention` with `attention_types` = `AttentionTypes()` (types with urgency ≠ normal in the domain table);
  `Store.List` runs it on every page and passes its ids as `exclude_ids` to `ListMemberNotificationGroups` (the CTE copy is gone;
  the section is still returned on the first page only). Four routes added to `TestRouteTopology_ExactRegistrations`. sqlc:
  `MarkMemberNotificationsRead`, `MarkMemberNotificationsUnread`, `MarkAllMemberNotificationsRead`,
  `ListMemberNotificationFacetTypes`, `ListMemberNotificationFacetJobs`. RED observed: inbox unit tests failed to build (undefined
  `InvalidBody`, `MarkRequest`, `ParseMark`, …); the new HTTP tests (`cmd/api/notifications_write_integration_test.go`) ran and
  failed with `404 page not found` on every new route. Tests: read/unread/undo (group read stamps one timestamp; a new row in the
  group and a second batch by ids, then undo by `marked_at` reverts exactly the first batch; idempotent; resolved rows untouched;
  attention item marked; colleague's same-key group untouched), validation (22 bodies incl. 413, facets state errors), read-all
  (filters, `before`, undo, default now excludes a row created after the request), facets per state ignoring filters (gone job →
  title null, 54 jobs capped at 50 with order), scope isolation (other user, same user in another company, candidate rows, other
  user's `marked_at`, stakeholder 0, 401, candidate 403 `forbidden`, deleted company 403 `company_inactive`). Mutations of the
  generated SQL (each restored, sha256 identical): scope dropped in read → undo + scope tests fail; undo `>=` → undo test fails;
  attention exclusion removed → 3 N4 read tests fail; `before` ignored → read-all test fails; unread touching resolved → undo test
  fails. Evidence: `DRAFT_TEST_DATABASE_URL=… make test-integration PKG=./internal/features/notifications/...` 58 pass / 0 fail /
  0 skip (inbox 6 new); `… PKG=./cmd/api/ RUN='^TestNotifications'` 10 pass (5 N4 + 5 N5); `make test
  PKG='./internal/features/notifications/... ./cmd/api/ ./internal/tools/archguard/'` 7 ok; `go tool sqlc diff` clean. Interpretations
  for review: the validation `fields[].code` values above (contract names no codes); empty body allowed on read-all only; empty
  `types` / `job_ids` arrays in read-all → `validation_error empty` (contract «empty array»); `marked_at` serialised RFC 3339 with
  trailing zeros trimmed (µs precision, round-trips); `unread` by `marked_at` matches the exact µs; facets `types` ordered count
  DESC, type. Not done: contract status (outside surface), `-race`, cmd/api full suite.
