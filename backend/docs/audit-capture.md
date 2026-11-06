# Audit capture: sensitive reads, sessions, members

Contract: `docs/contracts/audit-log-v1.md` §2, §3 and §5. The event catalog
(`internal/features/audit_events/domain/entities/catalog.go`) pins every type and
its allowed metadata keys; `Append` refuses anything else. IP, browser and
`ip_source` come from the request context ([audit-request-metadata.md](audit-request-metadata.md)).
Metadata holds IDs, enums and counts only. How the owner reads these rows (list,
filters, export) is in [audit-read-api.md](audit-read-api.md).

## Sensitive reads

One row per successful read, **no deduplication**, written in the read's own
transaction. A failed audit insert fails the read with `500 internal_error` and
nothing is served (fail-closed). `403`, `404` and validation errors write nothing.
The actor is the user, `company_id` is their company.

| Route | Event | Entity | Metadata | `vacancy_id` |
| --- | --- | --- | --- | --- |
| `GET /v2/me/company/candidates/{kind}/{id}` | `CompanyCandidateViewed` | `company_candidate` / `{id}` | `{kind}` | — |
| `GET …/candidates/{kind}/{id}/participations/{participationId}/cv` | `CompanyCandidateCVDownloaded` | `company_candidate` / `{id}` | `{kind, participation_id, variant: "current"}` | the participation's vacancy |
| `GET …/participations/{participationId}/cv/original` (pool) | `CompanyCandidateCVDownloaded` | same | `{kind, participation_id, variant: "original"}` | same |
| `POST /v2/me/company/candidates/contacts` | `CompanyCandidateContactsRevealed` | `company` / company id | `{count, candidates: [{kind, id}]}` sorted by kind then id | — |
| `GET /v2/me/company/job-drafts/{id}/participations/{pid}` | `ParticipationViewed` | `process_participation` / `{pid}` | `{}` | `{id}` |
| `GET …/job-drafts/{id}/participations/{pid}/cv` | `ParticipationCVDownloaded` | same | `{variant: "current"}` | `{id}` |
| `GET …/job-drafts/{id}/participations/{pid}/cv/original` | `ParticipationCVDownloaded` | same | `{variant: "original"}` | `{id}` |

- **CV rows commit before the first byte.** The stores (`pool.Store.file`,
  `board.Store.file`) append the row, commit, and only then return the stream to
  the handler. A download interrupted mid-stream stays recorded. A CV that is not
  found, or unavailable storage, writes nothing; a failed audit closes the stream.
- **Contacts** records the candidates whose contact was actually returned
  (`count` = how many). Unknown or foreign identities in the request reveal
  nothing, so a request that reveals nobody writes no row. The email and phone
  values never reach the audit row.
- **No 304.** The pool detail has no `If-None-Match` handling: a revalidating
  request gets `200` and the body, and is recorded like any other read. If a
  conditional `304` is ever added it must also be recorded.
- The pool detail transaction (`REPEATABLE READ`) is now read-write because it
  appends the row; the candidate edit path still reuses the same projection
  inside its own write transaction and does not record a view.

## Sessions

`POST /v2/me/session/start` and `POST /v2/me/session/end`, called by the BFF
(sign-in; clicked sign-out). Both: `NoStore → RequireAuth`, answer `204`.

- The request body is **not read** (the convention of the other body-less POST
  actions: psychometric revoke/link, site unpublish), so a client that sends one
  is served.
- Only a user with a company membership is recorded: `SessionStarted` /
  `SessionEnded`, entity `user` / the user's id, `company_id` = the membership's
  company, metadata `{}`. A candidate, a recruiter without membership, a deleted
  user and an unknown subject all get `204` and no row.
- A failing audit insert answers `500 internal_error` (and logs a bounded line);
  the BFF logs it and does not block the sign-in or sign-out.
- A session that ends by token expiry or a closed tab has no `SessionEnded`.

Code: `identity/infrastructure/http/session.go` (handler),
`identity/application/usecases/session.go` (use case),
`identity/infrastructure/postgres/sessionStore.go` (resolve member + append in
one transaction), wired by `newSessionHandler` in `cmd/api/main.go`
(`TestProductionComposition_SessionHandlerWired`).

## Members

The member repository takes the audit port (`NewCompanyMemberRepository(db, audit)`)
and the repository methods take the acting user. The row commits in the same
transaction as the change, so a failed change writes nothing and a failed audit
rolls the change back.

| Route | Event | Entity | Metadata |
| --- | --- | --- | --- |
| `POST /me/company/members` | `CompanyMemberAdded` | `company_member` / the new membership id | `{member_user_id, role}` |
| `PATCH /me/company/members/{id}` | `CompanyMemberRoleChanged` | `company_member` / `{id}` | `{member_user_id, from_role, to_role}`; **no row when the role does not change** |
| `DELETE /me/company/members/{id}` | `CompanyMemberOffboarded` | `company_member` / `{id}` | see below |
| `POST /me/company/members/{id}/offboard` | `CompanyMemberOffboarded` | same | see below |

`CompanyMemberOffboarded` metadata is built by one function,
`entities.CompanyMemberOffboardedMetadata`: `{company_id, user_id, member_user_id,
reassignment_ids, ended_assignment_ids, talent_base_viewer_removed}` (`user_id`
is the pre-existing spelling, kept; `member_user_id` is the contract's key). Both
removal routes go through `draftstore.departCompanyMember`, which now appends the
event for DELETE as well (it used to audit only the offboard).

The plain `removeMember` handler (and `CompanyMemberRepository.Remove`) is only
registered when no offboard handler is composed. `cmd/api/main.go` always composes
one, so it is **not reachable in production**; it still emits the same event
(`reassignment_ids` and `ended_assignment_ids` empty, `talent_base_viewer_removed`
false, because it touches neither), so a mis-wired composition cannot silently
drop the record.

## Tests

- `cmd/api/audit_sensitive_reads_integration_test.go`, `audit_cv_commit_integration_test.go`
  (`integration`): real router, auth, talent-base gate, stores and database. Exact
  row (type, entity, actor, company, vacancy, metadata), no dedup, 304-style
  revalidation, nothing written on 401/404/400, fail-closed with a NOT VALID
  CHECK constraint (500, nothing served, no rows), and the CV row visible from
  another connection before the stream is touched.
- `cmd/api/audit_session_integration_test.go`: members and non-members, BFF vs
  forged headers, body ignored, 401/405, fail-closed.
- `cmd/api/audit_members_integration_test.go`: add, role change (and the no-op),
  both removal paths, the plain fallback, rejections and rollbacks.
- Unit: `session_test.go` (identity http), `contacts_audit_test.go` (pool store),
  `companyMemberRepository_test.go` (events, none on rejection or no-op),
  `TestEveryCatalogTypeHasAnEmitter` (no type is pending: `AuditLogExported` is emitted by the export, see [audit-read-api.md](audit-read-api.md)).
