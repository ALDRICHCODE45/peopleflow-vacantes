# Requester catalog API

Implementation reference for the organization-scoped requester catalog
(`Área solicitante` / `Cliente`). The accepted contract is
`odd/tasks/private-vacancy-drafts-save.md` §7; where this document and the
contract differ, the contract wins.

A draft references a requester as `{"kind": "internal_area" | "client", "id": "<UUID>" | null}`.
A non-null `id` must be an entry of this catalog for the same company and kind,
otherwise the draft write is `400 validation_error`.

## Routes

| Method | Route | Success |
| --- | --- | --- |
| `GET` | `/me/company/requesters?kind=&q=&limit=&cursor=` | `200 OK` |
| `POST` | `/me/company/requesters` | `201 Created` |

Both routes require a valid access token and an owner or recruiter membership
in the session company. Identity and company come only from the session; there
is no company or actor in the query or body. The store re-checks the live user,
the live active company and the membership inside the operation transaction.
Every response, including `401`/`403` from the gates, carries
`Cache-Control: no-store`.

There is no edit, delete or merge. An entry created inline from the vacancy
form persists even if the draft is later cancelled; the UI warns before
creating it.

## `GET` — list one kind

| Parameter | Rule |
| --- | --- |
| `kind` | Required: `internal_area` or `client`. |
| `q` | Optional prefix, default empty. Normalized like a name; at most 160 codepoints after normalization. |
| `limit` | Optional, default `20`, decimal digits `1..50`. |
| `cursor` | Optional opaque token from a previous `next_cursor`. |

Each parameter may appear at most once. Any violation is
`400 invalid_request`. A query string that does not parse (for example a bad
escape such as `%zz`) is also `400 invalid_request`.

Response:

```json
{ "items": [{ "id": "<uuid>", "kind": "internal_area", "name": "Departamento de TI" }], "next_cursor": null }
```

`items` is never `null`. `next_cursor` is a string while more entries exist and
`null` on the last page. There is no total count.

Order and matching use the casefolded name key: entries are ordered by
`(name_key COLLATE "C", id)`, and `q` matches entries whose key starts with the
normalized query key. `%`, `_` and `\` in `q` match literally.

### Cursor

Unpadded base64url of a JSON object with exactly `version` (the number `1`),
`company_id`, `kind`, `q_normalized`, `last_name_key` and `last_id`; at most
4096 bytes. A cursor is only valid for the same company, kind and normalized
query it was issued for. It is not a credential, not encrypted and not a
snapshot: the session company predicate always applies. Clients must treat it
as opaque.

## `POST` — create one entry

Body, exactly:

```json
{ "kind": "client", "name": "Cyber Power" }
```

The body limit is 8192 bytes (`413 payload_too_large` above it). Unknown or
missing keys, duplicate keys, non-string values, invalid UTF-8, trailing data
and an unknown `kind` are `400 invalid_request`.

`name` normalization: UTF-8 → NFC → trim and collapse Unicode `White_Space`
(including NBSP) to one ASCII space; at most 160 codepoints. Non-whitespace
control characters are rejected; zero-width and other format characters are
kept. An empty, too long or control-bearing name is `400 validation_error`.

Duplicates are detected per company and kind on the full-Unicode casefold of
the normalized name (accents preserved, no NFKC, no fuzzy matching):
`Área` = `ÁREA` = `A\u0301REA`, `Straße` = `STRASSE`, but `Area` ≠ `Área`.
PostgreSQL enforces `UNIQUE (company_id, kind, name_key)`.

`201` returns the stored entry `{ "id", "kind", "name" }` and writes a
`JobDraftRequesterCreated` audit event (metadata: `kind` only) in the same
transaction.

A duplicate returns the existing entry so the UI can offer to select it — it is
never merged or selected automatically:

```json
{
  "error": "requester already exists",
  "code": "requester_already_exists",
  "data": { "existing": { "id": "<uuid>", "kind": "client", "name": "Cyber Power" } }
}
```

## Status codes

| Status | Code | When |
| --- | --- | --- |
| `400` | `invalid_request` | Malformed query, cursor or body shape |
| `400` | `validation_error` | Invalid `name` |
| `401` | `unauthenticated` | Missing or invalid token, unknown user |
| `403` | `forbidden` | No membership or insufficient role |
| `403` | `company_inactive` | Company missing or deleted |
| `409` | `company_not_active` | Company not active |
| `409` | `requester_already_exists` | Duplicate name for the company and kind |
| `413` | `payload_too_large` | `POST` body over 8192 bytes |
| `500` | `internal_error` | Unexpected failure |

## Tests

```sh
go test ./internal/features/jobs/application/requesters ./internal/features/jobs/infrastructure/http ./internal/shared/httpjson ./cmd/api -count=1
# Isolated loopback `draft_test` database only, never DATABASE_URL:
DRAFT_TEST_DATABASE_URL=<isolated DSN> go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api -run 'Requester' -count=1
```
