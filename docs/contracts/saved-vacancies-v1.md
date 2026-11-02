# Saved vacancies v1 (candidate «Vacantes guardadas»)

Status: **agreed with the backend (2026-11-01, backend changes C1–C6 and answers Q1–Q3 folded in)**; backend branch
`feat/saved-jobs-backend`. The user delegated the
agreement to the two agents (no wording approval gate). Only the frontend edits this file; backend proposals are folded
in and recorded in the feature document. Frontend branch `feat/saved-vacancies`. Feature document:
`odd/tasks/saved-vacancies.md`. Approved design: `design/saved-vacancies/03-pendientes-primero.html`.

## Purpose

A candidate saves public vacancies to come back to them, and `/candidato/guardadas` groups them by next step:
«Por postularte», «Ya te postulaste», «Ya no disponibles». Saving lives on the public listing card and on the detail
(icon button joined to «Postularme»). The user's word was «Favoritas»; the product name stays «Vacantes guardadas».

## Decisions (user, 2026-11-01)

- A visitor who taps «Guardar» signs in and, on return to the same vacancy, it is saved automatically (frontend-only:
  the return URL carries the intent; the backend sees an ordinary `PUT`).
- At most **200** saved vacancies per candidate, validated by the backend.
- Company accounts cannot save (candidate role only).

## Ownership split

- **Backend** stores one row per (candidate, public job), enforces the limit and the candidate role, and resolves on
  read the vacancy availability and whether the candidate already applied.
- **Frontend** owns the optimistic-free UI states (busy → confirmed, §12 of the UI rules), grouping, client-side sort
  by publication date, the visitor return intent and all copy.
- Employers never see who saved a vacancy, nor a saved count, in v1.

## Endpoints

All under the existing candidate group (`identityhttp.NoStore`, `requireAuth`, `requireCandidate`), like `/v2/me/cvs`.
`{jobId}` is the public catalog id (`/v2/jobs/{id}`), for both `source: vacancy` and `source: legacy` rows.

### `PUT /v2/me/saved-jobs/{jobId}` — save (idempotent)

- No body. `201` when created, `200` when it was already saved (unchanged `saved_at`). Body in both:
  `{ "job_id": "uuid", "saved_at": "RFC 3339" }`.
- Evaluation order (C3): an already saved row answers `200` regardless of availability or the limit. Otherwise a
  malformed or unknown id, a draft, an inactive company or a legacy job that is not published → `404 not_found`; a
  vacancy that is paused or closed (the set `GET /v2/jobs/{id}` reports as unavailable) → `409 job_unavailable`; at
  200 saved → `409 saved_jobs_limit` with `data: { "limit": 200 }`; else `201`.
- The limit counts every saved row, open and closed (C4). Two parallel `PUT`s at 199 end at 200 with one
  `409 saved_jobs_limit` (per-candidate transaction-scoped advisory lock, pinned by an integration test).

### `DELETE /v2/me/saved-jobs/{jobId}` — remove (idempotent)

- `204` whether or not it was saved. A malformed id → `404 not_found`. «Deshacer» is a new `PUT` (new `saved_at`).

### `DELETE /v2/me/saved-jobs?availability=closed` — remove the unavailable ones

- Removes only rows that are `closed` under the availability rule at that instant. `200 { "removed": 3 }`. Exactly
  one key `availability` with value `closed`; anything else (missing, extra or repeated keys) → `400
  validation_error` (C6).

### `GET /v2/me/saved-jobs` — list

```json
{
  "items": [
    {
      "job_id": "uuid",
      "saved_at": "RFC 3339",
      "availability": "open | closed",
      "closed_at": "RFC 3339 | null",
      "application": { "id": "uuid", "applied_at": "RFC 3339" },
      "job": {
        "source": "vacancy | legacy",
        "title": "…",
        "company": { "id": "uuid", "name": "…", "logo_url": "… | null" },
        "location_label": "… | null",
        "work_mode": "onsite | remote | hybrid",
        "compensation": { "…": "same object as /v2/jobs items, nullable" },
        "legacy_salary": { "…": "same object as /v2/jobs items, nullable" },
        "published_at": "RFC 3339"
      }
    }
  ],
  "total": 4,
  "limit": 200
}
```

- Every saved row of the session's candidate (≤ 200, no pagination), ordered by `saved_at` desc, then `job_id` asc.
- The `job` snapshot keys and values are identical to the `/v2/jobs` item for an open job (C1). Legacy rows always
  have `compensation: null` and carry salary only in `legacy_salary`.
- Availability (C2, resolved at read time): a vacancy is `open` iff its process is `published` and its company is
  active; `paused`, `closed` or an inactive company → `closed`, with `closed_at` = closed_at, else paused_at, else
  `null` (inactive company → `null`). A legacy job is `open` iff `published`, not soft-deleted and its company active;
  else `closed`, with `closed_at` = deleted_at when soft-deleted, else `null`. A paused vacancy that resumes is `open`
  again. The snapshot is still returned for closed rows so they can be recognized.
- `application` (C5) = `{ id: process_participations.id (the same id as /v2/me/applications items), applied_at: its
  created_at }`, or `null`. Legacy rows always have `null`.
- If a job is hard-deleted, its saved rows go with it (cascade); they never appear as broken items.

### `GET /v2/me/saved-jobs/ids` — which cards to mark

- `200 { "job_ids": ["uuid", …] }` (≤ 200). Lets the public listing and detail stay public and cacheable: the client
  marks the bookmarks after the session resolves, without a per-session field in `/v2/jobs`.

## Error codes

Envelope `{"error": "…", "code": "…", "data": {…}}` (`httpjson`). Session errors keep the existing `401`/`403`.

| Code | Status | When |
|---|---|---|
| `not_found` | 404 | malformed, unknown or not public job id on `PUT`; malformed id on `DELETE` |
| `job_unavailable` | 409 | `PUT` of a closed vacancy that is not already saved |
| `saved_jobs_limit` | 409 | new `PUT` at 200 saved; `data.limit` |
| `validation_error` | 400 | bulk `DELETE` with a query other than `availability=closed`; shared envelope with `fields` (`[{"field":"availability","code":"invalid"}]`), not `data` |

Messages: `job_unavailable` → «job unavailable», `saved_jobs_limit` → «saved jobs limit reached»; only
`saved_jobs_limit` carries `data`.

## Resolved questions (backend answers)

1. Storage: one table `saved_jobs(candidate_id → users ON DELETE CASCADE, legacy_job_id → jobs ON DELETE CASCADE
   NULL, process_id → vacancy_processes ON DELETE CASCADE NULL, CHECK exactly one non-null, job_id generated =
   COALESCE(...), saved_at, PK (candidate_id, job_id))`. The public id round-trips unchanged; hard deletes cascade.
2. Concurrency: the candidate's `users` row is locked (`SELECT … FOR UPDATE`, the CV library convention) before
   count + insert.
3. Legacy `published_at` is stable: set once on first publish, never reset.

## Catalog notes used by the frontend

`GET /v2/jobs` has no exclude-id parameter: request `limit = N + 1` and drop the current id client-side. Any `state`
filter excludes all legacy rows.

## Out of scope (v1)

Notes on a saved vacancy, folders, reminders or alerts, sharing the list, employer-facing counts, and saving by
company accounts.
