# Private draft substate catalog API (cut 2)

`GET` and `PUT /v2/me/company/job-drafts/{draftId}/pipeline/substates` manage the
ordered catalog for the semantic `in_process` stage. The accepted contract is
`docs/pipeline-customization-design.md` §7; that document wins over this reference.
This cut assigns no candidates, changes no application statuses, and touches no
frontend code. Names need not match or differ from column names.

## Quick path

1. GET the resource; retain its opaque strong ETag.
2. PUT the full `{ "substates": [...] }` document with that ETag in `If-Match`.
3. Use the returned IDs/order/version and ETag. After a timeout, reconcile with
   GET rather than automatically retrying. There is no `Idempotency-Key`.

The current display name of `in_process` comes from GET `…/pipeline`, never from
this resource. Catalog order is recruiter-chosen display order, not a sequence.

## Identity and caching

Both methods return `200 OK`. Every response, including auth and error responses,
uses `Cache-Control: no-store`. The route uses the same `NoStore` → auth → recruiter
membership gates as cut 1. The store rechecks the live user, company and membership,
then authorizes the owner or draft principal in its transaction **before** comparing
preconditions or decoding the document. Missing, foreign and non-principal drafts
are indistinguishable `404 not_found`. Schema-1 drafts are hidden as in cut 1.
Malformed path UUIDs return `400 invalid_request` without calling the store.
Identity comes only from session `CompanyContext`, never identity headers.

## Exact response contract

```json
{
  "version": "0",
  "substates": [],
  "limits": { "maxSubstates": 50, "nameMaxLength": 40 },
  "suggestions": ["Primera entrevista", "Segunda entrevista", "Pruebas psicométricas", "Propuesta entregada"]
}
```

Response keys are **exactly** `version`, `substates`, `limits`, `suggestions`.
Each substate is exactly `{ "id": "<UUID>", "name": "<normalized name>" }`.
Limits contain exactly the two positive integers above. Both lists are always
arrays, never null. Suggestions are the same fixed list on every response,
including when a suggestion is already saved; the client filters its editor list.
Examples are not built-ins and are never stored merely by reading them.

`version` is a decimal string. `"0"` means never saved, with no catalog row and an
empty list. GET never writes. Catalog ETags are strong, opaque, bound to the draft
and independent catalog version, and distinct from draft and pipeline tags.
Clients retain tags rather than constructing or parsing them.

## PUT: full replacement

```json
{
  "substates": [
    { "id": "<existing UUID>", "name": "Entrevista técnica" },
    { "name": "Propuesta entregada" }
  ]
}
```

The body contains exactly `substates`. Each entry accepts only `name` and an
optional existing `id`. Omit IDs for new entries; the server assigns random UUIDs.
Rename/reorder preserve identity. Omission removes an entry freely in this cut;
removed IDs cannot be restored by supplying them later. The response preserves
request order, including generated IDs, without requiring another GET.

### Invariants (§7.1)

| Rule | Enforcement |
| --- | --- |
| 1: technical ceiling | 0–50 substates |
| 2: normalized names | Unchanged `NewRequesterName`: valid UTF-8 → NFC → trim/collapse Unicode whitespace (including NBSP); reject non-whitespace controls, retain format/zero-width characters; 1–40 normalized code points, not bytes |
| 3: unique names | Full-Unicode casefold of normalized names, accents preserved, no NFKC; `Straße` = `STRASSE`, `Área` = `ÁREA`, `Area` ≠ `Área`; no comparison with stage names |
| 4: identity | Existing IDs must belong to the current catalog and cannot repeat; new entries get server UUIDs |
| 5: empty is valid | `{"substates":[]}` removes all entries |

Unknown/duplicate keys (including escaped equivalents), malformed/trailing JSON,
invalid UTF-8/surrogates and wrong JSON shapes/types are `400 invalid_request`.
Invariant failures are `400 validation_error`.

### Preconditions and no-ops

`If-Match` is required and uses the unchanged cut-1 parser: exactly one nonempty
strong tag. Repeated header lines are joined and rejected as a list. Missing is
`428`; empty, weak, wildcard, list or malformed tags are `400 invalid_request`.
Well-formed stale/foreign tags (including draft/pipeline tags) return `412` without
data or ETag. The raw body budget remains 1048576 bytes; overflow is `413`.

The first PUT **always** creates version `"1"` with audit, even for an empty list.
Later normalized no-ops return the same version, ETag and body with no writes or
audit. Changing PUTs increment only the catalog version. Catalog PUTs do not change
draft or pipeline fields, timestamps, versions or ETags; pipeline PUT and draft
PATCH likewise do not change the catalog version or ETag.

## Persistence and audit

Migration `00016_create_job_draft_substate_catalogs.sql` adds one optional row per
draft: primary/FK `draft_id` with delete cascade, positive independent BIGINT
`version`, and complete encoded `catalog` bytes. No existing data is rewritten.
Parent draft locking serializes first and subsequent PUTs, so concurrent first
PUTs with the version-zero tag have exactly one winner and one `412`.

Every materializing/changing PUT writes one `JobDraftSubstatesConfigured` audit row
in the same transaction. The event records actor, draft association and metadata
`version`, `previous`, `new`; snapshots are complete catalog JSON documents encoded
as strings by the existing string-valued audit port. Failure to append audit rolls
back catalog and version. Stored invalid catalogs and version overflow fail closed.

**Risk — new migration (item 1):** down removes saved substate catalogs, not audit
rows or either existing resource. It is not a data-preserving rollback.

## Status codes

Errors are exactly `{ "error": string, "code": string }`, with no validation
details, editor data or ETag. Existing draft/cut-1 error mapping is reused.

| Status | Code | Case |
| --- | --- | --- |
| 400 | `invalid_request` | JSON encoding/shape, unknown/duplicate keys, malformed UUID path or If-Match |
| 400 | `validation_error` | Any §7.1 invariant |
| 401 | `unauthenticated` | Missing/invalid token or no live user |
| 403 | `forbidden` | Missing current membership / insufficient role |
| 403 | `company_inactive` | Missing/tombstoned company |
| 404 | `not_found` | Missing/foreign/non-principal draft after general gates |
| 409 | `company_not_active` | Company not active at the transactional guard |
| 412 | `version_conflict` | Stale/foreign strong If-Match |
| 413 | `payload_too_large` | Raw body exceeds budget |
| 428 | `precondition_required` | Missing If-Match |
| 500 | `internal_error` | Unexpected failure, invalid storage or version overflow |

## Test map

Names below refer to tests in `application/substatecatalog`, `postgres/draftstore`,
`cmd/api`, and `db/migrations` respectively. Database tests require the integration
build tag; this map describes their assertions, not a claim they ran.

| Tests | Contract / observable effects |
| --- | --- |
| `TestReplace_StrictDecode` | `400 invalid_request`: malformed/trailing JSON, root/nested unknown or duplicate keys, escaped duplicates, invalid UTF-8/surrogates, missing/null/wrong shapes/types |
| `TestReplace_Invariants` | §7.1 rules 1–4: 51 entries, blank/long/control names, full-casefold/NFC duplicates, unknown/malformed/duplicate IDs → `validation_error`; input unchanged |
| `TestReplace_NormalizationOrderIdentityRemovalAndNoOp` | Rules 2–5: normalized 40-code-point boundary, accent/NFKC distinctions, display ordering, UUIDv4 creation, identity-preserving rename/reorder, normalized no-op, empty removal and rejected ID resurrection |
| `TestReplace_LimitsAndPayloadBudget` | Rule 1: 50 accepted; `413` over body budget |
| `TestSuggestions_FixedNormalizedUniqueAndDefensive`, `TestValidate_RejectsCorruptStoredCatalog` | Fixed valid suggestions, no shared mutable list; invalid stored identities/names fail validation |
| `TestETag_IndependentOpaqueStrongPrecondition` | Independent strong tags; shared parser `400`, `412`, `428`; draft parser rejects catalog tags |
| `TestSubstates_RenderStrictResponseContract` | Exact response/nested keys and types, non-null arrays, fixed unfiltered suggestions, versions/ETags |
| `TestSubstates_DefaultReadFirstEmptyPutNoOpAndAudit` | Pure GET version 0; rule 5; first empty PUT version 1, one actor/previous/new audit; subsequent empty no-op changes nothing |
| `TestSubstates_ChangesNoOpAuditAndIndependentVersions` | Order/identity, incrementing version, exact audit snapshots/actor, normalized no-op, three-resource version/body isolation |
| `TestSubstates_RejectionsAreAtomicAndAuthorizeBeforePreconditions` | Invalid/precondition/invariant/auth failures return no result and leave parent, pipeline, catalog, version and every audit row unchanged; auth precedes missing If-Match/bad JSON |
| `TestSubstates_ConcurrentFirstPutsHaveOneWinner` | Exactly one success, one version conflict, one version-1 row and one audit event |
| `TestSubstates_AuditFailureRollsBackFirstAndLaterPuts` | First/later audit failure leaves all persisted effects unchanged |
| `TestSubstates_LiveGatesCorruptionAndOverflowFailClosed` | Live-user/membership/company gates, corrupt catalogs, overflow; zero result and unchanged persisted effects |
| `TestSubstatesRoutes_AnonymousNoStore`, `TestSubstatesRoutes_ContractAndNoStoreOnEveryStatus` | Real router: `200`, `400` (both codes), `401`, `403` (both codes), `404`, `409`, `412`, `413`, `428`, `500`; exact body/error passthrough, ETag only on success, no-store on every response |
| `TestSubstatesRoutes_ForwardIdentityAndAllIfMatchLines` | Session-derived GET/PUT identity, raw body forwarded, repeated If-Match lines retained for rejection |
| `TestSubstatesFlow_EmptyFirstSaveLifecycleNoOpAndVersionIsolation` | Real router/auth/store: rule 5, new UUIDs/order, names independent of columns, rename/reorder/removal, exact response keys, fixed suggestions, ETags/versions, no-op snapshots, audit counts and three-resource independence |
| `TestSubstatesFlow_RejectedRequestsLeaveEveryPersistedEffectUnchanged` | Real `400`/`401`/`404`/`412`/`413`/`428`, rules 1–4; status/code/exact error keys/no ETag/no-store and complete storage/audit snapshot unchanged on every rejection |
| `TestMigration00016SubstateCatalogDefinition`, `TestMigration00016SubstateCatalogUpDown` | Additive definition; live table/primary/FK/cascade/positive-version constraint, down preserves draft/pipeline tables |

## Validation commands

From `backend/`:

```sh
go tool sqlc generate
go test ./internal/features/jobs/application/substatecatalog ./internal/features/jobs/application/pipelineconfig ./internal/features/jobs/infrastructure/http ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api ./db/migrations -count=1
go test ./... -count=1
go vet ./...
go test -tags=integration ./internal/features/jobs/infrastructure/postgres/draftstore ./cmd/api -run '^Test(Substates|Pipeline)' -count=1 -v
# Run migrations separately: down tests must not race with store/API packages.
go test -tags=integration ./db/migrations -run '^TestMigration0001[56]' -count=1 -v
```

Integration tests use only `DRAFT_TEST_DATABASE_URL`, guard for loopback and database
name `draft_test`, and skip when unset. Do not create a database as part of these
commands and never substitute ambient `DATABASE_URL`.
