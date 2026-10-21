# Employer draft list API (v2)

Implementation reference for the list of schema-2 private vacancy drafts, so a
recruiter can find a saved draft and reopen it with
`GET /v2/me/company/job-drafts/{id}` and save it with
`PATCH /v2/me/company/job-drafts/{id}` (`If-Match` from that GET's `ETag`).
Feature record: `odd/tasks/draft-list.md`.

## Route

| Method | Route | Success |
| --- | --- | --- |
| `GET` | `/v2/me/company/job-drafts?limit=&cursor=` | `200 OK` |

The route requires a valid access token and an owner or recruiter membership
in the session company, like the other v2 draft routes. Identity and company
come only from the session. The store re-checks the live user, the live active
company and the membership inside the operation transaction. Every response,
including `401`/`403` from the gates, carries `Cache-Control: no-store`.

## Visibility

The list applies the same rule as `GET /v2/me/company/job-drafts/{id}`:

- the company **owner** sees every schema-2 draft of the company;
- a **recruiter** sees only the drafts where they are the principal recruiter.

Schema-1 drafts never appear (they are not readable through v2). Drafts of
other companies never appear, whatever the cursor says.

## Query parameters

| Parameter | Rule |
| --- | --- |
| `limit` | Optional. Plain decimal digits, `1..50`. Default `20`. |
| `cursor` | Optional. The `next_cursor` of the previous page, sent back unchanged (URL-encoded). |

Each parameter may appear at most once; a repeated parameter is
`400 invalid_request`. Unknown parameters are ignored, but a query string that
does not parse (for example a bad escape such as `%zz`) is
`400 invalid_request`.

The cursor is opaque base64url (at most 4096 bytes); clients must not build
or parse it. It names the session company and user, and a cursor naming
another company or user, or one that is not a well-formed version-1 cursor,
is `400 invalid_request`. The cursor is **not signed** and is not a
credential: a client that edits the position fields of its own cursor only
moves where its own list resumes. Visibility never depends on the cursor,
because the store always applies the session company and the
owner-or-principal rule in SQL.

## Order and paging

Drafts are ordered by `updated_at` descending, then `id` descending (most
recently saved first). `next_cursor` is `null` on the last page.

The sort key changes when a draft is saved: a draft saved while a client is
paging moves to the top and can be missed on the following pages. Restarting
without a cursor shows it again.

## Response

```json
{
  "items": [
    {
      "id": "0192a000-0000-7000-8000-000000000003",
      "title": "Backend Go",
      "work_mode": "remote",
      "work_schedule": "full_time",
      "requester": { "kind": "client", "id": "0192a000-0000-7000-8000-000000000004", "name": "Acme" },
      "principal_recruiter": { "id": "0192a000-0000-7000-8000-000000000002", "name": "Ana Pérez" },
      "version": "7",
      "status": "draft",
      "process": null,
      "published_at": null,
      "paused_at": null,
      "closed_at": null,
      "process_finished_at": null,
      "candidates": null,
      "created_at": "2026-10-01T09:00:00.000001Z",
      "updated_at": "2026-10-15T12:30:45.123456Z"
    }
  ],
  "next_cursor": null
}
```

| Field | Meaning |
| --- | --- |
| `id` | Draft id (lowercase UUID). |
| `title` | Draft title, or `null` when the draft has none. |
| `work_mode` | `onsite`, `remote`, `hybrid`, or `null`; same code as the draft `fields.work_mode`. |
| `work_schedule` | `full_time`, `part_time`, or `null`; same code as the draft `fields.work_schedule`. |
| `requester` | `null` when the draft has no requester. Otherwise `kind`, `id` (`null` when only the kind was chosen) and `name` (catalog name; `null` exactly when `id` is `null`). |
| `principal_recruiter` | `id` of the principal recruiter and `name` (`users.full_name`), `null` only when that user was deleted. |
| `version` | Decimal string, the same value as the draft read envelope. It is for display only: save with the `ETag` of `GET /v2/me/company/job-drafts/{id}`. |
| `status` | Strict enum `draft`, `published`, `paused` or `closed`, derived from the process record; all states remain in this list. |
| `process` | Always present: `null` for never-published drafts, otherwise `active` or `finished`. Finished implies closed publication. |
| `published_at` | Latest publication, resume or reopen instant as RFC 3339 UTC (six fractional digits), or `null` for a never-published draft. |
| `paused_at` | Latest pause instant in the same format, or `null` if never paused. Retained after resume/reopen. |
| `closed_at` | Latest close instant in the same format, or `null` if never closed. Retained after reopen. |
| `process_finished_at` | Latest process-finish instant (separate finish or close-and-finish) in the same format, or `null` if never finished. Retained after reopen. |
| `candidates` | Always present: `null` without a `vacancy_processes` row; otherwise live participation counts, described below. |
| `created_at`, `updated_at` | UTC, six fractional digits, the same values as the draft read envelope. |

P1 added `status` and `published_at`; L2 adds `process`; the candidate-summary
addition adds `candidates`; the lifecycle-date addition adds `paused_at`,
`closed_at` and `process_finished_at` (16 keys per item).
Lifecycle transitions do not change draft versions, `created_at`/`updated_at`, ordering, cursors
or visibility/filtering. Badges: Borrador, Publicada, Pausada, Cerrada · proceso en
curso, Cerrada · proceso finalizado. The backend returns every state; see
[vacancy-lifecycle.md](vacancy-lifecycle.md) for actions and the two axes.

## Lifecycle dates for list display

The flat date fields come from the same `vacancy_processes` row and have exactly
the values returned by `GET /v2/me/company/job-drafts/{id}/lifecycle`. All four
are `null` for never-published drafts. Each records the **latest** transition of
its kind, not the first one. Resume/reopen refreshes `published_at` but retains
historical `paused_at`, `closed_at` and `process_finished_at`; do not infer the
current state from whether a historical timestamp is present.

Choose the displayed date using both current axes:

| Current state | Display date |
| --- | --- |
| `draft` | None (all lifecycle dates are `null`). |
| `published` | `published_at` |
| `paused` | `paused_at` |
| `closed` + `active` process | `closed_at` |
| `closed` + `finished` process | `process_finished_at` |

The date columns are selected in the existing single page-scoped statement;
there are no extra queries or migrations.

## Live candidate summary

For a published-once vacancy, including paused, closed and finished processes,
`candidates` is an object even when all counts are zero. For example:

```json
{
  "total": 4,
  "in_process": 2,
  "discarded": 1,
  "by_stage": [
    { "id": "0192a000-0000-7000-8000-000000000010", "kind": "new", "name": "Nuevos", "count": 1 },
    { "id": "0192a000-0000-7000-8000-000000000011", "kind": "screening", "name": "Screening", "count": 0 },
    { "id": "0192a000-0000-7000-8000-000000000012", "kind": "screening_ok", "name": "Screening OK", "count": 0 },
    { "id": "0192a000-0000-7000-8000-000000000013", "kind": "custom", "name": "Prueba técnica", "count": 2 },
    { "id": "0192a000-0000-7000-8000-000000000014", "kind": "in_process", "name": "En proceso", "count": 0 },
    { "id": "0192a000-0000-7000-8000-000000000015", "kind": "placement", "name": "Placement", "count": 0 }
  ]
}
```

- `total`: every participation of this vacancy, active plus discarded.
- `discarded`: participations with a current discard (`discarded_at` is non-null).
- `in_process`: active participations in **any** current progression stage other
  than kind `new`; this is not just the stage whose kind is `in_process`.
- `by_stage`: active counts for **every** current progression stage, including
  zeros, with the board's IDs, semantic kinds, current names and current order.
  The discarded exit and retired/removed stages are not listed. Without a stored
  configuration the same deterministic defaults as the board apply.

Discard removes a candidate from their progression count, not from `total`;
recovery counts them in the selected current recovery stage. Cut 7 prevents
retiring an occupied stage: a discarded candidate may reference a retired stage
as their *previous* stage, but never occupies it. An active participation outside
the current pipeline is an invariant failure, not a silently omitted candidate.
Counts are read live, never from delivery/coverage history or a frozen fulfillment
snapshot, even after the process finishes. No candidate identities, CVs, answers,
profiles, discard reasons or messages are returned.

The existing live gates and owner-or-principal visibility are unchanged. One SQL
statement materializes the visible keyset page (plus one lookahead), groups
participations by that page's draft IDs and stages, and calculates total,
discarded and active-stage counts. The projection sums non-`new` active counts
into `in_process` and emits current pipeline order/zeros. Pipeline configuration
and requester names are joined into that statement; there are no per-item
queries. The three existing transactional gate reads remain. No migration is
required; ordering, cursors, versions and draft timestamps are unchanged.

## Status codes

| Status | `code` | When |
| --- | --- | --- |
| `200` | — | Page returned (possibly with `items: []`). |
| `400` | `invalid_request` | Bad or repeated `limit`/`cursor`, cursor of another company or user. |
| `401` | `unauthenticated` | Missing/invalid token, or the user no longer exists. |
| `403` | `forbidden` | Not a member of the session company. |
| `403` | `company_inactive` | The company was deleted. |
| `409` | `company_not_active` | The company is not `active`. |
| `500` | `internal_error` | Unexpected failure, including a stored draft that fails validation. |

Errors use the shared envelope `{"error": string, "code": string}`.

## Out of scope

Search, filters and sorting options; listing schema-1 drafts.

## Index

Migration `00014_index_job_drafts_company_updated` adds
`job_drafts_company_updated_id_idx` on `(company_id, updated_at DESC, id DESC)`,
so a page is read in list order from the keyset position without sorting every
draft of the company. The schema-2 and owner-or-principal conditions are still
checked row by row, so drafts that do not qualify (schema 1, or another
recruiter's drafts for a recruiter) are read and skipped. Run `make db-migrate` after pulling.

## Source map

- `internal/features/jobs/application/draftlist` — limit parsing, cursor codec, `Lister` port.
- `internal/features/jobs/infrastructure/postgres/draftstore/list_v2.go` — `Store.ListV2`.
- `internal/features/jobs/infrastructure/http/draftListHandler.go` — HTTP adapter.
- `cmd/api/router.go` — route in the v2 draft group.
- `db/migrations/00014_index_job_drafts_company_updated.sql` — list index.
- `cmd/api/draft_list_dates_integration_test.go` — list/lifecycle GET date parity
  through pause, resume, close, finish and reopen, including repeated transitions.
- `cmd/api/draft_list_candidates_integration_test.go` — live counts, real moves,
  discard/recovery, retirement guards, fulfillment/finished reads and visibility.
- `internal/features/jobs/infrastructure/postgres/draftstore/list_candidates_integration_test.go`
  — one page aggregation, constant query count for 1/50 items including requesters.
