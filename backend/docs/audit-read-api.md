# Audit read API: list, catalogs and export

Contract: `docs/contracts/audit-log-v1.md` §8 (the contract is authoritative; response
shapes are **closed**, the frontend decoders are strict). Capture is in
[audit-capture.md](audit-capture.md), retention in [audit-retention.md](audit-retention.md).

Code: `internal/features/audit_events/` — `application/auditlog` (parser, cursor,
service), `infrastructure/postgres/reads` (SQL), `infrastructure/http` (handlers);
wiring in `cmd/api` (`newAuditHandler`, one router group).

## Access

All five routes sit in one router group: `NoStore` → `requireAuth` → `requireOwner`.
Unauthenticated → `401 unauthenticated`; a recruiter → `403 forbidden`; a candidate →
`403`. Every response, errors included, carries `Cache-Control: no-store`. Only rows
whose `company_id` is the caller's company are ever read. **Viewing is not audited**
(the list would audit itself on every page); exporting is.

| Route | Answers |
| --- | --- |
| `GET /v2/me/company/audit-events` | the page of events (§8.1) |
| `GET …/audit-events/types` | the catalog, `{items:[{event_type, category}]}` (§8.2) |
| `GET …/audit-events/actors` | `{items:[{user_id, name, email, is_current_member}]}` (§8.3) |
| `GET …/audit-events/vacancies` | `{items:[{vacancy_id, title}]}` (§8.4) |
| `POST …/audit-events/export` | the CSV (§8.5) |

## List

Filters: `actor_id`, `event_type` (repeatable, OR), `category` (AND with `event_type`),
`vacancy_id`, `from` / `to` (`YYYY-MM-DD`, inclusive whole days in `America/Mexico_City`,
`from ≤ to`), `limit` 1–100 (default 50), `cursor`. Order `occurred_at DESC, id DESC`.
`total` is the exact count for the filters (not for the cursor), read in the same
REPEATABLE READ snapshot as the page.

- **Strict parser.** Unknown, duplicate or invalid parameter → `422 invalid_filter` with
  `fields: [{field, code}]`, codes `invalid` / `unknown` / `duplicate` / `range` (a
  `from > to` is `range` on `to`), sorted by field. The rejected value is never echoed;
  an unknown parameter name is echoed only when it is a short plain ASCII name
  (otherwise the field is `query`). The shared `invalid_filter` catalog entry stays a
  `400` for the pool list and public jobs; the audit screen uses its own writer
  (`httpjson.WriteAuditInvalidFilter`, 422).
- **Cursor.** Opaque, versioned, bound to company and to the hash of the filters (the
  `limit` is not in the hash, so it may change between pages). Malformed, oversized,
  foreign or filter-mismatched → `400 invalid_cursor`. A filter error wins over the cursor.
- **Only catalog types are listed.** `event_type` is free text in the table, but every
  row written by `Append` is in the catalog; a row with another type (a legacy literal)
  is skipped, so every item has a `category`. The same restriction applies to `/actors`
  and `/vacancies`.
- **`actor`** is `{"type":"system"}` or `{type:"user", user_id, name, email,
  is_current_member}`. Name and email come from `users` at read time and are `null` for
  a deleted account (no row or `deleted_at` set). `is_current_member` says whether the
  user still has a membership in this company.
- **`vacancy`** is `null` without `vacancy_id`; the title is read live (`null` for a
  deleted vacancy, `""` for a draft without a title).
- **`entity.label`** is resolved at read time and never stored:

  | `entity.type` | Label |
  | --- | --- |
  | `company_candidate` | the manual candidate's name, or an organic candidate's visible name (the company's correction when there is one) |
  | `process_participation` | the participation's candidate, same rule |
  | `company_member` | the account name at `metadata.member_user_id` |
  | `job_draft`, `vacancy`, `vacancy_process` | the vacancy title |
  | `company` | the company name |
  | anything else, or the entity is gone | `null` |

- `metadata` that is not a JSON object (a `null` stored by an emitter with no metadata)
  is served as `{}` so the shape stays closed.
- `ip` is the text of the stored `inet` (no mask); `ip`, `ip_source` and `user_agent`
  are `null` for system events and rows written without a request context.
- `occurred_at` is UTC with milliseconds (`2026-11-04T17:03:12.441Z`).

## Export

Body: `{actor_id, event_types, category, vacancy_id, from, to}` as JSON, decoded strictly
(one object; an unknown or repeated key is `unknown` / `duplicate`). `from` and `to` are
**required**; the span counts both ends and is at most 366 days (1 Jan–31 Dec of a leap
year passes). A body that is not one JSON object is `400 invalid_request`.

| Case | Answer |
| --- | --- |
| missing / malformed / out-of-range filters | `422 invalid_filter` with `fields` (`required`, `invalid`, `range` on `to`, …) |
| more than 50,000 rows | `422 audit_export_too_large`, `{"error", "code", "row_count", "limit"}` at the top level; nothing exported, nothing audited |
| otherwise | `200 text/csv; charset=utf-8`, UTF-8 BOM, `Content-Disposition: attachment; filename="auditoria-YYYY-MM-DD.csv"` (Mexico City date), `no-store` |

How the order of effects is guaranteed (`reads.Store.Export`):

1. One `REPEATABLE READ` transaction counts the rows. Above the limit it rolls back and
   returns `TooLarge`; no row is written.
2. Otherwise it `DECLARE`s a `WITH HOLD` cursor over the same snapshot, appends
   `AuditLogExported` (entity `company`, actor = the owner, metadata
   `{filters, row_count}`) and **commits**. The commit materialises the cursor, so the
   file contains exactly the counted rows and the record exists before the first byte.
3. The handler writes the headers, the BOM and the header row, flushes, then `FETCH`es
   500 rows at a time. A failure after that point aborts the connection
   (`http.ErrAbortHandler`) instead of ending a truncated file as if it were complete.
4. `Close` drops the cursor and returns the connection; a connection that cannot close
   the cursor is discarded.

`filters` in the record holds IDs, enums and dates only; unset filters are omitted. The
catalog's allowed keys for the type were already `filters` and `row_count`, so no catalog
change was needed. The export's own row is not part of the file it records.

Columns, in order: `occurred_at` (UTC ISO, ms), `occurred_at_mx` (Mexico City, ISO with
offset), `event_type`, `category`, `actor_user_id`, `actor_name`, `actor_email`,
`entity_type`, `entity_id`, `entity_label`, `vacancy_id`, `vacancy_title`, `ip`,
`user_agent`, `metadata` (compact JSON). Absent values are empty cells.

**CSV injection guard:** a cell that starts with `=`, `+`, `-` or `@` gets a leading `'`.
The tab and carriage-return starters (the other formula triggers spreadsheets honour) are
guarded the same way. It applies to every column, so names, emails, labels and the
browser string are covered.

The 50,000 limit is `auditlog.ExportRowLimit`; `Service.WithExportLimit` /
`Handler.WithExportLimit` lower it for tests, which never insert 50,000 rows.

## Tests

- `cmd/api/audit_read_integration_test.go` (`integration`): the real router, auth and
  database. Owner-only gates on all five routes (401 / 403 / 403, `no-store`), exact
  item shape and order, system / user / former-member / deleted-user actors, vacancy
  with title / deleted, every filter and the Mexico City day boundaries, pagination and
  tie-breaking, the cursor rejections, the `invalid_filter` envelope, labels for every
  entity type (through the real detail and CV routes, plus seeded rows) and their
  read-time resolution, the catalogs, and the export: validation, too large (nothing
  written), the exact headers / BOM / header row / rows / injection guard, the
  `AuditLogExported` row (visible when the headers arrive), filters echoed into it, and
  that a rejected export writes no row.
- `cmd/api/main_test.go` `TestRouteTopology_ExactRegistrations` pins the five routes.
- Unit: `application/auditlog/query_test.go` (parser codes, cursor binding, types,
  day window, export body), `infrastructure/http/handler_test.go` (formula guard; a stream that
  fails after the 200 aborts the connection instead of ending a short file),
  `internal/shared/httpjson/audit_errors_test.go` (the 422 envelopes; the shared
  `invalid_filter` stays 400).
