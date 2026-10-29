# Psychometric tests v1 (employer-configured, candidate-answered)

Status: **agreed with the backend (2026-10-29, final check @fc9f00ce + nits n1–n3), pending user approval of
wording**. Includes R2-1…R2-10 and the exact-integer band/display-index clarification. Nothing is released until the user approves the wording. Frontend branch `feat/psychometric-tests`. Only the frontend edits
this file. Feature document: `odd/tasks/psychometric-tests.md` (S1–S12, decisions L8–L15). Content (items, keys,
bands, competencies, texts, questions): `docs/psychometrics/*-v1.md`. Backend capability evidence and proposals folded
in from the backend session (feature document L9).

## Purpose

An optional, per-vacancy personality assessment whose result is read against the job, not against a population:

- The vacancy declares which competencies matter and how much (job psychometric profile).
- The candidate answers a 60-item IPIP-based questionnaire (public domain, our corrected Mexican Spanish text).
- The result is a band per facet (by meaning of what the candidate stated), a fit per competency (`fit.alineado`,
  `fit.explorar`, `fit.atencion`, or null), focus areas and a selected set of interview questions. Never «apto / no apto».
- The assessment **never rejects, discards or moves** anyone (S6, INT-22). A human always decides (LFPDPPP art. 26).
- No AI in v1 (D10).

## Ownership split

- **Backend** owns the versioned content artifact: order, keys, facet ↔ competency relations, cut points, quality,
  fit/focus rules, interpretation library, interview bank, notice and deterministic selection. It stores raw answers,
  consent, telemetry and immutable results/comparisons. Candidate clients receive attention text as ordinary prompts,
  never their identity, expected answers, keys or facet membership.
- **Frontend** renders stored resolved interpretation and question text (including STAR), not a local id-to-text
  mapping for those banks. Band, fit and tier labels remain frontend-side by canonical id.
- `content_version = psychometrics.content.v1`; `scoring_version = psychometrics.scoring.v1`. These are unreleased
  drafts. An administered item edit bumps **both**; other version triggers follow the content README. Freeze only
  after user wording approval. Pin both versions at invitation creation; never silently rescore or rewrite old results.
- Wire ids are content ids verbatim, with no aliases: `band.low|band.medium|band.high`,
  `importance.clave|importance.importante|importance.no_relevante`, `fit.alineado|fit.explorar|fit.atencion` (+ null),
  `focus.adjacent|focus.distant|focus.quality`, `tier.sin|tier.algunas|tier.relevantes`, and the canonical
  `facet.*`, `signal.*`, `attention.N`, `item.ipip.N`, `comp.*`, `lib.*`, `q.*` ids. Definitions in
  `docs/psychometrics/` win; wildcard notation denotes a namespace, not a literal id.

## Data model

```jsonc
// Job psychometric profile (per vacancy; employer-only)
{
  "version": "2",                  // decimal save counter, "0" when never saved; ETag separate and opaque ("pp1-…")
  "enabled": false,                // S1: off by default
  "test": "ipip60-mx",             // only value in v1 (60 IPIP items, Mexican Spanish)
  "confirmed": false,             // distinct from enabled; explicit recruiter confirmation
  "confirmed_at": null,           // server RFC 3339 timestamp when confirmed
  "competencies": [                // exactly 7, one per catalog id; example entry only
    { "competency_id": "comp.organizacion", "importance": "importance.clave",
      "desired_band": "band.high", "rationale": "Dar seguimiento a entregas semanales.",
      "task": "Revisar pendientes y confirmar el cierre de cada entrega." }
  ],
  "auto_send_stage_ids": ["uuid"], // S10: stages whose entry creates an invitation; 0..n; current pipeline, not exit/retired
  "expires_in_days": 7             // 1..30, default 7 (U2), applies to invitations created after the save
}

// Invitation (one participation × one test)
{
  "id": "uuid",
  "participation_id": "uuid",
  "test": "ipip60-mx",
  "content_version": "psychometrics.content.v1",
  "scoring_version": "psychometrics.scoring.v1",
  "status": "created" | "in_progress" | "finished" | "expired" | "revoked", // expired computed at read time
  "origin": "manual" | "auto",
  "created_by": { "id": "uuid", "full_name": "string" } | null,   // null when origin = auto
  "trigger_stage_id": "uuid | null",
  "created_at": "RFC 3339",
  "expires_at": "RFC 3339",
  "consented_at": "RFC 3339 | null",
  "answered_count": 0,             // 0..total_count
  "total_count": 63,               // pinned content: 60 personality + 3 attention items
  "finished_at": "RFC 3339 | null",
  "last_reminded_at": "RFC 3339 | null",
  "reminder_count": 0
}

// Result (employer-only, finished invitations; arrays below illustrate entries, not complete catalogs)
{
  "invitation_id": "uuid",
  "content_version": "psychometrics.content.v1",
  "scoring_version": "psychometrics.scoring.v1",
  "finished_at": "RFC 3339",
  "facets": [{ "facet_id": "facet.c3", "sum": 16, "band": "band.high" }], // exactly 15
  "competencies": [{ "competency_id": "comp.organizacion",
    "facet_ids": ["facet.c2", "facet.c5"], "oriented_sums": [9, 10],
    "oriented_sum": 19, "facet_count": 2, "index": "9.5", "band": "band.low" }], // exactly 7
  "interpretations": [{ "id": "lib.organizacion.low", "competency_id": "comp.organizacion",
    "band": "band.low", "work_text": "…", "strengths_text": "…", "development_text": "…" }], // exactly 7
  "quality": {
    "tier": "tier.algunas", "partial": false,
    "signals": [
      { "id": "signal.attention", "severity": "mild", "counts": { "misses": 1, "total": 3 } },
      { "id": "signal.long_string", "severity": "none", "counts": { "run": 6 } },
      { "id": "signal.fast", "severity": "none", "counts": { "fast_count": 11, "total": 60 } },
      { "id": "signal.changes", "severity": "none",
        "counts": { "value_changes": 1, "clears": 1, "reanswers": 1, "total": 3 } }
    ]
  },
  "latest_comparison": {
    "id": "uuid", "profile_version": "2", "created_at": "RFC 3339",
    "content_version": "psychometrics.content.v1", "scoring_version": "psychometrics.scoring.v1",
    "competencies": [{ "competency_id": "comp.organizacion",
      "facet_ids": ["facet.c2", "facet.c5"], "oriented_sums": [9, 10],
      "oriented_sum": 19, "facet_count": 2, "index": "9.5", "band": "band.low",
      "desired_band": "band.high", "importance": "importance.clave", "direction": "below", "fit": "fit.atencion" }],
    "focus_areas": [
      { "type": "focus.distant", "competency_id": "comp.organizacion", "observed_band": "band.low",
        "desired_band": "band.high", "importance": "importance.clave", "fit": "fit.atencion", "profile_version": "2" },
      { "type": "focus.quality", "competency_id": null, "tier": "tier.algunas",
        "signal_ids": ["signal.attention"], "routed_competency_id": "comp.organizacion" }
    ],
    "guide": [{ "question_id": "q.organizacion.distant.1", "competency_id": "comp.organizacion",
      "text": "…", "good_answer_checklist": "…", "observed_band": "band.low", "desired_band": "band.high",
      "importance": "importance.clave", "fit": "fit.atencion", "selector": "distant",
      "originating_focus_type": "focus.distant", "signal_ids": [] }] // max 8, resolved text includes STAR
  },
  "comparisons": [{ "id": "uuid", "profile_version": "2" }] // all snapshots, creation order
}
```

Profile validation: exactly the seven catalog ids (including `comp.presion`), no missing/duplicate/unknown ids.
Importance is one of the three canonical ids. `importance.no_relevante` requires null desired_band, null rationale and
null task (user decision L25); otherwise one canonical band is required. To confirm, every `importance.clave` or
`importance.importante` entry requires a job-related `rationale`, 1..1000 characters after trim; `task` is required
for `importance.clave`, 1..300 characters after trim, otherwise null (a task on `importance.importante` →
`not_allowed`). On clave/importante entries `rationale` is always a string: `""` in a draft, `null` → `invalid`
(L28); non-null values on `importance.no_relevante` → `not_allowed`.
Unconfirmed drafts may have empty rationale/task. `confirmed_at` is server-owned and null when unconfirmed; an edit
to competency requirements requires explicit reconfirmation in that save or clears confirmation. `enabled` only
controls invitation creation; an enabled unconfirmed profile never blocks assessment completion. Default entries are
`importance.no_relevante`, desired_band null, rationale null and task null. Unconfirmed → bands and exploratory
guide only, fit/direction null, no gap focus; confirmed and enabled are independent.

Scoring: four scored items per facet, negative item = `6 − value`, sum 4–20; facet bands 4–9 / 10–14 / 15–20.
For each competency orient each facet (`s` positive, `24 − s` negative), store facet ids and sums in catalog link order.
The first six competencies have n=2; `comp.presion` has n=3 (`facet.n1`, `facet.n2`, `facet.n6`, all negative).
Let S be the integer sum of oriented sums: **low if S < 10n, medium if S < 15n, else high**. Thus for n=2 the integer
ranges are 8–19 / 20–29 / 30–40; for n=3, 12–29 / 30–44 / 45–60. `index` is display-only S/n rounded half-up to
one decimal place as a string (e.g. pressure 29/3 → "9.7", still low). Never classify using rounded index.
There are no domain scores, percentiles, overall fit or pass/fail. Finish requires all 63 positions; no prorating.

Comparison rules follow the content: equal bands → fit.alineado; one-band gap → fit.explorar; two-band gap →
fit.atencion for importance.clave, otherwise fit.explorar. No relevante or unconfirmed → null fit. Direction is
below/above for nonzero confirmed relevant gaps, otherwise null. Gap focus has all fields illustrated above;
quality focus is the separate tagged shape with null competency_id, tier, triggered signal ids and routed competency.
Order gaps by Clave first, distance descending, competency id ascending; quality last. Route quality to the most
important relevant competency (id ascending for ties), or comp.organizacion if none. It is not a competency gap.

At finish store immutable bands, sums, library id/text snapshots and quality, plus an initial comparison/guide using
the confirmed profile at that moment (profile_version null if unconfirmed). Each comparison stores its profile snapshot
and pinned content/scoring versions. GET returns the latest stored comparison and all comparison ids/profile_versions;
**never recompute on read**. Profile changes affect future results only. An explicit comparison POST creates a new
snapshot against the current confirmed profile, preserving every prior comparison. Bands and library selection/text
never change. The result's latest_comparison.competencies carries the complete per-competency shape including fit.

The backend stores and returns resolved question text **including the fixed STAR follow-up**, good-answer checklist,
selection metadata and ordered ids, maximum 8 questions, using the content's deterministic block rules (Clave before
Importante, distance descending, id ascending; quality last with a reserved block). Interpretation ids and all three
text sections are snapshots, with the required introductory and hypothesis sentences preserved. The frontend renders
stored text. No live profile or mutable bank lookup changes an existing report.

Quality: every signal has severity `none|mild|strong|unknown` and the counts shape above; unavailable counts are null,
not zero. `partial` is true if any severity is unknown. Tier uses known severities only: any strong or ≥2 mild →
tier.relevantes; exactly 1 mild → tier.algunas; otherwise tier.sin. Attention: 1 miss mild, 2–3 strong, out of 3.
Long-string: 7–11 mild, ≥12 strong across raw personality answers, ignoring attention. Fast: <2000 ms on 12–29 of 60
mild, ≥30 of 60 strong; unknown unless all 60 personality items have valid elapsed values. Changes: total ≥30 mild,
never strong alone; total = value_changes + clears + reanswers. These are provisional, not deception verdicts;
quality never changes bands or fit. Integer thresholds and the run-length scaling rationale live in quality-signals-v1.md.

Content pinning: both versions, total_count, notice and scoring are fixed at invitation creation. Ascending retained
original numbers, not shuffled: full 63-position table in item-bank-v1.md. Attention ids attention.1/attention.2/attention.3
are exactly positions **16/32/48**, after the 15th/30th/45th personality item (original numbers 30/60/90).

## Error codes

Envelope: `{"error": "…", "code": "…", "data": {…}}` (standard of `httpjson`). Validation keeps the existing
`400 validation_error` with `fields[]` (codes `required`, `invalid`, `too_long`, `duplicate`, `not_allowed`).

| Code | Status | When |
|---|---|---|
| `assessment_unavailable` | 404 | public token unknown, revoked or expired (identical response for all three) |
| `consent_required` | 403 | items or answers before consent |
| `notice_changed` | 409 | consent with a notice version or text hash that is not the invitation's |
| `assessment_finished` | 409 | candidate write after finish |
| `invitation_closed` | 409 | link, reminder or account write on a finished, expired or revoked invitation |
| `incomplete` | 422 | finish with unanswered positions; `data.missing_positions` |
| `profile_disabled` | 409 | manual send while the profile is not enabled |
| `profile_unconfirmed` | 409 | explicit comparison creation without a current confirmed profile |
| `already_finished` | 409 | manual send when a finished, non-revoked invitation exists |
| `participation_inactive` | 409 | manual send for a discarded or exited participation |
| `process_finished` | 409 | employer write once the process is finished (existing code) |
| `rate_limited` | 429 | public prefix limits exceeded; `Retry-After` header |

## Employer endpoints

Same gate as `GET …/board` (recruiter: `403` role/membership, `404` foreign or unknown vacancy; a participation of
another vacancy → `404`). Writes answer `409 process_finished` once the process is finished. The profile is editable
in the same lifecycle states as the checklist.

1. `GET /v2/me/company/job-drafts/{id}/psychometric-profile` → `200 Profile` + `ETag` (never-saved state as in the
   checklist, never 404). Retired `auto_send_stage_ids` are dropped from GET silently.
2. `PUT …/psychometric-profile` with `If-Match` (`428` missing, `412 version_conflict` mismatch). Body = Profile
   without `version` and `confirmed_at` (server-owned); `confirmed` is writable. Full replacement →
   `200 Profile` + new `ETag`; identical PUT is a no-op. Each `auto_send_stage_ids` entry must be a current progression
   stage of the vacancy's pipeline, not the exit → `auto_send_stage_ids[k]` `invalid`. Audit
   `JobDraftPsychometricProfileConfigured`.
3. `GET …/psychometric-invitations` → `200 { "items": [Invitation] }` — the latest invitation per participation in the
   board's scope, one request for the whole board (card status, S9). Status only, never result data. The board move
   response is unchanged; the frontend refetches this endpoint after a move.
4. `POST …/participations/{pid}/psychometric-invitations` → `201 Invitation` (manual send). Idempotent: an active
   invitation (`created` or `in_progress`, not expired) → `200` with it. `409 profile_disabled`, `409 already_finished`
   (at most one non-revoked finished invitation per participation and test; re-takes are out of scope),
   `409 participation_inactive` (discarded or exited). Audit `PsychometricInvitationCreated`.
5. `POST …/psychometric-invitations/{iid}/link` → `200 { "token": "…", "expires_at": "RFC 3339" }`. The frontend
   composes `https://<web origin>/evaluacion/{token}` (the route is frontend-owned). Mints a new 256-bit token and
   **revokes the previous one immediately**: only its SHA-256 is stored, so a link cannot be shown twice. The
   candidate's progress and account access are unaffected. Link expiry = the invitation's `expires_at`. An
   auto-created invitation has no link until the first mint. `409 invitation_closed` when finished, expired or revoked.
   Audit `PsychometricLinkIssued`.
6. `POST …/psychometric-invitations/{iid}/reminders` → `200 Invitation` (records `last_reminded_at`,
   `reminder_count`; the UI then calls 5 to copy a fresh link). `409 invitation_closed` on a closed invitation. Audit
   `PsychometricReminderRecorded`.
7. `POST …/psychometric-invitations/{iid}/revoke` → `200 Invitation`. Idempotent. Audit `PsychometricInvitationRevoked`.
8. `GET …/psychometric-invitations/{iid}/result` → `200 Result`; `404` when not finished or past retention. Every
   successful read writes audit `PsychometricResultViewed` (actor, invitation) in the same transaction; if the audit
   insert fails, the read fails (no unaudited view). No comparison is recomputed on GET.
9. `POST …/psychometric-invitations/{iid}/comparisons` → `201 Comparison` (the same shape as latest_comparison).
   Creates a new immutable fit/focus/guide snapshot against the current confirmed profile and pinned assessment
   content/scoring versions. `404` if not finished or past retention; `409 profile_unconfirmed` if the current profile
   is not confirmed. Does not require enabled=true. Audit `PsychometricComparisonCreated` (actor, invitation,
   comparison id, profile_version) in the same transaction. Does not alter original bands, library or prior snapshots.

## Automatic invitations (S10)

Inside the same transaction as the stage entry, when the profile is enabled and the entered stage is in
`auto_send_stage_ids`, create an invitation (`origin = auto`) unless an active or a finished non-revoked one exists.
A discarded or exited participation never gets an automatic invitation (mirrors `409 participation_inactive`; only
recovery enters a stage from discard, and the participation is active again).
Entry kinds that trigger: board move (`board/store.go` Move) and recovery (`board/discard.go`); candidate apply and
manual intake only when their initial stage is configured. Pipeline relocation (`pipeline_impact.go`) and substate
changes never trigger. A configured stage retired later is ignored at trigger time. An insert failure fails the move
(same transaction; only possible on database errors). No delivery happens automatically in v1: the invitation appears
on the card and in the candidate's workspace; the recruiter delivers no-account candidates with «Copiar enlace»
(endpoint 5).

## Candidate endpoints

Two access paths over the same invitation: public by token, and the candidate workspace by account.

- Public: `/v2/assessments/{token}/…` — no session; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
  Unknown, revoked and expired tokens return **one identical** `404 assessment_unavailable` (no enumeration). The raw
  URL path is never logged (`internal/runtime/middleware/request.go:51`).
- Rate limits (public prefix only; in-process limiter, distributed is infrastructure later): per token hash 300
  requests / 10 min; per IP 600 requests / 10 min plus 30 unknown-token lookups / 10 min; exceeding any →
  `429 rate_limited` with `Retry-After`. IP = `RemoteAddr` unless `TRUSTED_PROXY_CIDRS` is set (production ALB).
- Account: `/v2/me/assessments` (list) and `/v2/me/assessments/{iid}/…` behind `RequireCandidateRole`, matched by the
  participation's candidate, never by token. The identical-404 rule is public-only: the list shows expired, revoked and
  finished invitations with their status (read-only); writes on a closed invitation → `409 invitation_closed`; another
  candidate's `iid` → `404`.
- Account list (L35–L36, **agreed**): `GET /v2/me/assessments` → `200 { "items": [
  { "id": "uuid", "application_id": "uuid | null", "vacancy": { "id": "uuid", "title": "…" },
  "company": { "id": "uuid", "name": "…" }, "status": "created | in_progress | finished | expired | revoked",
  "created_at", "expires_at", "finished_at": "RFC 3339 | null", "answered_count", "total_count",
  "estimated_minutes" } ] }` — only the latest invitation per (participation, test) of the session's candidate
  (superseded expired invitations are not listed; user L36), answerable ones first (`created`, `in_progress`, by
  `expires_at` ascending, `id` ascending), then the rest by `created_at` descending, `id` descending; no cursor in v1.
  `application_id` is the participation id, equal to `GET /v2/me/applications` `items[].id`, when the participation
  source is organic, so the workspace joins 1:1 by it; `null` otherwise (manual intake). `vacancy.title` comes from the
  same public projection as `/v2/me/applications`. Never any result, band or score (D7).

Per invitation (`{base}` = either prefix). Expiry is checked against server time inside every write transaction
(consent, answers, finish): an invitation that expires mid-test rejects further writes, and finish after `expires_at`
is rejected.

1. `GET {base}` → `200 { "company_name", "vacancy_title", "estimated_minutes": 10, "status", "answered_count",
   "total_count", "expires_at", "consent": { "notice_version": "1", "text": "…", "text_sha256": "…" } | null }`
   (`consent` null once accepted).
2. `POST {base}/consent` body `{ "notice_version": "1", "text_sha256": "…" }` → `204`. Mismatch → `409 notice_changed`.
   Stores notice version, text hash and `consented_at`; audit `PsychometricConsentGiven`.
3. `GET {base}/items` → `200 { "scale": [{ "value": 1, "label": "…" } …5], "items": [{ "position": 1, "text": "…",
   "value": 3 | null }] }` — every position in the pinned presentation order, text and the saved answer only (no
   facet, no key, no item number). `403 consent_required` before consent.
4. `PUT {base}/answers/{position}` body `{ "event_id": "uuid", "value": 3, "client_elapsed_ms": 4200 }` → `204`.
   Exact keys; unknown keys (including the removed client change counter) → `400 validation_error`.
   `event_id` UUID and integer `value` 1..5 required; `client_elapsed_ms` optional integer 0..3,600,000.
   It is cumulative **visible** milliseconds across revisits, paused when hidden or away; optional telemetry never
   blocks completion. Server stamps received_at, orders and deduplicates accepted writes per invitation.
   Replayed event_id is a no-op, returning 204 while the invitation is writable; it changes neither answer,
   elapsed time nor counters. New same-value PUT updates elapsed time on a revisit, but is not a value change.
   Last accepted new write wins until finish. `409 assessment_finished` after finish; existing consent/expiry gates
   still apply to replays. Missing timing for any of the 60 personality items makes signal.fast unknown.
5. `DELETE {base}/answers/{position}` body `{ "event_id": "uuid" }` → `204` (clear; S4 «borras y luego vuelves
   a ponerlo»). Required UUID, no other keys. Replayed event_id is a no-op. Deleting an already empty answer is
   idempotent and adds no clear. Same validation, consent, expiry and finished errors as 4. The server derives
   signal.changes from ordered accepted PUT/DELETE transitions: first answer excluded; different nonempty value
   = value change; nonempty→empty = clear; empty→value after a prior answer = reanswer. Example empty→2→4→empty→3
   yields 1/1/1, total 3. Same-value saves, retries and attention edits do not enter these personality counts.
   An incomplete event stream makes changes unknown, not none; counts are never supplied by the client.
6. `POST {base}/finish` → `200 { "status": "finished" }`; `422 incomplete` with `data.missing_positions`. Scoring runs
   in this transaction; audit `PsychometricAssessmentFinished`.

The candidate never sees scores or results in v1 (D7).

## Retention, privacy and audit

- Separate tables for profile, invitation, consent, answers + telemetry, result and comparison snapshots; no psychometric data on
  participation rows. All comparison snapshots follow the invitation's retention; creating one never restarts the clock.
- `purge_after` is always computable at write time: `finished_at + retention` for finished invitations, and
  `revoked_at + retention` for unfinished revoked ones, and `expires_at + retention` for the other unfinished ones
  (partial answers included). Retention = **12 months** (U1). Past it, results and answers are hidden at read time and
  deleted by a one-shot `cmd/` purge command (its scheduled run is E3).
- Audit events as listed above, including every recruiter view of a result. Encryption at rest is infrastructure.
- Canonical notice v1: [consent-notice-v1.md](../psychometrics/consent-notice-v1.md), **pendiente de revisión legal
  (D9)** and user wording approval before artifact freeze. Mexican Spanish tú: purpose, seven competencies/fifteen
  tendencies, answers and response timing/edits, company recruiters only, no candidate result in v1, human decision,
  never rejection by the assessment alone, 12-month anchors above, opposition/ARCO through the company (manual v1),
  express electronic consent. The backend serves the canonical text and hash from the pinned artifact.

## Open questions

- **B1 (resolved)** Revoke-on-mint, hash-only token (endpoint 5).
- **B2 (resolved)** In-process limiter with the values above.
- **B3 (resolved)** Content (item bank, keys, bands, competency relations, rules, question bank, notice text) ships as
  a versioned backend artifact (embedded file or migration seed) referenced by `content_version`/`scoring_version`; the
  candidate frontend gets item text and options only. Employer frontend renders stored library and guide text;
  only band/fit/tier labels are frontend-mapped by id.
- **U1 (resolved, user)** Retention 12 months, anchored as above.
- **U2 (resolved, user)** Default `expires_in_days` = 7.

## Out of scope (v1)

AI interview questions (D10), checklist integration (D1), terna report section (D2), cognitive and situational tests
(D3, D4), local norms (D5), short battery (D6), candidate feedback (D7), licensed classics (D8), email delivery and
automatic reminders (E1, E2), scheduled purge (E3), re-takes.
