# Vacancy checklist v1 (internal, employer-only)

Status: **agreed (2026-10-28)** — frontend proposal 4ac0bef4 plus the backend review (13 adjustments, folded in
below). Frontend branch `feat/vacancy-checklist`, backend branch `feat/vacancy-checklist-backend`. Only the frontend
edits this file. Feature document: `odd/tasks/vacancy-checklist.md`.

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
  "version": "3",                 // decimal save counter, "0" when never saved; the ETag is separate and opaque ("vc1-…")
  "criteria": [Criterion],        // 0..50, order is display order
  "reminder_stage_ids": ["uuid"]  // stages whose move confirmation reminds pending required criteria; 0..n
}

// Criterion — common fields
{
  "id": "uuid",                   // client-generated canonical UUID, stable across PUTs; marks reference it
                                  // editor rule: new id when kind or params change; keep it when only label/importance change
  "label": "string",              // 1..200 chars, trimmed, non-empty; human Spanish text shown everywhere
  "importance": "required" | "desirable",
  "kind": "...",                  // one of the kinds below
  "params": { ... }               // exact shape per kind, unknown keys rejected
}
```

| `kind` | `params` | Automatic? |
|---|---|---|
| `min_years_experience` | `{ "min": "3" }` decimal string, validated and canonicalized like `min_years_of_experience` ("2.0" → "2"; responses carry the canonical form) | yes |
| `seniority` | `{ "accepted": ["senior","lead"] }` 1..7 unique of `intern, junior, semi_senior, senior, lead, manager, director` | yes |
| `education` | `{ "min_level": "bachelor", "accepts_in_progress": false }`; order `secondary < high_school < technical < tsu < bachelor < specialty < master < phd` | yes |
| `language` | `{ "code": "en", "min_level": "B2" }` full, exact, case-sensitive language catalog of the draft (`internal/shared/languages`, includes `nah`, `yua`, `qaa`…); levels `A1..C2, native` | yes |
| `skill` | `{ "name": "SQL" }` 1..60 chars, trimmed, non-empty | partial (see rules) |
| `location` | `{ "country": "MX", "states": ["09","15"] }` geo catalog ids (the `id` of the board's `{id,name}` objects); each state must belong to the country; `states` 0..32 unique (empty = whole country); at most one `location` criterion | yes |
| `screening_answer` | `{ "question_id": "uuid", "accepted_option_ids": ["uuid"] }` 1..8 unique; the question must be a `single_choice_informative` or `single_choice_evaluated` question of the vacancy's screening v2 at PUT time and every option must belong to it; ids compared case-insensitively | yes |
| `manual` | `{}` | no |

Validation errors use the existing envelope:
`400 {"error":"validation failed","code":"validation_error","fields":[{"field":"criteria[2].params.min","code":"invalid"}]}`
with codes `required`, `invalid`, `too_long` (also for array limits: criteria > 50, states > 32, accepted > 7/8),
`duplicate` (duplicate `id`; `language.code`; `skill.name` case- and accent-insensitive, trimmed;
`screening_answer.question_id`; a second `location`), `not_allowed` (unknown key). Examples: an `open` question →
`criteria[i].params.question_id` `invalid`; an option outside the question → `criteria[i].params.accepted_option_ids[j]`
`invalid`. `reminder_stage_ids` must be stages of the vacancy's current pipeline configuration (not the exit, not
retired) → `reminder_stage_ids[k]` `invalid`.

Stale data: if a screening question is later deleted, its criterion stays stored and GET returns it (evaluated as
`unknown`), but the next PUT rejects it with the field error above, so the editor must show it for removal. If a
pipeline change retires a reminder stage, GET filters it out silently, so a GET→PUT round trip never fails on it.

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

All under the company-scoped vacancy, same gate as `GET …/board` (recruiter: `403` role/membership, `404` foreign or
unknown vacancy; a participation of another vacancy → `404`). GETs always work, also on a never-published draft.
Writes (endpoints 2, 4, 5) answer `409 process_finished` (same lifecycle error as substates and moves) once the process
is finished; paused or closed vacancies still accept them.

1. `GET /v2/me/company/job-drafts/{id}/checklist` → `200 Checklist` + `ETag`.
   A never-saved checklist returns `{"version":"0","criteria":[],"reminder_stage_ids":[]}` with its own ETag (never 404).
2. `PUT /v2/me/company/job-drafts/{id}/checklist` with `If-Match` = the ETag from GET (also for the never-saved state).
   No If-Match → `428 precondition_required`; mismatch → `412 version_conflict`; malformed, weak, `*` or list → `400`.
   Body `{ "criteria": [...], "reminder_stage_ids": [...] }`, full replacement → `200 Checklist` + new `ETag`.
   An identical PUT is a no-op (same version, no event). Otherwise one audit event `JobDraftChecklistConfigured`
   (entity `job_draft`, metadata JSON strings `{version, previous, new}`) in the same transaction.
   Removing a criterion keeps its marks stored but endpoint 3 stops returning them; re-adding the same id brings them back.
3. `GET /v2/me/company/job-drafts/{id}/checklist/marks` → `200 { "items": [Mark] }` — every current mark of every
   participation in the board's scope (discarded included) whose criterion still exists, ordered by
   `participation_id, criterion_id`; `{"items":[]}` when there is no process. One request for the whole board.
4. `PUT /v2/me/company/job-drafts/{id}/participations/{pid}/checklist-marks/{criterion_id}`
   body `{ "verdict": "met" | "not_met", "note": string | null }` → `200 Mark`.
   Last write wins per (participation, criterion); no If-Match in v1. An identical PUT is a no-op (returns the existing
   mark, same `marked_at`, no event). `404` unknown participation (or of another vacancy) or criterion not in the
   current checklist. Audit event `ParticipationChecklistMarked` (entity `process_participation`, metadata
   `{vacancy_id, criterion_id, previous, new}`).
5. `DELETE …/participations/{pid}/checklist-marks/{criterion_id}` → `204` (clears the mark; the automatic result shows
   again). Same audit event with `new` = `"null"`. Idempotent: `204` and no event when no mark exists.

`marked_by.full_name` is resolved at read time (join to users, like the history), not frozen at marking time.

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
- `location`: compares `profile.location.country.id` / `profile.location.state.id`. Location null or without country →
  `unknown`; other country → `not_met`; `states` empty → `met`; state in `states` → `met`; state null → `unknown`;
  else `not_met`.
- `screening_answer`: no answer for `question_id` (question added after the candidate applied, deleted, or not
  answered) → `unknown`; answered option in `accepted_option_ids` → `met`; else `not_met`. Question and option ids are
  compared case-insensitively (responses echo the vacancy's exact spelling).

Summary per participation: counts of `met` / `not_met` / `unknown` split by importance. Board order «Mejor ajuste»:
required met desc, required not_met asc, desirable met desc, required unknown asc, then the board's own order.

## Out of scope (v1)

AI suggestions, weights/scores, auto-rejection, candidate-facing exposure, per-mark concurrency control,
storing the computed automatic result.
