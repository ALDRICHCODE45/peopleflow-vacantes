# Vacancy checklist v1 (internal, employer-only)

Status: **proposal by the frontend (2026-10-28), pending backend review.** Feature document:
`odd/tasks/vacancy-checklist.md`.

## Purpose

A per-vacancy internal checklist of criteria that every candidate in the vacancy's process is contrasted against.
It is never public and never shown to candidates. Lesson that shapes the design (user, L1): a checklist the recruiter
has to fill by hand for every candidate ends up empty and unused. So:

- **Automatic criteria** are bound to data the system already has (effective profile after company corrections,
  screening answers) and evaluate themselves for every participation, including candidates already in the process.
- **Manual criteria** need human judgment; the recruiter marks them in one click, in places they already work.
- A recruiter mark may also override an automatic result (mark wins, its source stays visible).
- The checklist **never rejects or moves** anyone (business rule INT-22): it informs, orders and compares.
- No AI in v1.

## Ownership split

- **Backend** stores and validates the checklist (criteria + reminder stages) per vacancy, and the recruiter marks per
  participation, both audited (§14 of `docs/recruitment-business-rules.md`).
- **Automatic evaluation is a pure, documented function** (section «Evaluation rules» below). In v1 the frontend runs
  it over the board payload it already loads (`GET …/board`: effective profile + `screening_answers`). The backend does
  not need to compute it in v1; the rules are written so it can adopt them later without a contract change.

## Data model

```jsonc
// Checklist
{
  "version": "3",                 // opaque; also returned as ETag
  "criteria": [Criterion],        // 0..50, order is display order
  "reminder_stage_ids": ["uuid"]  // stages whose move confirmation reminds pending required criteria; 0..n
}

// Criterion — common fields
{
  "id": "uuid",                   // client-generated (v4), stable across PUTs; marks reference it
  "label": "string",              // 1..200 chars after trim, human Spanish text shown everywhere
  "importance": "required" | "desirable",
  "kind": "...",                  // one of the kinds below
  "params": { ... }               // exact shape per kind, unknown keys rejected
}
```

| `kind` | `params` | Automatic? |
|---|---|---|
| `min_years_experience` | `{ "min": "3" }` decimal string, same rule as `min_years_of_experience` (0–60, up to 1 decimal) | yes |
| `seniority` | `{ "accepted": ["senior","lead"] }` 1..7 unique `SENIORITIES` | yes |
| `education` | `{ "min_level": "bachelor", "accepts_in_progress": false }` `EDUCATION_LEVELS` | yes |
| `language` | `{ "code": "en", "min_level": "B2" }` same language catalog + `CEFR_LEVELS` as the draft | yes |
| `skill` | `{ "name": "SQL" }` 1..60 chars | partial (see rules) |
| `location` | `{ "country": "MX", "states": ["09","15"] }` geo catalog codes; `states` 0..32 unique (empty = whole country) | yes |
| `screening_answer` | `{ "question_id": "uuid", "accepted_option_ids": ["uuid"] }` 1..8 unique; must exist in the vacancy's screening v2 questions at PUT time | yes |
| `manual` | `{}` | no |

Validation errors use the existing envelope: `400 {"code":"validation_error","fields":[{"field":"criteria[2].params.min","code":"invalid"}]}`
with codes `required`, `invalid`, `too_long`, `duplicate` (duplicate `id`, or duplicate `language.code` / `skill.name`
case-insensitive / `screening_answer.question_id`), `not_allowed` (unknown key), `too_many`. `reminder_stage_ids` must
be stages of the vacancy's current pipeline (`field: "reminder_stage_ids[0]"`, `code: "invalid"`).

```jsonc
// Mark (recruiter verdict on one criterion for one participation)
{
  "participation_id": "uuid",
  "criterion_id": "uuid",
  "verdict": "met" | "not_met",
  "note": "string | null",        // 0..500 chars after trim; "" -> null
  "marked_by": { "id": "uuid", "full_name": "string" },
  "marked_at": "RFC 3339"
}
```

## Endpoints

All under the company-scoped vacancy, same auth and company-membership rules as `GET …/board`
(`404` for foreign or unknown vacancy, `403` when the role cannot read the board).

1. `GET /v2/me/company/job-drafts/{id}/checklist` → `200 Checklist` + `ETag`.
   A vacancy without a stored checklist returns `{"version":"0","criteria":[],"reminder_stage_ids":[]}` (never 404).
2. `PUT /v2/me/company/job-drafts/{id}/checklist` with `If-Match` (required, `428` without it, `412` on mismatch;
   `"0"` matches the never-saved state). Body `{ "criteria": [...], "reminder_stage_ids": [...] }`, full replacement.
   → `200 Checklist` + new `ETag`. Writes one audit event `JobDraftChecklistConfigured` with JSON `previous` and `new`
   in the same transaction.
   Removing a criterion keeps its marks stored (history) but they are no longer returned by endpoint 3.
3. `GET /v2/me/company/job-drafts/{id}/checklist/marks` → `200 { "items": [Mark] }` — every current mark of every
   participation of the vacancy (discarded included) whose criterion still exists. One request for the whole board.
4. `PUT /v2/me/company/job-drafts/{id}/participations/{pid}/checklist-marks/{criterion_id}`
   body `{ "verdict": "met" | "not_met", "note": string | null }` → `200 Mark`.
   Last write wins per (participation, criterion); no If-Match in v1.
   `404` unknown participation (or of another vacancy) or criterion not in the current checklist.
   Audit event `ParticipationChecklistMarked` with `previous` (mark or null) and `new`.
5. `DELETE …/participations/{pid}/checklist-marks/{criterion_id}` → `204` (clears the mark; automatic result shows
   again). Audit event `ParticipationChecklistMarked` with `new: null`. Idempotent: `204` when no mark exists, no event.

## Evaluation rules (pure function, v1 runs in the frontend)

Input: one criterion, the participation's **effective** board profile (`profile`, after company corrections) and its
`screening_answers`, plus its mark if any. Output: `{ result: "met" | "not_met" | "unknown", source: "mark" | "auto" | "none" }`.

- A mark always wins: `result = verdict`, `source = "mark"`.
- `manual` without mark → `unknown`, `none`.
- `min_years_experience`: profile years null → `unknown`; `years >= min` → `met`; else `not_met`.
- `seniority`: null → `unknown`; in `accepted` → `met`; else `not_met`.
- `education`: `highest_completed >= min_level` (catalog order) → `met`; else if `accepts_in_progress` and
  `in_progress >= min_level` → `met`; else if both null → `unknown`; else `not_met`.
- `language`: no entry for `code` → `not_met` when the profile has at least one language, `unknown` when it has none;
  level `native` ranks above `C2`; `level >= min_level` → `met`; else `not_met`.
- `skill`: profile skills contain `name` (case- and accent-insensitive, trimmed) → `met`; otherwise `unknown`
  (a missing self-declared skill is not proof the candidate lacks it — the recruiter decides).
- `location`: profile location null or without country → `unknown`; other country → `not_met`; `states` empty →
  `met`; profile state in `states` → `met`; state null → `unknown`; else `not_met`.
- `screening_answer`: no answer for `question_id` (question added after the candidate applied, or not answered) →
  `unknown`; answered option in `accepted_option_ids` → `met`; else `not_met`.

Summary per participation: counts of `met` / `not_met` / `unknown` split by importance. Board order «Mejor ajuste»:
required met desc, required not_met asc, desirable met desc, required unknown asc, then the board's own order.

## Out of scope (v1)

AI suggestions, weights/scores, auto-rejection, candidate-facing exposure, per-mark concurrency control,
storing the computed automatic result.
