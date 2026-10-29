# Psychometric tests v1 (employer-configured, candidate-answered)

Status: **draft for backend review (2026-10-28)**. Frontend branch `feat/psychometric-tests`. Only the frontend edits
this file. Feature document: `odd/tasks/psychometric-tests.md` (S1–S12, decisions L8–L10). Content (items, keys,
bands, competencies, texts, questions): `docs/psychometrics/*-v1.md`. Backend capability evidence and proposals folded
in from the backend session (feature document L9).

## Purpose

An optional, per-vacancy personality assessment whose result is read against the job, not against a population:

- The vacancy declares which competencies matter and how much (job psychometric profile).
- The candidate answers a 116-item IPIP-based questionnaire (public domain, our corrected Mexican Spanish text).
- The result is a band per facet (by meaning of what the candidate stated), a fit per competency (`aligned`,
  `explore`, `focus`), focus areas and a selected set of interview questions. Never «apto / no apto».
- The assessment **never rejects, discards or moves** anyone (S6, INT-22). A human always decides (LFPDPPP art. 26).
- No AI in v1 (D10).

## Ownership split

- **Backend** owns the scoring content as versioned data (`content_version`, e.g. `ipip116-mx-1`): item order, item
  keys, facet ↔ competency relations, band cut points, focus-area rules, quality-signal rules and question selection.
  It stores invitations, consent, answers and results; it scores from raw answers and stores `scoring_version` with each
  result so a result can be recomputed. Item keys, facet membership and attention items **never reach the client**.
- **Frontend** renders: it maps result ids (competency, band, fit, focus kind, signal, question id) to the authored
  Spanish texts of the interpretation library and interview bank for the result's `content_version`.
- The content documents in `docs/psychometrics/` are the source both sides implement; a change there is a new
  `content_version`.

## Data model

```jsonc
// Job psychometric profile (per vacancy; employer-only)
{
  "version": "2",                  // decimal save counter, "0" when never saved; ETag separate and opaque ("pp1-…")
  "enabled": false,                // S1: off by default
  "test": "ipip116-mx",            // only value in v1
  "competencies": [                // 0..12, unique competency_id, order = display order
    { "competency_id": "comp.organizacion", "importance": "key" | "important", "desired_band": "low" | "medium" | "high" }
  ],                               // competencies absent here are «No relevante»
  "auto_send_stage_ids": ["uuid"], // S10: stages whose entry creates an invitation; 0..n; current pipeline, not exit/retired
  "expires_in_days": 7             // 1..30, applies to invitations created after the save
}

// Invitation (one participation × one test)
{
  "id": "uuid",
  "participation_id": "uuid",
  "test": "ipip116-mx",
  "content_version": "ipip116-mx-1",
  "status": "created" | "in_progress" | "finished" | "expired" | "revoked", // expired computed at read time
  "origin": "manual" | "auto",
  "created_by": { "id": "uuid", "full_name": "string" } | null,   // null when origin = auto
  "trigger_stage_id": "uuid | null",
  "created_at": "RFC 3339",
  "expires_at": "RFC 3339",
  "consented_at": "RFC 3339 | null",
  "answered_count": 0,             // 0..120 (116 personality + attention items)
  "total_count": 120,
  "finished_at": "RFC 3339 | null",
  "last_reminded_at": "RFC 3339 | null",
  "reminder_count": 0
}

// Result (employer-only, only for finished invitations)
{
  "invitation_id": "uuid",
  "content_version": "ipip116-mx-1",
  "scoring_version": "1",
  "finished_at": "RFC 3339",
  "facets": [{ "facet_id": "fac.c3", "sum": 16, "band": "high" }],                // 29 items
  "competencies": [{ "competency_id": "comp.organizacion", "importance": "key" | "important" | "not_relevant",
                     "desired_band": "high" | null, "band": "medium", "fit": "aligned" | "explore" | "focus" }],
  "focus_areas": [{ "kind": "mismatch" | "quality", "competency_id": "comp.x" | null, "signal_id": "sig.x" | null }],
  "quality": { "tier": "none" | "some" | "relevant", "signal_ids": ["sig.fast_responses"] },
  "interview_question_ids": ["q.organizacion.low.1"],                             // ordered by job importance
  "profile_version": "2"           // job profile version the fit was computed against
}
```

Scoring rules: a facet is the sum of its 4 items after reversing keyed items (`6 − value`), range 4–20; its band
uses the fixed cut points of `docs/psychometrics/bands-and-competencies-v1.md`. There is **no domain score** in v1 (O
has 5 facets without Liberalism; domains are not shown). No prorating: `finish` requires every position answered (116
personality + attention items), so every facet is complete. Interview questions are selected deterministically by the
backend from bands, fit and focus areas and stored with the result.

Fit is computed against the job profile at finish time and recomputed on read when the profile version changed (bands
never change; `profile_version` says which one was used).

## Employer endpoints

Same gate as `GET …/board` (recruiter: `403` role/membership, `404` foreign or unknown vacancy; a participation of
another vacancy → `404`). Writes answer `409 process_finished` once the process is finished. Validation errors use the
existing envelope (`400 validation_error` with `fields[]`, codes `required`, `invalid`, `too_long`, `duplicate`,
`not_allowed`).

1. `GET /v2/me/company/job-drafts/{id}/psychometric-profile` → `200 Profile` + `ETag` (never-saved state as in the
   checklist, never 404).
2. `PUT …/psychometric-profile` with `If-Match` (`428` missing, `412 version_conflict` mismatch). Full replacement →
   `200 Profile` + new `ETag`; identical PUT is a no-op. Audit `JobDraftPsychometricProfileConfigured`.
3. `GET …/psychometric-invitations` → `200 { "items": [Invitation] }` — the latest invitation per participation in the
   board's scope, one request for the whole board (card status, S9).
4. `POST …/participations/{pid}/psychometric-invitations` → `201 Invitation` (manual send). Idempotent: when an active
   invitation (`created` or `in_progress`, not expired) exists → `200` with it. `409 profile_disabled` when the profile
   is not enabled. Audit `PsychometricInvitationCreated`.
5. `POST …/psychometric-invitations/{iid}/link` → `200 { "url": "https://…/evaluacion/{token}", "expires_at": … }`.
   Mints a new token and revokes the previous one (only the SHA-256 is stored, so a link cannot be shown twice). The
   candidate's progress is kept. `409 invitation_closed` when finished, expired or revoked. Audit
   `PsychometricLinkIssued`. **Open (B1).**
6. `POST …/psychometric-invitations/{iid}/reminders` → `200 Invitation` (records `last_reminded_at`,
   `reminder_count`; the UI then calls 5 to copy a fresh link). Audit `PsychometricReminderRecorded`.
7. `POST …/psychometric-invitations/{iid}/revoke` → `200 Invitation`. Idempotent. Audit `PsychometricInvitationRevoked`.
8. `GET …/psychometric-invitations/{iid}/result` → `200 Result`; `404` when not finished or past retention. Every
   successful read writes audit `PsychometricResultViewed` (actor, invitation).

## Automatic invitations (S10)

Inside the same transaction as the stage entry, when the profile is enabled and the entered stage is in
`auto_send_stage_ids`, create an invitation (`origin = auto`) unless one is active. Entry kinds that trigger: board
move (`board/store.go` Move) and recovery (`board/discard.go`); candidate apply and manual intake only when their
initial stage is configured. Pipeline relocation (`pipeline_impact.go`) and substate changes never trigger. Re-entering
a stage never creates a second active invitation. No delivery happens automatically in v1: the invitation appears on the
card and in the candidate's workspace; the recruiter delivers no-account candidates with «Copiar enlace» (endpoint 5).

## Candidate endpoints

Two equivalent access paths over the same invitation: public by token, and the candidate workspace by account.

- Public: `/v2/assessments/{token}/…` — no session; `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.
  Unknown, revoked and expired tokens return **one identical** `404 {"code":"assessment_unavailable"}` (no
  enumeration). Rate limited per token and per IP. **Open (B2).**
- Account: `/v2/me/assessments` (list) and `/v2/me/assessments/{iid}/…` behind `RequireCandidateRole`, matched by the
  participation's candidate, never by token.

Per invitation (`{base}` = either prefix):

1. `GET {base}` → `200 { "company_name", "vacancy_title", "estimated_minutes": 20, "status", "answered_count",
   "total_count", "expires_at", "consent": { "notice_version": "1", "text": "…", "text_sha256": "…" } | null }`
   (`consent` null once accepted).
2. `POST {base}/consent` body `{ "notice_version": "1", "text_sha256": "…" }` → `204`. Mismatch with the current notice
   → `409 notice_changed`. Stores notice version, text hash and `consented_at`; audit `PsychometricConsentGiven`.
3. `GET {base}/items` → `200 { "scale": [{ "value": 1, "label": "…" } …5], "items": [{ "position": 1, "text": "…",
   "value": 3 | null }] }` — positions 1..120 in presentation order, text and the saved answer only (no facet, no key,
   no item number). `403 consent_required` before consent.
4. `PUT {base}/answers/{position}` body `{ "value": 1..5, "client_elapsed_ms": 4200, "change_count": 1 }` → `204`.
   Server stamps `received_at`; client timings are used only for quality signals, never for scores. Last write wins
   until finish. `409 assessment_finished` after finish.
5. `POST {base}/finish` → `200 { "status": "finished" }`; `422 incomplete` with `missing_positions` when an item is
   unanswered. Scoring runs in this transaction; audit `PsychometricAssessmentFinished`.

The candidate never sees scores or results in v1 (D7).

## Retention, privacy and audit

- Separate tables for profile, invitation, consent, answers + telemetry and result; no psychometric data on
  participation rows.
- `purge_after` on each invitation; results and answers past it are hidden at read time and deleted by a one-shot
  `cmd/` purge command (its scheduled run is E3). **Open (U1): retention period.**
- Audit events as listed above, including every recruiter view of a result. Encryption at rest is infrastructure.
- The consent notice text (Mexican Spanish, versioned) states purpose, who sees the result, retention and the right to
  oppose; the frontend owns its copy and the backend stores its hash per version.

## Open questions

- **B1 (backend)** Link minting on each «Copiar enlace» revokes the previous link. Acceptable, or prefer a stable token
  stored encrypted so the same link can be shown again?
- **B2 (backend)** Rate-limit values for public endpoints and whether a limiter exists to reuse.
- **B3 (resolved)** Content (item bank, keys, bands, competency relations, rules, question bank) ships as a versioned
  backend artifact (embedded file or migration seed) referenced by `content_version`/`scoring_version`; the frontend
  gets item text and options only, and owns the display texts of the library and bank by id.
- **U1 (user)** Retention period for results and answers (proposal: 12 months after the process finishes).
- **U2 (user)** Default `expires_in_days` (proposal: 7).

## Out of scope (v1)

AI interview questions (D10), checklist integration (D1), terna report section (D2), cognitive and situational tests
(D3, D4), local norms (D5), short battery (D6), candidate feedback (D7), licensed classics (D8), email delivery and
automatic reminders (E1, E2), scheduled purge (E3).
