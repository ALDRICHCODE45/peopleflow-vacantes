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
| `created_at`, `updated_at` | UTC, six fractional digits, the same values as the draft read envelope. |

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

Search, filters and sorting options; listing schema-1 drafts; an index on
`(company_id, updated_at DESC, id DESC)` (the existing `company_id` index is
enough for the expected volume; follow-up if it is not).

## Source map

- `internal/features/jobs/application/draftlist` — limit parsing, cursor codec, `Lister` port.
- `internal/features/jobs/infrastructure/postgres/draftstore/list_v2.go` — `Store.ListV2`.
- `internal/features/jobs/infrastructure/http/draftListHandler.go` — HTTP adapter.
- `cmd/api/router.go` — route in the v2 draft group.
